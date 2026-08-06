export const BANNED_PATTERNS = [
  /(?:most people|everyone|nobody) (?:think|thinks|believe|believes|realizes?)/i,
  /the (?:real|biggest) (?:lesson|mistake|risk|opportunity|question) (?:is|was)/i,
  /(?:isn't|is not) .+[,;—-]+ (?:it's|it is)/i,
  /(?:looks?|seems?) .+ until you realize/i,
  /(?:i watched|i spent|i held|i learned|my biggest mistake|cost me)/i,
  /(?:smart money|zoom out|this cycle is different|we are still early|dyor|to the moon|wagmi|ngmi)/i,
];

export function parseCandidates(raw) {
  const tagged = [...raw.matchAll(/<tweet>([\s\S]*?)<\/tweet>/gi)]
    .map((match) => match[1].trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  if (tagged.length) return tagged;

  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) {
      const jsonCandidates = parsed
        .map((item) => (typeof item === "string" ? item : item?.text))
        .filter(Boolean);
      if (jsonCandidates.length) return jsonCandidates;
    }
  } catch {
    // Continue with plain-text parsing.
  }

  const numbered = raw
    .split(/(?:^|\n)\s*(?:(?:candidate|tweet)\s*)?\d+[.):\-]\s*/i)
    .map((block) => block.trim())
    .filter(Boolean);
  if (numbered.length >= 3) return numbered;

  return raw
    .split(/\r?\n\s*\n|\s*---+\s*/)
    .map((block) => block.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((block) => block.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function compactMoneyValues(text) {
  return [...text.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)([kmbt])?/gi)].map((match) => {
    const number = Number(match[1].replaceAll(",", ""));
    const multiplier = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]?.toLowerCase()] || 1;
    return number * multiplier;
  });
}

function percentValues(text) {
  return [...text.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Math.abs(Number(match[1])));
}

function closeTo(value, expected, relativeTolerance, absoluteTolerance = 0) {
  return Math.abs(value - expected) <= Math.max(Math.abs(expected) * relativeTolerance, absoluteTolerance);
}

export function deriveSnapshotMetrics(snapshot) {
  const range = snapshot.high7d - snapshot.low7d || 1;
  return {
    rangePercent: (range / snapshot.low7d) * 100,
    positionPercent: ((snapshot.price - snapshot.low7d) / range) * 100,
    aboveLowPercent: ((snapshot.price - snapshot.low7d) / snapshot.low7d) * 100,
    belowHighPercent: ((snapshot.high7d - snapshot.price) / snapshot.price) * 100,
    turnoverPercent: (snapshot.volume24h / snapshot.marketCap) * 100,
  };
}

const SIMILARITY_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "at", "in", "on", "of", "to", "is", "its", "it",
  "this", "that", "with", "for", "after", "over", "today", "current", "btc", "bitcoin",
]);

function similarityTokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/\$?\d[\d,.]*%?[kmbt]?/gi, " number ")
      .replace(/[^a-z]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !SIMILARITY_STOP_WORDS.has(word)),
  );
}

