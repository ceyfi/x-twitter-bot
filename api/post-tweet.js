import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const TELEGRAM_API = "https://api.telegram.org";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=24h%2C7d&sparkline=true";

const FORMATS = [
  "a direct market observation",
  "a falsifiable prediction with a condition",
  "a useful question tied to today's data",
  "a comparison that explains the current move",
];

const BANNED_PATTERNS = [
  /(?:most people|everyone|nobody) (?:think|thinks|believe|believes|realizes?)/i,
  /the (?:real|biggest) (?:lesson|mistake|risk|opportunity|question) (?:is|was)/i,
  /(?:isn't|is not) .+[,;—-]+ (?:it's|it is)/i,
  /(?:looks?|seems?) .+ until you realize/i,
  /(?:i watched|i spent|i held|i learned|my biggest mistake|cost me)/i,
  /(?:smart money|zoom out|this cycle is different|we are still early|dyor|to the moon|wagmi|ngmi)/i,
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

async function fetchMarketSnapshot() {
  const response = await fetch(COINGECKO_URL, {
    headers: { Accept: "application/json", "User-Agent": "AlphaGuruBot/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);

  const btc = (await response.json())?.[0];
  const prices = btc?.sparkline_in_7d?.price;
  const requiredValues = [
    btc?.current_price,
    btc?.price_change_percentage_24h,
    btc?.total_volume,
    btc?.market_cap,
  ];
  if (
    !requiredValues.every(Number.isFinite) ||
    !Array.isArray(prices) ||
    prices.length < 24 ||
    !prices.every(Number.isFinite)
  ) {
    throw new Error("CoinGecko response is missing BTC market data");
  }

  const updatedAt = new Date(btc.last_updated);
  const ageMs = Date.now() - updatedAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > 10 * 60_000) {
    throw new Error(`CoinGecko data is stale (${Math.round(ageMs / 60_000)} minutes old)`);
  }

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];

  return {
    price: btc.current_price,
    change24h: btc.price_change_percentage_24h,
    change7d: ((lastPrice - firstPrice) / firstPrice) * 100,
    volume24h: btc.total_volume,
    marketCap: btc.market_cap,
    high7d: Math.max(...prices),
    low7d: Math.min(...prices),
    prices7d: prices,
    updatedAt,
  };
}

function snapshotText(snapshot) {
  return [
    `BTC price: ${formatUsd(snapshot.price)}`,
    `24h change: ${snapshot.change24h.toFixed(2)}%`,
    `7d change: ${snapshot.change7d.toFixed(2)}%`,
    `7d range: ${formatUsd(snapshot.low7d)} to ${formatUsd(snapshot.high7d)}`,
    `24h volume: ${formatUsd(snapshot.volume24h)}`,
    `market cap: ${formatUsd(snapshot.marketCap)}`,
    `data time: ${snapshot.updatedAt.toISOString()}`,
  ].join("\n");
}

async function getRecentTweets() {
  // Anti-repeat context is optional. Candidate generation must still fail safely
  // if the read-only X endpoint is unavailable.
  try {
    const { TwitterApi } = await import("twitter-api-v2");
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY,
      appSecret: process.env.TWITTER_CONSUMER_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
    const me = await client.v2.me();
    const timeline = await client.v2.userTimeline(me.data.id, {
      max_results: 20,
      "tweet.fields": ["text"],
    });
    return timeline.data?.data?.map((tweet) => tweet.text) || [];
  } catch (error) {
    console.warn("Could not load recent tweets:", error.message);
    return [];
  }
}

function parseCandidates(raw) {
  const tagged = [...raw.matchAll(/<tweet>([\s\S]*?)<\/tweet>/gi)]
    .map((match) => match[1].trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);

  if (tagged.length) return tagged;

  // Also accept a JSON array if the model chooses structured output.
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) {
      const jsonCandidates = parsed
        .map((item) => (typeof item === "string" ? item : item?.text))
        .filter(Boolean);
      if (jsonCandidates.length) return jsonCandidates;
    }
  } catch {
    // The prompt does not require JSON; continue with plain-text parsing.
  }

  // Sonnet sometimes omits wrappers and writes numbered paragraphs instead.
  const numbered = raw
    .split(/(?:^|\n)\s*(?:(?:candidate|tweet)\s*)?\d+[.):\-]\s*/i)
    .map((block) => block.trim())
    .filter(Boolean);
  if (numbered.length >= 3) return numbered;

  return raw
    .split(/\r?\n\s*\n|\s*---+\s*/)
    .map((block) => block.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((block) => block.replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);
}

