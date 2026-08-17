import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import {
  buildDeterministicCandidates,
  candidateNoveltyScore,
  candidateSimilarity,
  classifyAngle,
  deriveSnapshotMetrics,
  hasSameNumericFacts,
  isNovelCandidate,
  parseCandidates,
  validateCandidate,
} from "../lib/content-validation.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const TELEGRAM_API = "https://api.telegram.org";
const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=7d";
const COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global";
const TRACKED_MARKET_IDS = new Set([
  "bitcoin", "ethereum", "binancecoin", "ripple", "solana", "tron", "dogecoin",
  "cardano", "hyperliquid", "chainlink", "avalanche-2", "sui", "stellar",
  "hedera-hashgraph", "litecoin", "the-open-network",
]);

let anthropic;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  anthropic ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

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
    maximumFractionDigits: value < 1 ? 4 : value < 100 ? 2 : 0,
  }).format(value);
}

async function fetchCoinGeckoJson(url, label) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AlphaGuruBot/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`CoinGecko ${label} returned ${response.status}`);
  return response.json();
}

export async function fetchMarketSnapshot() {
  const [marketRows, globalResponse] = await Promise.all([
    fetchCoinGeckoJson(COINGECKO_MARKETS_URL, "markets"),
    fetchCoinGeckoJson(COINGECKO_GLOBAL_URL, "global").catch((error) => {
      console.warn("CoinGecko global data unavailable:", error.message);
      return null;
    }),
  ]);

  const btc = Array.isArray(marketRows)
    ? marketRows.find((asset) => asset.id === "bitcoin")
    : null;
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
  const assets = marketRows
    .filter((asset) =>
      TRACKED_MARKET_IDS.has(asset.id) &&
      Number.isFinite(asset.current_price) &&
      Number.isFinite(asset.price_change_percentage_24h) &&
      Number.isFinite(asset.price_change_percentage_7d_in_currency) &&
      Number.isFinite(asset.total_volume) &&
      Number.isFinite(asset.market_cap),
    )
    .slice(0, 8)
    .map((asset) => ({
      id: asset.id,
      symbol: String(asset.symbol || asset.id).toUpperCase(),
      name: asset.name,
      price: asset.current_price,
      change24h: asset.price_change_percentage_24h,
      change7d: asset.price_change_percentage_7d_in_currency,
      volume24h: asset.total_volume,
      marketCap: asset.market_cap,
    }));
  const globalData = globalResponse?.data;
  const globalUpdatedAt = new Date(Number(globalData?.updated_at) * 1000);
  const globalAgeMs = Date.now() - globalUpdatedAt.getTime();
  const global = [
    globalData?.total_market_cap?.usd,
    globalData?.total_volume?.usd,
    globalData?.market_cap_change_percentage_24h_usd,
    globalData?.market_cap_percentage?.btc,
  ].every(Number.isFinite) && globalAgeMs >= -60_000 && globalAgeMs <= 30 * 60_000
    ? {
      totalMarketCap: globalData.total_market_cap.usd,
      totalVolume: globalData.total_volume.usd,
      marketCapChange24h: globalData.market_cap_change_percentage_24h_usd,
      btcDominance: globalData.market_cap_percentage.btc,
    }
    : null;

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
    assets,
    global,
  };
}

function snapshotText(snapshot) {
  const metrics = deriveSnapshotMetrics(snapshot);
  const lines = [
    `BTC price: ${formatUsd(snapshot.price)}`,
    `24h change: ${snapshot.change24h.toFixed(2)}%`,
    `7d change: ${snapshot.change7d.toFixed(2)}%`,
    `7d range: ${formatUsd(snapshot.low7d)} to ${formatUsd(snapshot.high7d)}`,
    `7d range width: ${metrics.rangePercent.toFixed(2)}%`,
    `distance above 7d low: ${metrics.aboveLowPercent.toFixed(2)}%`,
    `distance below 7d high: ${metrics.belowHighPercent.toFixed(2)}%`,
    `24h volume: ${formatUsd(snapshot.volume24h)}`,
    `market cap: ${formatUsd(snapshot.marketCap)}`,
    `24h volume / market cap: ${metrics.turnoverPercent.toFixed(2)}%`,
    `data time: ${snapshot.updatedAt.toISOString()}`,
  ];
  if (snapshot.assets?.length) {
    lines.push("Tracked non-stable majors:");
    for (const asset of snapshot.assets) {
      lines.push(`${asset.symbol}: ${formatUsd(asset.price)}, 24h ${asset.change24h.toFixed(2)}%, 7d ${asset.change7d.toFixed(2)}%`);
    }
  }
  if (snapshot.global) {
    lines.push(
      `Total crypto market cap: ${formatUsd(snapshot.global.totalMarketCap)}`,
      `Total market cap 24h change: ${snapshot.global.marketCapChange24h.toFixed(2)}%`,
      `BTC dominance: ${snapshot.global.btcDominance.toFixed(2)}%`,
    );
  }
  return lines.join("\n");
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
    return {
      tweets: timeline.data?.data?.map((tweet) => tweet.text) || [],
      available: true,
    };
  } catch (error) {
    console.warn("Could not load recent tweets:", error.message);
    return { tweets: [], available: false };
  }
}

