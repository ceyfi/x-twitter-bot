import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicCandidatePool,
  buildDeterministicCandidates,
  candidateSimilarity,
  classifyAngle,
  deriveMarketMetrics,
  extractDailyCandidate,
  extractQuoteCandidate,
  hasSameNumericFacts,
  isApprovalFresh,
  isUsefulReply,
  parseCandidates,
  selectCandidates,
  validateCandidate,
} from "../lib/content-validation.js";

const snapshot = {
  price: 63_050,
  change24h: -1.4,
  change7d: -1.59,
  volume24h: 22_200_000_000,
  marketCap: 1_240_000_000_000,
  low7d: 62_563,
  high7d: 65_439,
};

const marketSnapshot = {
  ...snapshot,
  updatedAt: new Date("2026-08-16T10:00:00Z"),
  assets: [
    { id: "bitcoin", symbol: "BTC", price: 63_050, change24h: 0.3, change7d: -3, volume24h: 9_000_000_000, marketCap: 1_240_000_000_000 },
    { id: "ethereum", symbol: "ETH", price: 1_850, change24h: 0.2, change7d: -1.9, volume24h: 7_000_000_000, marketCap: 223_000_000_000 },
    { id: "binancecoin", symbol: "BNB", price: 620, change24h: -0.7, change7d: 0.4, volume24h: 800_000_000, marketCap: 86_000_000_000 },
    { id: "ripple", symbol: "XRP", price: 1.2, change24h: 0.8, change7d: -2.1, volume24h: 2_000_000_000, marketCap: 72_000_000_000 },
    { id: "solana", symbol: "SOL", price: 92, change24h: 1.8, change7d: 5.4, volume24h: 3_000_000_000, marketCap: 50_000_000_000 },
    { id: "tron", symbol: "TRX", price: 0.31, change24h: 0.4, change7d: 1.2, volume24h: 600_000_000, marketCap: 29_000_000_000 },
  ],
  global: {
    totalMarketCap: 2_250_000_000_000,
    totalVolume: 72_000_000_000,
    marketCapChange24h: 0.09,
    btcDominance: 56.16,
  },
};

test("parses tagged, JSON and numbered candidate formats", () => {
  assert.deepEqual(parseCandidates("<tweet>One</tweet><tweet>Two</tweet>"), ["One", "Two"]);
  assert.deepEqual(parseCandidates('[{"text":"One"},"Two"]'), ["One", "Two"]);
  assert.deepEqual(parseCandidates("1. One\n2. Two\n3. Three"), ["One", "Two", "Three"]);
});

test("selects two general posts and one separately validated chart post", () => {
  const batch = [
    "BTC at $63,050 is testing the lower end of its 7d range after today's move.",
    "BTC is down 1.40% today. A close back inside the range would weaken the bearish read.",
    "BTC at $70,000 is breaking out on an unsupported price claim.",
    "BTC is down 10% today according to an unsupported percentage claim.",
    "BTC at $63,050 sits between the 7d low of $62,563 and high of $65,439 on this chart.",
    "The chart says BTC is at an unsupported $70,000 today.",
  ];
  assert.deepEqual(selectCandidates(batch, snapshot), [batch[0], batch[1], batch[4]]);
});

test("deterministic fallback always returns three locally valid candidates", () => {
  for (const price of [62_500, 63_050, 65_500]) {
    const variant = { ...snapshot, price };
    const candidates = buildDeterministicCandidates(variant);
    assert.equal(candidates.length, 3);
    assert.equal(new Set(candidates).size, 3);
    assert.equal(candidates.every((candidate) => validateCandidate(candidate, variant)), true);
  }
});

test("all rotating fallback formats pass factual validation", () => {
  const variant = { ...snapshot, updatedAt: new Date("2026-08-06T10:00:00Z") };
  const pool = buildDeterministicCandidatePool(variant);
  assert.equal(pool.length, 8);
  assert.equal(pool.every((item) => validateCandidate(item.text, variant)), true);
});

test("detects repeated range-break language even when market numbers change", () => {
  const previous = "BTC is down 1.50% at $62,615. A close below the 7d low of $62,457 would break the current range; staying above it keeps the range intact.";
  const candidate = "BTC is up 0.60% at $63,264. A close below the 7d low of $62,457 would break the current range; staying above it keeps the range intact.";
  assert.equal(classifyAngle(candidate), "range_break");
  assert.ok(candidateSimilarity(previous, candidate) > 0.7);
});

test("rotating fallback avoids a recently used angle and changes across days", () => {
  const recent = ["BTC is down 1.50% at $62,615. A close below the 7d low would break the current range."];
  const dayOne = buildDeterministicCandidates(
    { ...snapshot, updatedAt: new Date("2026-08-06T10:00:00Z") },
    recent,
  );
  const dayTwo = buildDeterministicCandidates(
    { ...snapshot, updatedAt: new Date("2026-08-07T10:00:00Z") },
    recent,
  );
  assert.equal(dayOne.some((candidate) => classifyAngle(candidate) === "range_break"), false);
  assert.notDeepEqual(dayOne, dayTwo);
});

test("Claude selection rotates without X context and keeps all three angles distinct", () => {
  const firstSnapshot = { ...snapshot, updatedAt: new Date("2026-08-06T10:00:00Z") };
  const nextSnapshot = { ...snapshot, updatedAt: new Date("2026-08-07T10:00:00Z") };
  const batch = buildDeterministicCandidatePool(firstSnapshot).map((item) => item.text);
  const first = selectCandidates(batch, firstSnapshot);
  const next = selectCandidates(batch, nextSnapshot);
  assert.equal(new Set(first.map(classifyAngle)).size, 3);
  assert.notDeepEqual(first, next);
});

