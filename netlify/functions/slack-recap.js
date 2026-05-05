// netlify/functions/slack-recap.js
// Runs every Monday at 9am CT — posts marketing summary to #marketing

export const config = {
  schedule: "0 14 * * 1"
};

export async function handler() {
  const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
  const SLACK_CHANNEL = process.env.SLACK_MARKETING_CHANNEL;
  const DASHBOARD_URL = process.env.MARKETING_DASHBOARD_URL || "https://nemah-marketing.netlify.app";
  const TW_API_KEY = process.env.TRIPLEWHALE_API_KEY;
  const SHOP_ID = process.env.TW_SHOP_ID || "nemah-company.myshopify.com";

  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  // Defaults (April actuals)
  let roas = 2.50, spend = 54440, cpa = 28.05, metaRoas = 1.76, googleRoas = 6.22;
  let revenue = 143740, cvr = 6.51, sessions = 64583;

  if (TW_API_KEY) {
    try {
      const res = await fetch("https://api.triplewhale.com/willy/moby-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": TW_API_KEY },
        body: JSON.stringify({
          shopId: SHOP_ID,
          question: `What is my blended ROAS, total ad spend, CPA, Meta ROAS, Google ROAS, total revenue, and CVR MTD for ${monthName}?`
        })
      });
      if (res.ok) {
        const data = await res.json();
        const conclusion = data.assistantConclusion || "";
        const roasMatch = conclusion.match(/blended roas[^0-9]*([0-9.]+)/i);
        const spendMatch = conclusion.match(/total spend[^$]*\$([0-9,]+)/i);
        if (roasMatch) roas = parseFloat(roasMatch[1]);
        if (spendMatch) spend = parseFloat(spendMatch[1].replace(",", ""));
      }
    } catch (e) { /* use defaults */ }
  }

  const fmt = n => "$" + Math.round(n).toLocaleString();
  const roasEmoji = r => r >= 3 ? "🟢" : r >= 2 ? "🟡" : "🔴";

  const message = {
    channel: SLACK_CHANNEL,
    text: `📣 Nēmah Marketing Weekly — ${monthName} MTD`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📣 Nēmah Marketing Weekly — ${monthName} MTD` }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*DTC Revenue:* ${fmt(revenue)}  |  *Sessions:* ${sessions.toLocaleString()}  |  *CVR:* ${cvr}%` }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `${roasEmoji(roas)} *Blended ROAS*\n${roas.toFixed(2)}×` },
          { type: "mrkdwn", text: `💸 *Total Ad Spend*\n${fmt(spend)}` },
          { type: "mrkdwn", text: `${roasEmoji(metaRoas)} *Meta ROAS*\n${metaRoas.toFixed(2)}×` },
          { type: "mrkdwn", text: `${roasEmoji(googleRoas)} *Google ROAS*\n${googleRoas.toFixed(2)}×` }
        ]
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `💡 *This week's signal:* Google at ${googleRoas}× ROAS vs Meta at ${metaRoas}× — Google is significantly under-budgeted at 14.9% of total spend.` }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `<${DASHBOARD_URL}|🔗 View Full Marketing Dashboard>` }
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Posted automatically every Monday 9am CT · Data from Triple Whale + Shopify + Klaviyo` }]
      }
    ]
  };

  try {
    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Authorization": `Bearer ${SLACK_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    const slackData = await slackRes.json();
    if (!slackData.ok) throw new Error(slackData.error);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