async function requestCandidateBatch(snapshot, recentContext, factLockedDrafts) {
  const message = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 800,
    system: `You edit three fact-locked drafts for @AlphaGuruReal, a small account about crypto markets and AI.

The account must earn attention through concrete information, not fake wisdom.

Hard rules:
- Never invent personal experience, trades, conversations, access or credentials.
- No generic motivational advice, fortune-cookie contrasts or claims about "most people".
- No hashtags, engagement bait, fake certainty or unsupported price targets.
- Plain English. Natural capitalization is allowed. Maximum 210 characters.
- Keep every number, symbol, asset, comparison and time window from each draft exactly unchanged.
- Do not add or remove facts. Change only wording and sentence rhythm.
- Preserve the order and topic of all three drafts. Candidate 3 still accompanies a BTC 7-day chart.
- Avoid the wording and sentence structure of recent posts.
- Return exactly three candidates, each wrapped in <tweet>...</tweet>. Nothing else.`,
    messages: [
      {
        role: "user",
        content: `Verified snapshot:\n${snapshotText(snapshot)}\n\nFact-locked drafts:\n${factLockedDrafts
          .map((draft, index) => `${index + 1}. ${draft}`)
          .join("\n")}\n\nRecent posts to avoid:\n${recentContext}`,
      },
    ],
  });

  const raw = message.content.find((block) => block.type === "text")?.text || "";
  return parseCandidates(raw);
}

export async function generateCandidates(snapshot, recentTweets) {
  const recentContext = recentTweets.length
    ? recentTweets.map((tweet, index) => `${index + 1}. ${tweet}`).join("\n")
    : "No recent tweets available.";

  const drafts = buildDeterministicCandidates(snapshot, recentTweets);
  try {
    const batch = await requestCandidateBatch(snapshot, recentContext, drafts);
    const candidates = [];
    const decisions = [];
    let rewrittenCount = 0;
    for (let index = 0; index < drafts.length; index += 1) {
      const candidate = batch[index];
      const draft = drafts[index];
      const checks = {
        present: typeof candidate === "string",
        locallyValid: validateCandidate(candidate, snapshot),
        factsPreserved: hasSameNumericFacts(candidate, draft),
        topicPreserved: classifyAngle(candidate) === classifyAngle(draft),
        novel: isNovelCandidate(candidate, recentTweets),
        distinct: candidates.every((selected) =>
          classifyAngle(candidate) !== classifyAngle(selected) &&
          candidateSimilarity(candidate, selected) < 0.46,
        ),
      };
      const validRewrite = Object.values(checks).every(Boolean);
      if (validRewrite) rewrittenCount += 1;
      candidates.push(validRewrite ? candidate : draft);
      decisions.push({
        slot: index + 1,
        topic: classifyAngle(draft),
        source: validRewrite ? "claude" : "market-brief",
        rejectedBy: validRewrite ? [] : Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name),
      });
    }
    const source = rewrittenCount === drafts.length
      ? "claude"
      : rewrittenCount > 0 ? `hybrid-${rewrittenCount}-of-${drafts.length}` : "market-briefs";
    console.log("Candidate generation result", {
      source,
      decisions,
    });
    return { candidates, source };
  } catch (error) {
    console.warn("Claude rewrite failed; using verified market briefs:", error.message);
  }

  return {
    candidates: drafts,
    source: "market-briefs",
  };
}

function fallbackRecommendation(candidates, recentTweets) {
  const scores = candidates.map((candidate) => {
    let score = candidateNoveltyScore(candidate, recentTweets) * 5;
    if (/\b(if|when|question|which|what)\b/i.test(candidate)) score += 0.5;
    if (/\d+(?:\.\d+)?%|\$\s?\d{2,3}(?:,\d{3})+/i.test(candidate)) score += 1;
    return score;
  });
  const pick = scores.indexOf(Math.max(...scores)) + 1;
  return {
    pick,
    reason: "najviše se razlikuje od skorijih objava, uz proverljive brojke i jasan zaključak",
  };
}

