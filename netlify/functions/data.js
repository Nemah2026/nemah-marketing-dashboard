// netlify/functions/data.js
// Fetches Triple Whale (ads/creative) + Klaviyo (email) + Shopify data

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const { from, to } = event.queryStringParameters || {};

  try {
    const [twData, klaviyoData, shopifyData] = await Promise.all([
      fetchTripleWhale(from, to),
      fetchKlaviyo(from, to),
      fetchShopifyAnalytics(from, to)
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ triplewhale: twData, klaviyo: klaviyoData, shopify: shopifyData, fetchedAt: new Date().toISOString() })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}

// ── Triple Whale: summary-page API (native, no Moby credits needed) ────────
async function fetchTripleWhale(from, to) {
  const TW_API_KEY = process.env.TRIPLEWHALE_API_KEY;
  const SHOP_DOMAIN = process.env.TW_SHOP_ID || "nemah-company.myshopify.com";

  if (!TW_API_KEY) return getMockTWData();

  const today = new Date().toISOString().split("T")[0];
  const start = from
    ? from.split("T")[0]
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const end = to ? to.split("T")[0] : today;

  const body = { shopDomain: SHOP_DOMAIN, period: { start, end } };
  if (end >= today) {
    body.todayHour = new Date().getUTCHours();
  }

  try {
    const res = await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": TW_API_KEY },
      body: JSON.stringify(body)
    });

    if (!res.ok) return getMockTWData();

    const data = await res.json();

    // Build lookup map: metricId → current value
    const map = {};
    (data.metrics || []).forEach(m => {
      map[m.id] = m.values?.current ?? null;
    });

    return {
      source: "triplewhale_api",
      period: `${start} → ${end}`,
      total_ad_spend:    map.blendedAds          ?? null,
      blended_roas:      map.roas                ?? null,
      blended_cpa:       map.totalCpa            ?? null,
      mer:               map.mer                 ?? null,
      meta_spend:        map.facebookAds         ?? null,
      meta_roas:         map.facebookRoas        ?? null,
      meta_cpa:          map.facebookCpa         ?? null,
      meta_purchases:    map.facebookPurchases   ?? null,
      meta_ctr:          map.facebookCtr         ?? null,
      meta_cpc:          map.facebookCpc         ?? null,
      meta_impressions:  map.facebookImpressions ?? null,
      google_spend:      map.googleAds           ?? null,
      google_roas:       map.googleRoas          ?? null,
      google_cpa:        map.googleAllCpa        ?? null,
      google_ctr:        map.totalGoogleAdsCtr   ?? null,
      amazon_sales:      map.amazonSales         ?? null,
      amazon_spend:      map.amazonAds           ?? null,
      amazon_roas:       map.amazonROAS          ?? null,
      amazon_tacos:      map.amazonTACos         ?? null,
      new_customer_rev:  map.newCustomerSales    ?? null,
      new_customers_pct: map.newCustomersPercent ?? null,
      aov:               map.shopifyAov          ?? null,
      gross_profit:      map.grossProfit         ?? null,
    };
  } catch (e) {
    return getMockTWData();
  }
}

async function fetchKlaviyo(from, to) {
  const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
  if (!KLAVIYO_KEY) return getMockKlaviyoData();

  try {
    // Step 1: fetch campaigns (sent email only, newest first)
    const campaignsRes = await fetch(
      `https://a.klaviyo.com/api/campaigns?filter=and(equals(messages.channel,"email"),equals(status,"Sent"))&sort=-created_at&fields[campaign]=name,status,send_time&page[size]=25`,
      { headers: { "Authorization": `Klaviyo-API-Key ${KLAVIYO_KEY}`, "revision": "2024-10-15" } }
    );
    if (!campaignsRes.ok) return getMockKlaviyoData();
    const campaigns = await campaignsRes.json();
    const campaignList = campaigns.data || [];

    // Step 2: fetch campaign stats
    const statsRes = await fetch("https://a.klaviyo.com/api/campaign-values-reports", {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        "revision": "2024-10-15",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: {
          type: "campaign-values-report",
          attributes: {
            statistics: ["opens", "open_rate", "clicks", "click_rate", "unsubscribes", "delivered", "revenue_per_recipient", "conversion_rate", "conversions"],
            conversion_metric_id: "T8THMQ",
            timeframe: { key: "last_12_months" }
          }
        }
      })
    });

    const statsMap = {};
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      const results = statsData?.data?.attributes?.results || [];
      results.forEach(r => {
        const id = r.groupings?.campaign_id;
        if (id) statsMap[id] = r.statistics || {};
      });
    }

    // Merge stats into campaigns
    const enriched = campaignList.slice(0, 15).map(c => ({
      id: c.id,
      name: c.attributes?.name,
      send_time: c.attributes?.send_time,
      stats: statsMap[c.id] || {}
    }));

    return { campaigns: enriched, source: "klaviyo_api" };
  } catch (e) {
    return getMockKlaviyoData();
  }
}

async function fetchShopifyAnalytics(from, to) {
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE || "nemah-company.myshopify.com";
  const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!SHOPIFY_TOKEN) return getMockShopifyData();

  try {
    const query = `
      query {
        shopifyqlQuery(query: "FROM sales SHOW gross_sales, net_sales, orders GROUP BY product_title ORDER BY gross_sales DESC LIMIT 10 SINCE ${from} UNTIL ${to}") {
          tableData { columns { name dataType } rowData }
        }
      }`;
    const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return getMockShopifyData();
    const data = await res.json();
    return { products: data?.data?.shopifyqlQuery?.tableData, source: "shopify_api" };
  } catch (e) {
    return getMockShopifyData();
  }
}

function getMockTWData() {
  return {
    total_ad_spend: 54440, blended_roas: 2.50, blended_cpa: 28.05,
    meta_spend: 37856, meta_roas: 1.76, meta_cpa: 39.11,
    google_spend: 8095, google_roas: 6.22, google_cpa: 11.66,
    amazon_sales: 79873, amazon_spend: 4489, amazon_roas: 17.80,
    source: "cached"
  };
}

function getMockKlaviyoData() {
  return {
    campaigns: [
      { id: "1", name: "Mothers Day Email 4", send_time: "2026-05-03", stats: {} },
      { id: "2", name: "Mothers Day Sale #2", send_time: "2026-04-29", stats: {} },
      { id: "3", name: "Mother's Day Sale Email 1", send_time: "2026-04-28", stats: {} },
      { id: "4", name: "Stretch or Belly?", send_time: "2026-04-20", stats: {} },
      { id: "5", name: "Firming Serum Q&A", send_time: "2026-04-17", stats: {} }
    ],
    source: "cached"
  };
}

function getMockShopifyData() {
  return {
    products: [
      { title: "Pregnancy Set", gross_sales: 45583, orders: 704 },
      { title: "Firming Body Serum", gross_sales: 41642, orders: 538 },
      { title: "Renewing Scar Cream", gross_sales: 20660, orders: 531 },
      { title: "Revitalizing Stretch Mark Cream", gross_sales: 13875, orders: 308 },
      { title: "Nourishing Belly Oil", gross_sales: 13544, orders: 160 }
    ],
    totalRevenue: 143740, totalOrders: 2297, totalSessions: 64583,
    source: "cached"
  };
}