test("market snapshot creates genuinely different cross-market topics", () => {
  const metrics = deriveMarketMetrics(marketSnapshot);
  assert.equal(metrics.leader.symbol, "SOL");
  assert.equal(metrics.laggard.symbol, "BNB");

  const pool = buildDeterministicCandidatePool(marketSnapshot);
  const generalAngles = new Set(pool.filter((item) => !item.chart).map((item) => item.angle));
  assert.ok(generalAngles.has("btc_eth_24h"));
  assert.ok(generalAngles.has("market_breadth"));
  assert.ok(generalAngles.has("market_dispersion"));
  assert.ok(generalAngles.has("market_overview"));
  assert.equal(pool.every((item) => validateCandidate(item.text, marketSnapshot)), true);
});

test("market candidates avoid the old BTC-only fallback cycle", () => {
  const recent = [
    "BTC at $63,162: up 0.30% in 24h and down 3.21% over 7d. The daily move runs against the weekly direction.",
    "At $63,013, BTC is 0.70% above its 7d low and 3.53% below its 7d high. Price is closer to the low edge.",
    "BTC is down 0.20% in 24h at $63,425. With the 7d band at $63,305–$65,235, which edge is more likely to be tested next?",
  ];
  const candidates = buildDeterministicCandidates(marketSnapshot, recent);
  assert.equal(candidates.length, 3);
  assert.ok(classifyAngle(candidates[0]).startsWith("btc_eth") || classifyAngle(candidates[0]).startsWith("market_"));
  assert.ok(classifyAngle(candidates[1]).startsWith("btc_eth") || classifyAngle(candidates[1]).startsWith("market_") || classifyAngle(candidates[1]) === "major_leader");
  assert.notEqual(classifyAngle(candidates[0]), classifyAngle(candidates[1]));
});

test("Claude rewrite must preserve every numeric fact", () => {
  const draft = "BTC is +0.30% and ETH -1.20% over 24h while BTC trades at $63,050.";
  const safeRewrite = "Over 24h, ETH is -1.20% and BTC +0.30%, with BTC trading at $63,050.";
  const changedFact = "Over 24h, ETH is -1.10% and BTC +0.30%, with BTC trading at $63,050.";
  assert.equal(hasSameNumericFacts(safeRewrite, draft), true);
  assert.equal(hasSameNumericFacts(changedFact, draft), false);
});

test("accepts only candidates anchored to verified snapshot numbers", () => {
  assert.equal(
    validateCandidate(
      "BTC at $63,050, down 1.40% today. A close below $62,563 would weaken the current 7d range.",
      snapshot,
    ),
    true,
  );
  assert.equal(
    validateCandidate("BTC at $70,000 would confirm a breakout despite today's 1.40% decline.", snapshot),
    false,
  );
  assert.equal(
    validateCandidate("BTC at $63,200 is holding firm after today's verified 1.40% decline.", snapshot),
    false,
  );
  assert.equal(
    validateCandidate("BTC is down 10% today, making this the week's most important move.", snapshot),
    false,
  );
  assert.equal(
    validateCandidate("BTC is down 1.40% today. Does the current range hold into the close?", snapshot),
    true,
  );
});

test("extracts daily candidates from plain and HTML-formatted captions", () => {
  const plain = "Predlog 1:\nFirst candidate text.\n\nPredlog 2:\nSecond & candidate.\n\nPredlog 3:\nThird candidate.\n\nMarket snapshot: $63,050";
  const html = "<b>Predlog 1:</b>\nFirst candidate text.\n\n<b>Predlog 2:</b>\nSecond &amp; candidate.\n\n<b>Predlog 3:</b>\nThird candidate.\n\n<b>Market snapshot:</b> $63,050";
  assert.equal(extractDailyCandidate(plain, 1), "Second & candidate.");
  assert.equal(extractDailyCandidate(html, 1), "Second & candidate.");
  assert.equal(extractDailyCandidate(plain, 2), "Third candidate.");
  assert.equal(extractDailyCandidate(plain, 3), null);
});

test("extracts reply candidates without depending on emoji encoding", () => {
  const message = "Reply suggestion\n\nPredlog odgovora:\nConcrete reply text here.\n\n🔗 Otvori tweet";
  assert.equal(extractQuoteCandidate(message), "Concrete reply text here.");
});

test("approval expires after 24 hours", () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  assert.equal(isApprovalFresh(now / 1000, now), true);
  assert.equal(isApprovalFresh((now - 24 * 60 * 60 * 1000) / 1000, now), true);
  assert.equal(isApprovalFresh((now - 24 * 60 * 60 * 1000 - 1000) / 1000, now), false);
  assert.equal(isApprovalFresh(undefined, now), false);
});

test("reply validation rejects SKIP, slogans, hashtags and bad lengths", () => {
  assert.equal(isUsefulReply("SKIP"), false);
  assert.equal(isUsefulReply("Useful counterpoint: falling volume makes that breakout less convincing."), true);
  assert.equal(isUsefulReply("We are still early, so zoom out and trust the cycle."), false);
  assert.equal(isUsefulReply("Concrete thought with enough length but also #bitcoin"), false);
});