export async function generateRecommendation(candidates, snapshot, recentTweets = []) {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 3) {
    throw new Error("Recommendation requires two or three candidates");
  }
  const fallback = fallbackRecommendation(candidates, recentTweets);
  try {
    const message = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 180,
      system: `You are the editor for a small bitcoin/markets account. Compare the candidate posts using verified market data and recent account posts.
Novelty is the first priority: reject repeated thesis, sentence structure and range-break framing. Then prefer clear, falsifiable insight with no unsupported inference.
Return exactly two lines:
PICK: ${candidates.map((_, index) => index + 1).join(" or ")}
WHY: one concise reason under 120 characters
Write the WHY value in Serbian.
Do not rewrite the posts.`,
      messages: [{
        role: "user",
        content: `Verified market data:\n${snapshotText(snapshot)}\n\nRecent posts to avoid:\n${recentTweets.slice(0, 6).join("\n") || "None available"}\n\nCandidates:\n${candidates
          .map((candidate, index) => `${index + 1}. ${candidate}`)
          .join("\n")}`,
      }],
    });
    const raw = message.content
      .filter((block) => typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    const pickMatch = raw.match(new RegExp(`PICK\\s*:\\s*([1-${candidates.length}])`, "i"));
    const whyMatch = raw.match(/WHY\s*:\s*([^\n]+)/i);
    if (!pickMatch || !whyMatch) return fallback;
    const modelPick = Number(pickMatch[1]);
    const noveltyScores = candidates.map((candidate) => candidateNoveltyScore(candidate, recentTweets));
    const mostNovelPick = noveltyScores.indexOf(Math.max(...noveltyScores)) + 1;
    if (noveltyScores[modelPick - 1] + 0.15 < noveltyScores[mostNovelPick - 1]) {
      return fallback;
    }
    return { pick: modelPick, reason: whyMatch[1].trim().slice(0, 120) };
  } catch (error) {
    console.warn("Recommendation generation failed:", error.message);
    return fallback;
  }
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

export async function telegramRequest(method, body) {
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

async function sendFailureAlert(error) {
  const safeMessage = String(error?.message || "Unknown error")
    .replace(/https?:\/\/\S+/g, "[url]")
    .slice(0, 180);
  await telegramRequest("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: `⚠️ Daily kandidati nisu generisani.\n${safeMessage}`,
  });
}

async function sendForApproval(candidates, snapshot, chartBuffer, recommendation, generationSource, antiRepeatAvailable) {
  const direction = snapshot.change24h >= 0 ? "+" : "";
  const candidateText = candidates
    .map((candidate, index) => `<b>Predlog ${index + 1}:</b>\n${escapeHtml(candidate)}`)
    .join("\n\n");
  const text =
    `<b>Daily kandidati</b>\n\n${candidateText}\n\n` +
    `<b>Market snapshot:</b> ${escapeHtml(formatUsd(snapshot.price))} ` +
    `(${direction}${snapshot.change24h.toFixed(2)}% / 24h)\n\n` +
    `<b>Moj izbor: Predlog ${recommendation.pick}</b>\n` +
    `${escapeHtml(recommendation.reason)}\n\n` +
    `<i>Izvor: ${generationSource === "claude" ? "Claude" : generationSource.startsWith("hybrid") ? "Claude + market brief" : "provereni market briefovi"} · anti-repeat: ${antiRepeatAvailable ? "aktivan" : "bez X konteksta"}</i>\n` +
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
    const [snapshot, recentContext] = await Promise.all([
      fetchMarketSnapshot(),
      getRecentTweets(),
    ]);
    const generation = await generateCandidates(snapshot, recentContext.tweets);
    const candidates = generation.candidates;
    const recommendation = await generateRecommendation(candidates, snapshot, recentContext.tweets);
    const chartBuffer = await generateChart(snapshot);
    await sendForApproval(
      candidates,
      snapshot,
      chartBuffer,
      recommendation,
      generation.source,
      recentContext.available,
    );

    console.log(`Sent ${candidates.length} daily candidates for approval`);
    return res.status(200).json({
      success: true,
      sentForApproval: candidates.length,
      published: false,
      generationSource: generation.source,
      imageCandidate: 3,
      marketDataUpdatedAt: snapshot.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Daily candidate error:", error);
    await sendFailureAlert(error).catch((alertError) =>
      console.warn("Could not send Telegram failure alert:", alertError.message),
    );
    return res.status(500).json({ error: error.message });
  }
}