function validateCandidate(text, snapshot) {
  if (text.length < 35 || text.length > 240) return false;
  if (BANNED_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const priceAnchor = Math.round(snapshot.price).toLocaleString("en-US");
  const changeAnchor = Math.abs(snapshot.change24h).toFixed(1);
  const weeklyAnchor = Math.abs(snapshot.change7d).toFixed(1);
  return (
    text.includes(priceAnchor) ||
    text.includes(`${changeAnchor}%`) ||
    text.includes(`${weeklyAnchor}%`) ||
    /\d+(?:\.\d+)?%/.test(text) ||
    /\$\s?\d{2,3}(?:,\d{3})+/.test(text)
  );
}

async function generateCandidates(snapshot, recentTweets) {
  const recentContext = recentTweets.length
    ? recentTweets.map((tweet, index) => `${index + 1}. ${tweet}`).join("\n")
    : "No recent tweets available.";

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 650,
    system: `You write for @AlphaGuruReal, a small account about bitcoin, markets and AI.

The account must earn attention through concrete information, not fake wisdom.

Hard rules:
- Never invent personal experience, trades, conversations, access or credentials.
- Every tweet must explicitly include today's BTC price or 24h percentage move.
- Explain why the number may matter, what would invalidate the take, or ask a precise question.
- No generic motivational advice, fortune-cookie contrasts or claims about "most people".
- No hashtags, engagement bait, fake certainty or unsupported price targets.
- Plain English. Natural capitalization is allowed. Maximum 210 characters.
- Each candidate must make a materially different point.
- Candidate 3 accompanies a 7-day BTC chart. It must discuss the 7-day move or range and make sense with that chart.
- Return exactly three candidates, each wrapped in <tweet>...</tweet>. Nothing else.`,
    messages: [
      {
        role: "user",
        content: `Current verified market snapshot:\n${snapshotText(snapshot)}\n\nUse three different formats from this list:\n${FORMATS.join("\n")}\n\nDo not repeat these recent posts:\n${recentContext}`,
      },
    ],
  });

  const raw = message.content.find((block) => block.type === "text")?.text || "";
  const parsedCandidates = [...new Set(parseCandidates(raw))];
  let candidates = parsedCandidates.filter((candidate) =>
    validateCandidate(candidate, snapshot),
  );

  // Keep the human approval gate useful even when the model formats a number
  // as e.g. "117k" instead of "$117,000". Length and banned-pattern checks
  // still apply; the Telegram reviewer remains the final content filter.
  if (candidates.length < 3) {
    const safeFallback = parsedCandidates.filter(
      (candidate) =>
        candidate.length >= 35 &&
        candidate.length <= 240 &&
        !BANNED_PATTERNS.some((pattern) => pattern.test(candidate)),
    );
    if (safeFallback.length >= 3) {
      candidates = safeFallback.slice(0, 3);
      console.warn("Using safe candidate fallback after strict market-anchor validation");
    }
  }

  if (candidates.length !== 3) {
    throw new Error(`Claude returned ${candidates.length} valid candidates instead of 3`);
  }
  return candidates;
}