export function candidateSimilarity(left, right) {
  const leftTokens = similarityTokens(left);
  const rightTokens = similarityTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

export function classifyAngle(text) {
  const value = String(text).toLowerCase();
  if (/\?$/.test(value.trim())) return "question";
  if (/market cap|turnover|24h volume/.test(value)) return "turnover";
  if (/close (?:above|below|back inside)|break(?:s|ing)? (?:the )?(?:current )?range|reclaiming|holding that level/.test(value)) return "range_break";
  if (/above (?:its |the )?7d low|below (?:its |the )?7d high|closer to|lower end|upper end|edge (?:gets|is)/.test(value)) return "edge_distance";
  if (/lower third|middle third|upper third|position in|sits in the/.test(value)) return "range_position";
  if (/range (?:spans|width)|entire 7d range|wider move/.test(value)) return "range_width";
  if (/24h.*7d|7d.*24h|timeframes|weekly direction/.test(value)) return "timeframe_comparison";
  return "observation";
}

export function candidateNoveltyScore(candidate, recentTweets = []) {
  const recent = recentTweets.slice(0, 6);
  if (!recent.length) return 1;
  const maxSimilarity = Math.max(...recent.map((tweet) => candidateSimilarity(candidate, tweet)));
  const sameAngleRecently = recent.slice(0, 3)
    .some((tweet) => classifyAngle(tweet) === classifyAngle(candidate));
  return Math.max(0, 1 - maxSimilarity - (sameAngleRecently ? 0.25 : 0));
}

export function isNovelCandidate(candidate, recentTweets = [], threshold = 0.46) {
  return recentTweets.slice(0, 6)
    .every((tweet) => candidateSimilarity(candidate, tweet) < threshold);
}

export function validateCandidate(text, snapshot) {
  if (typeof text !== "string" || text.length < 35 || text.length > 210) return false;
  if (BANNED_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const money = compactMoneyValues(text);
  const percentages = percentValues(text);
  const allowedMoney = [
    snapshot.price,
    snapshot.low7d,
    snapshot.high7d,
    snapshot.volume24h,
    snapshot.marketCap,
  ].filter(Number.isFinite);
  const metrics = deriveSnapshotMetrics(snapshot);
  const allowedPercentages = [
    Math.abs(snapshot.change24h),
    Math.abs(snapshot.change7d),
    ...Object.values(metrics).map(Math.abs),
  ].filter(Number.isFinite);

  const allMoneyVerified = money.every((value) =>
    allowedMoney.some((expected) => closeTo(value, expected, expected < 1e6 ? 0.0001 : 0.015, 75)),
  );
  const allPercentagesVerified = percentages.every((value) =>
    allowedPercentages.some((expected) => closeTo(value, expected, 0.03, 0.11)),
  );
  const hasCurrentPrice = money.some((value) => closeTo(value, snapshot.price, 0.0001, 75));
  const has24hMove = percentages.some((value) =>
    closeTo(value, Math.abs(snapshot.change24h), 0.03, 0.11),
  );

  return allMoneyVerified && allPercentagesVerified && (hasCurrentPrice || has24hMove);
}

export function selectCandidates(batch, snapshot, recentTweets = []) {
  const generalCount = batch.length >= 8 ? 5 : 4;
  const recentAngles = new Set(recentTweets.slice(0, 3).map(classifyAngle));
  const dayNumber = snapshot.updatedAt instanceof Date
    ? Math.floor(snapshot.updatedAt.getTime() / 86_400_000)
    : 0;
  const filterPool = (pool, offset) => rotate([...new Set(pool)], dayNumber + offset)
    .filter((candidate) => validateCandidate(candidate, snapshot))
    .filter((candidate) => isNovelCandidate(candidate, recentTweets))
    .sort((left, right) => {
      const angleDifference = Number(recentAngles.has(classifyAngle(left))) - Number(recentAngles.has(classifyAngle(right)));
      return angleDifference || candidateNoveltyScore(right, recentTweets) - candidateNoveltyScore(left, recentTweets);
    });
  const general = filterPool(batch.slice(0, generalCount), 0);
  const chart = filterPool(batch.slice(generalCount), 2);
  const first = general[0];
  const second = general.slice(1).find((candidate) =>
    classifyAngle(candidate) !== classifyAngle(first) && candidateSimilarity(candidate, first) < 0.46,
  );
  const image = chart.find((candidate) =>
    [first, second].every((chosen) =>
      classifyAngle(candidate) !== classifyAngle(chosen) && candidateSimilarity(candidate, chosen) < 0.46,
    ),
  );
  return first && second && image ? [first, second, image] : null;
}

function fallbackUsd(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function fallbackCompactUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function rotate(items, offset) {
  if (!items.length) return items;
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export function buildDeterministicCandidatePool(snapshot) {
  const price = fallbackUsd(snapshot.price);
  const low = fallbackUsd(snapshot.low7d);
  const high = fallbackUsd(snapshot.high7d);
  const volume = fallbackCompactUsd(snapshot.volume24h);
  const marketCap = fallbackCompactUsd(snapshot.marketCap);
  const change24h = Math.abs(snapshot.change24h).toFixed(2);
  const change7d = Math.abs(snapshot.change7d).toFixed(2);
  const move24h = snapshot.change24h >= 0 ? "up" : "down";
  const move7d = snapshot.change7d >= 0 ? "up" : "down";
  const metrics = deriveSnapshotMetrics(snapshot);
  const rangePosition = metrics.positionPercent < 33.33
    ? "lower"
    : metrics.positionPercent > 66.67 ? "upper" : "middle";
  const timeframeRead = Math.sign(snapshot.change24h) === Math.sign(snapshot.change7d)
    ? `Both timeframes point ${move24h}.`
    : "The daily move runs against the weekly direction.";
  const nearerEdge = Math.abs(metrics.aboveLowPercent) <= Math.abs(metrics.belowHighPercent)
    ? "low"
    : "high";
  const edgeObservation = snapshot.price < snapshot.low7d
    ? `At ${price}, BTC is ${Math.abs(metrics.aboveLowPercent).toFixed(2)}% below its 7d low of ${low}. Price remains outside the recent range.`
    : snapshot.price > snapshot.high7d
      ? `At ${price}, BTC is ${Math.abs(metrics.belowHighPercent).toFixed(2)}% above its 7d high of ${high}. Price remains outside the recent range.`
      : `At ${price}, BTC is ${metrics.aboveLowPercent.toFixed(2)}% above its 7d low and ${metrics.belowHighPercent.toFixed(2)}% below its 7d high. Price is closer to the ${nearerEdge} edge.`;
  const chartEdgeObservation = snapshot.price < snapshot.low7d || snapshot.price > snapshot.high7d
    ? `The 7d chart puts BTC at ${price}, outside the ${low}–${high} range after moving ${move24h} ${change24h}% in 24h.`
      : `The 7d chart puts BTC at ${price}, ${metrics.aboveLowPercent.toFixed(2)}% above the low and ${metrics.belowHighPercent.toFixed(2)}% below the high. The ${nearerEdge} is nearer.`;
  const rangeScale = Math.abs(snapshot.change24h) * 3 < metrics.rangePercent
    ? "less than one-third"
    : "more than one-third";

  let conditional;
  if (snapshot.price <= snapshot.low7d) {
    conditional = `BTC is ${move24h} ${change24h}% in 24h at ${price}, below the 7d low of ${low}. Reclaiming that level would put price back inside the recent range.`;
  } else if (snapshot.price >= snapshot.high7d) {
    conditional = `BTC is ${move24h} ${change24h}% in 24h at ${price}, above the 7d high of ${high}. Holding that level would keep price outside the recent range.`;
  } else {
    conditional = `BTC is ${move24h} ${change24h}% in 24h at ${price}. A close below the 7d low of ${low} would break the current range; staying above it keeps the range intact.`;
  }

  return [
    { angle: "timeframe_comparison", chart: false, text: `BTC at ${price}: ${move24h} ${change24h}% in 24h and ${move7d} ${change7d}% over 7d. ${timeframeRead}` },
    { angle: "turnover", chart: false, text: `BTC traded ${volume} in 24h, about ${metrics.turnoverPercent.toFixed(2)}% of its ${marketCap} market cap. Price is ${price}; this is a turnover snapshot, not a direction signal.` },
    { angle: "question", chart: false, text: `BTC is ${move24h} ${change24h}% in 24h at ${price}. With the 7d band at ${low}–${high}, which edge is more likely to be tested next?` },
    { angle: "range_break", chart: false, text: conditional },
    { angle: "edge_distance", chart: false, text: edgeObservation },
    { angle: "range_position", chart: true, text: `BTC at ${price} sits in the ${rangePosition} third of its 7d range (${low}–${high}) after moving ${move24h} ${change24h}% in 24h.` },
    { angle: "range_width", chart: true, text: `BTC moved ${move24h} ${change24h}% in 24h at ${price}, while its 7d range spans ${metrics.rangePercent.toFixed(2)}% (${low}–${high}). The daily move is ${rangeScale} of that range.` },
    { angle: "edge_distance", chart: true, text: chartEdgeObservation },
  ];
}

export function buildDeterministicCandidates(snapshot, recentTweets = []) {
  const pool = buildDeterministicCandidatePool(snapshot);
  const dateValue = snapshot.updatedAt instanceof Date ? snapshot.updatedAt : new Date();
  const dayNumber = Math.floor(dateValue.getTime() / 86_400_000);
  const recentAngles = new Set(recentTweets.slice(0, 3).map(classifyAngle));
  const choose = (items, count, usedAngles) => {
    const rotated = rotate(items, dayNumber);
    const passes = [
      (item) => !recentAngles.has(item.angle) && isNovelCandidate(item.text, recentTweets) && !usedAngles.has(item.angle),
      (item) => isNovelCandidate(item.text, recentTweets) && !usedAngles.has(item.angle),
      (item) => !usedAngles.has(item.angle),
      () => true,
    ];
    const chosen = [];
    for (const pass of passes) {
      for (const item of rotated) {
        if (chosen.length >= count) break;
        if (!chosen.includes(item) && pass(item)) {
          chosen.push(item);
          usedAngles.add(item.angle);
        }
      }
      if (chosen.length >= count) break;
    }
    return chosen;
  };
  const usedAngles = new Set();
  const general = choose(pool.filter((item) => !item.chart), 2, usedAngles);
  const chart = choose(pool.filter((item) => item.chart), 1, usedAngles);
  return [...general, ...chart].map((item) => item.text);
}

function plainTelegramText(messageText) {
  return String(messageText || "")
    .replace(/<\/?(?:b|strong|i|em|u|s|code|pre)(?:\s[^>]*)?>/gi, "")
    .replace(/<a\b[^>]*>|<\/a>/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function extractDailyCandidate(messageText, candidateIndex) {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 2) return null;
  const plainText = plainTelegramText(messageText);
  const number = candidateIndex + 1;
  const nextSection = number < 3 ? `Predlog ${number + 1}:` : "Market snapshot:";
  const pattern = new RegExp(`Predlog ${number}:\\n([\\s\\S]+?)\\n\\n${nextSection}`);
  return plainText.match(pattern)?.[1]?.trim() || null;
}

export function extractQuoteCandidate(messageText) {
  const plainText = plainTelegramText(messageText);
  return plainText.match(/Predlog odgovora:\n([\s\S]+?)\n\n[^\n]*Otvori tweet/)?.[1]?.trim() || null;
}

export function isApprovalFresh(messageDateSeconds, nowMs = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const messageMs = Number(messageDateSeconds) * 1000;
  if (!Number.isFinite(messageMs) || messageMs <= 0) return false;
  const ageMs = nowMs - messageMs;
  return ageMs >= -60_000 && ageMs <= maxAgeMs;
}

export function isUsefulReply(text) {
  if (typeof text !== "string") return false;
  const normalized = text.trim();
  if (/^SKIP[.!]?$/i.test(normalized)) return false;
  if (normalized.length < 25 || normalized.length > 220) return false;
  if (BANNED_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return !/#\w+/.test(normalized);
}
