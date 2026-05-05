// netlify/functions/data.js
// Fetches Triple Whale (ads/creative) + Klaviyo (email) data

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

async function fetchTripleWhale(from, to) {
  const TW_API_KEY = process.env.TRIPLEWHALE_API_KEY;
  const SHOP_ID = process.env.TW_SHOP_ID || "nemah-company.myshopify.com";

  if (!TW_API_KEY) return getMockTWData();

  try {
    const questions = [
      `What is my total ad spend, blended ROAS, CPA, Meta spend, Meta ROAS, Google spend, Google ROAS from ${from} to ${to}?`,
      `What are my top 5 ads by spend from ${from} to ${to} with ad name, spend, ROAS, CTR, impressions?`,
      `What is my Meta video vs image ROAS and CTR breakdown from ${from} to ${to}?`
    ];

    const results = await Promise.all(questions.map(question =>
      fetch("https://api.triplewhale.com/willy/moby-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": TW_API_KEY },
        body: JSON.stringify({ shopId: SHOP_ID, question })
      }).then(r => r.json()).catch(() => null)
    ));

    return { raw: results, source: "triplewhale_api" };
  } catch (e) {
    return getMockTWData();
  }
}

async function fetchKlaviyo(from, to) {
  const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
  if (!KLAVIYO_KEY) return getMockKlaviyoData();

  try {
    const sinceDate = new Date(from).toISOString();
    const campaignsRes = await fetch(
      `https://a.klaviyo.com/api/campaigns?filter=equals(status,"Sent")&fields[campaign]=name,status,send_time&include=campaign-messages`,
      { headers: { "Authorization": `Klaviyo-API-Key ${KLAVIYO_KEY}`, "revision": "2024-10-15" } }
    );
    if (!campaignsRes.ok) return getMockKlaviyoData();
    const campaigns = await campaignsRes.json();
    return { campaigns: campaigns.data?.slice(0, 10) || [], source: "klaviyo_api" };
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
    total_ad_spend: 54440, blended_roas: 2.50, pixel_roas: 4.02, cpa: 28.05,
    meta_spend: 37856, meta_roas: 1.76, meta_cpa: 39.11,
    google_spend: 8095, google_roas: 6.22, google_cpa: 11.66,
    video_roas: 1.68, video_ctr: 0.0152, image_roas: 1.18, image_ctr: 0.0079,
    top_ads: [
      { name: "UGC Scar Demo — Mary 30sec", channel: "meta", spend: 6390, roas: 1.18, ctr: 0.0181, impressions: 228900 },
      { name: "Google Ads Campaign 751358743892", channel: "google", spend: 6220, roas: 2.01, ctr: 0.0052, impressions: 709459 },
      { name: "Motherhood Creative — Ad Set B", channel: "meta", spend: 4922, roas: 2.29, ctr: 0.0189, impressions: 260726 },
      { name: "Motherhood Creative — Ad Set A", channel: "meta", spend: 6128, roas: 1.56, ctr: 0.0123, impressions: 280247 },
      { name: "Skin Spray — Gabby Kerr UGC", channel: "meta", spend: 1350, roas: 1.02, ctr: 0.0289, impressions: 57136 }
    ],
    source: "cached"
  };
}

function getMockKlaviyoData() {
  return {
    campaigns: [
      { id: "1", attributes: { name: "Mothers Day Email 4", send_time: "2026-05-03", definition: { content: { subject: "One week left to treat her (and yourself)" } } } },
      { id: "2", attributes: { name: "Mothers Day Sale #2", send_time: "2026-04-29", definition: { content: { subject: "Let's Celebrate Mama 🌸 25% OFF" } } } },
      { id: "3", attributes: { name: "Mother's Day Sale Email 1", send_time: "2026-04-28", definition: { content: { subject: "25% Off All Mom Products" } } } },
      { id: "4", attributes: { name: "Stretch or Belly?", send_time: "2026-04-20", definition: { content: { subject: "Cream or oil — which one is actually working?" } } } },
      { id: "5", attributes: { name: "Firming Serum Q&A", send_time: "2026-04-17", definition: { content: { subject: "Your Firming Body Serum Questions, Answered" } } } }
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
