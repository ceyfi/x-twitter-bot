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
  return [...text.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)([kmb])?/gi)].map((match) => {
    const number = Number(match[1].replaceAll(",", ""));
    const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] || 1;
    return number * multiplier;
  });
}

function percentValues(text) {
  return [...text.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Math.abs(Number(match[1])));
}

function closeTo(value, expected, relativeTolerance, absoluteTolerance = 0) {
  return Math.abs(value - expected) <= Math.max(Math.abs(expected) * relativeTolerance, absoluteTolerance);
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
  const rangePercent = ((snapshot.high7d - snapshot.low7d) / snapshot.low7d) * 100;
  const allowedPercentages = [
    Math.abs(snapshot.change24h),
    Math.abs(snapshot.change7d),
    Math.abs(rangePercent),
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

export function selectCandidates(batch, snapshot) {
  const general = [...new Set(batch.slice(0, 4))]
    .filter((candidate) => validateCandidate(candidate, snapshot));
  const chart = [...new Set(batch.slice(4, 6))]
    .filter((candidate) => validateCandidate(candidate, snapshot));
  return general.length >= 2 && chart.length >= 1
    ? [general[0], general[1], chart[0]]
    : null;
}

function fallbackUsd(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function buildDeterministicCandidates(snapshot) {
  const price = fallbackUsd(snapshot.price);
  const low = fallbackUsd(snapshot.low7d);
  const high = fallbackUsd(snapshot.high7d);
  const change = Math.abs(snapshot.change24h).toFixed(2);
  const move = snapshot.change24h >= 0 ? "up" : "down";
  const range = snapshot.high7d - snapshot.low7d || 1;
  const position = (snapshot.price - snapshot.low7d) / range;
  const rangePosition = position < 1 / 3 ? "lower" : position > 2 / 3 ? "upper" : "middle";

  let conditional;
  if (snapshot.price <= snapshot.low7d) {
    conditional = `BTC is ${move} ${change}% in 24h at ${price}, below the 7d low of ${low}. Reclaiming that level would put price back inside the recent range.`;
  } else if (snapshot.price >= snapshot.high7d) {
    conditional = `BTC is ${move} ${change}% in 24h at ${price}, above the 7d high of ${high}. Holding that level would keep price outside the recent range.`;
  } else {
    conditional = `BTC is ${move} ${change}% in 24h at ${price}. A close below the 7d low of ${low} would break the current range; staying above it keeps the range intact.`;
  }

  return [
    `BTC at ${price}, ${move} ${change}% over 24h. The current 7d range runs from ${low} to ${high}, which keeps today's move in context.`,
    conditional,
    `BTC's 7d range is ${low}–${high}. At ${price} after a ${change}% 24h move, price sits in the ${rangePosition} third of the band.`,
  ];
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