export async function generateChart(snapshot) {
  const width = 1200;
  const height = 675;
  const left = 90;
  const right = 1110;
  const top = 190;
  const bottom = 520;
  const range = snapshot.high7d - snapshot.low7d || 1;
  const color = snapshot.change7d >= 0 ? "#36c98f" : "#ef5b67";
  const direction = snapshot.change7d >= 0 ? "+" : "";

  const points = snapshot.prices7d
    .map((price, index) => {
      const x = left + (index / (snapshot.prices7d.length - 1)) * (right - left);
      const y = bottom - ((price - snapshot.low7d) / range) * (bottom - top);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `${left},${bottom} ${points} ${right},${bottom}`;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#07090d"/><stop offset="1" stop-color="#111722"/>
        </linearGradient>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#bg)"/>
      <text x="90" y="78" fill="#d6a938" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="3">ALPHA GURU</text>
      <text x="90" y="132" fill="#f3f4f6" font-family="Arial, sans-serif" font-size="38" font-weight="700">BITCOIN · 7 DAY</text>
      <text x="1110" y="92" text-anchor="end" fill="#f3f4f6" font-family="Arial, sans-serif" font-size="42" font-weight="700">${formatUsd(snapshot.price)}</text>
      <text x="1110" y="134" text-anchor="end" fill="${color}" font-family="Arial, sans-serif" font-size="25" font-weight="700">${direction}${snapshot.change7d.toFixed(2)}%</text>
      <line x1="90" y1="${top}" x2="1110" y2="${top}" stroke="#334155" stroke-width="1" stroke-dasharray="5 8"/>
      <line x1="90" y1="${bottom}" x2="1110" y2="${bottom}" stroke="#334155" stroke-width="1" stroke-dasharray="5 8"/>
      <polygon points="${areaPoints}" fill="url(#area)"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="90" y="565" fill="#94a3b8" font-family="Arial, sans-serif" font-size="20">7D LOW  ${formatUsd(snapshot.low7d)}</text>
      <text x="1110" y="565" text-anchor="end" fill="#94a3b8" font-family="Arial, sans-serif" font-size="20">7D HIGH  ${formatUsd(snapshot.high7d)}</text>
      <text x="90" y="625" fill="#64748b" font-family="Arial, sans-serif" font-size="17">Source: CoinGecko · ${snapshot.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</text>
      <text x="1110" y="625" text-anchor="end" fill="#64748b" font-family="Arial, sans-serif" font-size="17">@AlphaGuruReal</text>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function telegramRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  }
  return result;
}

async function sendForApproval(candidates, snapshot, chartBuffer) {
  const direction = snapshot.change24h >= 0 ? "+" : "";
  const candidateText = candidates
    .map((candidate, index) => `<b>Predlog ${index + 1}:</b>\n${escapeHtml(candidate)}`)
    .join("\n\n");
  const text =
    `<b>Daily kandidati</b>\n\n${candidateText}\n\n` +
    `<b>Market snapshot:</b> ${escapeHtml(formatUsd(snapshot.price))} ` +
    `(${direction}${snapshot.change24h.toFixed(2)}% / 24h)\n\n` +
    `<i>Ništa nije objavljeno. Izaberi najviše jedan predlog.</i>`;

  const replyMarkup = {
    inline_keyboard: [
      candidates.map((_, index) => ({
        text: `✅ Objavi ${index + 1}`,
        callback_data: `post:daily:${index}${index === 2 ? ":image" : ""}`,
      })),
      [{ text: "❌ Preskoči sve", callback_data: "skip:daily" }],
    ],
  };
  const form = new FormData();
  form.set("chat_id", process.env.TELEGRAM_CHAT_ID);
  form.set("photo", new Blob([chartBuffer], { type: "image/png" }), "btc-7d.png");
  form.set("caption", text);
  form.set("parse_mode", "HTML");
  form.set("show_caption_above_media", "true");
  form.set("reply_markup", JSON.stringify(replyMarkup));

  const response = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram sendPhoto failed: ${result.description || response.status}`);
  }
}

function assertConfiguration() {
  const required = [
    "ANTHROPIC_API_KEY",
    "CRON_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    assertConfiguration();
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ error: "Server configuration is incomplete" });
  }

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [snapshot, recentTweets] = await Promise.all([
      fetchMarketSnapshot(),
      getRecentTweets(),
    ]);
    const candidates = await generateCandidates(snapshot, recentTweets);
    const chartBuffer = await generateChart(snapshot);
    await sendForApproval(candidates, snapshot, chartBuffer);

    console.log(`Sent ${candidates.length} daily candidates for approval`);
    return res.status(200).json({
      success: true,
      sentForApproval: candidates.length,
      published: false,
      imageCandidate: 3,
      marketDataUpdatedAt: snapshot.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Daily candidate error:", error);
    return res.status(500).json({ error: error.message });
  }
}
