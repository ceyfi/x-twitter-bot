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
  return [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:%|pp\b)/gi)]
    .map((match) => Math.abs(Number(match[1])));
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

export function deriveMarketMetrics(snapshot) {
  const assets = Array.isArray(snapshot.assets)
    ? snapshot.assets.filter((asset) =>
      asset && Number.isFinite(asset.change24h) && Number.isFinite(asset.change7d),
    )
    : [];
  const btc = assets.find((asset) => asset.id === "bitcoin");
  const eth = assets.find((asset) => asset.id === "ethereum");
  if (assets.length < 4 || !btc || !eth) return null;

  const leader = assets.reduce((best, asset) => asset.change24h > best.change24h ? asset : best);
  const laggard = assets.reduce((worst, asset) => asset.change24h < worst.change24h ? asset : worst);
  const upCount = assets.filter((asset) => asset.change24h > 0).length;
  const global = snapshot.global || {};
  const globalTurnoverPercent = Number.isFinite(global.totalVolume) && Number.isFinite(global.totalMarketCap)
    ? (global.totalVolume / global.totalMarketCap) * 100
    : null;

  return {
    assets,
    btc,
    eth,
    leader,
    laggard,
    breadthPercent: (upCount / assets.length) * 100,
    btcEthSpread24h: Math.abs(btc.change24h - eth.change24h),
    btcEthSpread7d: Math.abs(btc.change7d - eth.change7d),
    dispersionPercent: leader.change24h - laggard.change24h,
    btcMarketSpread24h: Number.isFinite(global.marketCapChange24h)
      ? Math.abs(btc.change24h - global.marketCapChange24h)
      : null,
    globalTurnoverPercent,
  };
}

export function assessContentSignal(snapshot) {
  const metrics = deriveSnapshotMetrics(snapshot);
  const market = deriveMarketMetrics(snapshot);
  const signals = [];
  let score = 0;
  const add = (points, label) => {
    score += points;
    signals.push(label);
  };

  const dailyMove = Math.abs(snapshot.change24h);
  const weeklyMove = Math.abs(snapshot.change7d);
  if (dailyMove >= 2.5) add(2, "large BTC daily move");
  else if (dailyMove >= 1.25) add(1, "meaningful BTC daily move");
  if (weeklyMove >= 7) add(2, "large BTC weekly move");
  else if (weeklyMove >= 4) add(1, "meaningful BTC weekly move");
  if (metrics.positionPercent <= 12 || metrics.positionPercent >= 88) {
    add(1, "BTC near a 7d range edge");
  }

  if (market) {
    if (market.dispersionPercent >= 6) add(2, "large cross-market dispersion");
    else if (market.dispersionPercent >= 3.5) add(1, "cross-market dispersion");
    if (market.breadthPercent <= 25 || market.breadthPercent >= 75) {
      add(1, "extreme market breadth");
    }
    if (market.btcEthSpread24h >= 2 || market.btcEthSpread7d >= 6) {
      add(1, "clear BTC/ETH relative strength");
    }
    if (market.assets.some((asset) => Math.abs(asset.change24h) >= 5)) {
      add(1, "major coin moved at least 5%");
    }
  }

  return {
    score,
    publishable: score >= 2,
    signals,
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
  if (/(?:\bbtc\b.*\beth\b|\beth\b.*\bbtc\b)/.test(value)) {
    return /7d|seven.day|weekly/.test(value) ? "btc_eth_7d" : "btc_eth_24h";
  }
  if (/market breadth|tracked non-stable|tracked majors are green|majors are up|majors are green/.test(value)) return "market_breadth";
  if (/dispersion|leader.laggard|strongest major|weakest major|selection matters more than direction/.test(value)) return "market_dispersion";
  if (/leads (?:the tracked )?majors|short-term leadership/.test(value)) return "major_leader";
  if (/market-wide turnover|crypto-wide turnover|turnover across crypto/.test(value)) return "market_turnover";
  if (/btc dominance|bitcoin dominance/.test(value)) return "btc_dominance";
  if (/total crypto market cap|broader market/.test(value)) return "market_overview";
  if (/\?$/.test(value.trim())) return "question";
  if (/market cap|turnover|24h volume/.test(value)) return "turnover";
  if (/close (?:above|below|back inside)|break(?:s|ing)? (?:the )?(?:current )?range|reclaiming|holding that level|line that changes the read|range is noise/.test(value)) return "range_break";
  if (/above (?:its |the )?(?:7d )?low|below (?:its |the )?(?:7d )?high|closer to|lower end|upper end|edge (?:gets|is)|(?:low|high) is nearer/.test(value)) return "edge_distance";
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
    ...(snapshot.assets || []).flatMap((asset) => [asset.price, asset.volume24h, asset.marketCap]),
    snapshot.global?.totalMarketCap,
    snapshot.global?.totalVolume,
  ].filter(Number.isFinite);
  const metrics = deriveSnapshotMetrics(snapshot);
  const marketMetrics = deriveMarketMetrics(snapshot);
  const allowedPercentages = [
    Math.abs(snapshot.change24h),
    Math.abs(snapshot.change7d),
    ...Object.values(metrics).map(Math.abs),
    ...(snapshot.assets || []).flatMap((asset) => [Math.abs(asset.change24h), Math.abs(asset.change7d)]),
    Math.abs(snapshot.global?.marketCapChange24h),
    Math.abs(snapshot.global?.btcDominance),
    marketMetrics?.breadthPercent,
    marketMetrics?.btcEthSpread24h,
    marketMetrics?.btcEthSpread7d,
    marketMetrics?.dispersionPercent,
    marketMetrics?.btcMarketSpread24h,
    marketMetrics?.globalTurnoverPercent,
  ].filter(Number.isFinite);

  const allMoneyVerified = money.every((value) => allowedMoney.some((expected) => {
    if (expected >= 1e6) return closeTo(value, expected, 0.015);
    if (expected >= 10_000) return closeTo(value, expected, 0.0001, 75);
    if (expected >= 100) return closeTo(value, expected, 0.001, 1);
    return closeTo(value, expected, 0.01, 0.02);
  }));
  const allPercentagesVerified = percentages.every((value) =>
    allowedPercentages.some((expected) => closeTo(value, expected, 0.03, 0.11)),
  );
  return allMoneyVerified && allPercentagesVerified && (money.length > 0 || percentages.length > 0);
}

function numericFactTokens(text) {
  return (String(text).match(/\$?-?\d+(?:,\d{3})*(?:\.\d+)?(?:%|pp|[kmbt])?/gi) || [])
    .map((token) => token.toLowerCase().replaceAll(",", ""))
    .sort();
}

export function hasSameNumericFacts(candidate, factLockedDraft) {
  const candidateFacts = numericFactTokens(candidate);
  const draftFacts = numericFactTokens(factLockedDraft);
  return candidateFacts.length === draftFacts.length &&
    candidateFacts.every((fact, index) => fact === draftFacts[index]);
}

export function selectCandidates(batch, snapshot, recentTweets = []) {
  const generalCount = Math.max(0, batch.length - 2);
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

function signedPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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
  const nearerEdge = Math.abs(metrics.aboveLowPercent) <= Math.abs(metrics.belowHighPercent)
    ? "low"
    : "high";
  const aligned = Math.sign(snapshot.change24h) === Math.sign(snapshot.change7d);

  let rangeSetup;
  if (snapshot.price <= snapshot.low7d) {
    rangeSetup = `The line that changes the read is ${low}. BTC is ${price}, below its 7d low after moving ${move24h} ${change24h}% in 24h. Reclaim it and the breakdown weakens; stay below and it remains live.`;
  } else if (snapshot.price >= snapshot.high7d) {
    rangeSetup = `The line that changes the read is ${high}. BTC is ${price}, above its 7d high after moving ${move24h} ${change24h}% in 24h. Hold it and the breakout stays live; lose it and price is back in range.`;
  } else {
    rangeSetup = `The line that changes the read is ${nearerEdge === "low" ? low : high}. BTC is ${price}, inside its ${low}–${high} 7d range. Until the nearer edge breaks, this remains a range trade—not a new trend.`;
  }

  const legacyPool = [
    {
      angle: "timeframe_comparison",
      pillar: "insight",
      chart: false,
      text: `BTC is ${move24h} ${change24h}% in 24h and ${move7d} ${change7d}% over 7d at ${price}. ${aligned ? "Both timeframes agree: this is continuation, not a one-day outlier." : "The timeframes disagree, so one daily candle is not a trend."}`,
    },
    {
      angle: "turnover",
      pillar: "insight",
      chart: false,
      text: `Price gets attention; participation gives it context. BTC traded ${volume} in 24h, or ${metrics.turnoverPercent.toFixed(2)}% of its ${marketCap} market cap. Activity is not conviction by itself.`,
    },
    { angle: "range_break", pillar: "setup", chart: false, text: rangeSetup },
    {
      angle: "question",
      pillar: "setup",
      chart: false,
      text: `BTC is ${price}, ${metrics.aboveLowPercent.toFixed(2)}% above its 7d low and ${metrics.belowHighPercent.toFixed(2)}% below its high. Which edge would actually change your view—and what would you do if neither breaks?`,
    },
    {
      angle: "range_position",
      pillar: "chart",
      chart: true,
      text: nearerEdge === "high"
        ? `BTC is ${metrics.belowHighPercent.toFixed(2)}% below its 7d high of ${high}, now at ${price}. This chart has one question: breakout and hold, or another rejection into the range?`
        : `BTC is ${metrics.aboveLowPercent.toFixed(2)}% above its 7d low of ${low}, now at ${price}. This chart has one question: breakdown and stay below, or another bounce into the range?`,
    },
    {
      angle: "range_width",
      pillar: "chart",
      chart: true,
      text: `BTC's entire 7d range is ${metrics.rangePercent.toFixed(2)}%, from ${low} to ${high}. Price is ${price}. The useful question on this chart is not up or down—it is whether volatility is expanding or being rejected.`,
    },
  ];

  const market = deriveMarketMetrics(snapshot);
  if (!market) return legacyPool;

  const btc24h = signedPercent(market.btc.change24h);
  const eth24h = signedPercent(market.eth.change24h);
  const btc7d = signedPercent(market.btc.change7d);
  const eth7d = signedPercent(market.eth.change7d);
  const pairLeader24h = market.btc.change24h >= market.eth.change24h ? "BTC" : "ETH";
  const pairLeader7d = market.btc.change7d >= market.eth.change7d ? "BTC" : "ETH";
  const leaderSymbol = market.leader.symbol.toUpperCase();
  const laggardSymbol = market.laggard.symbol.toUpperCase();
  const ethLeads7d = market.eth.change7d > market.btc.change7d;

  const insights = [
    {
      angle: "btc_eth_24h",
      pillar: "insight",
      strength: market.btcEthSpread24h,
      chart: false,
      text: `BTC and ETH are telling different stories.\n\nBTC ${btc24h}; ETH ${eth24h}. ${pairLeader24h} leads by ${market.btcEthSpread24h.toFixed(2)}pp. Relative strength favors ${pairLeader24h}, even with BTC at ${price}.`,
    },
    {
      angle: "btc_eth_7d",
      pillar: "insight",
      strength: market.btcEthSpread7d / 2,
      chart: false,
      text: `The weekly winner is ${pairLeader7d}.\n\nBTC ${btc7d}; ETH ${eth7d}. The gap is ${market.btcEthSpread7d.toFixed(2)}pp. ${ethLeads7d ? "Risk appetite is expanding beyond BTC" : "Capital is preferring the crypto benchmark"}, with BTC at ${price}.`,
    },
    {
      angle: "market_breadth",
      pillar: "insight",
      strength: Math.abs(market.breadthPercent - 50) / 12.5,
      chart: false,
      text: `A green BTC candle is not the same as a broad rally.\n\n${market.breadthPercent.toFixed(2)}% of tracked majors are green today. ${leaderSymbol} leads at ${signedPercent(market.leader.change24h)}; BTC is ${btc24h} at ${price}. Participation is the signal.`,
    },
    {
      angle: "market_dispersion",
      pillar: "insight",
      strength: market.dispersionPercent / 2,
      chart: false,
      text: `There is no single “crypto market” today.\n\n${leaderSymbol} is ${signedPercent(market.leader.change24h)}; ${laggardSymbol} is ${signedPercent(market.laggard.change24h)}. That ${market.dispersionPercent.toFixed(2)}pp gap means selection matters more than direction. BTC: ${price}.`,
    },
    {
      angle: "major_leader",
      pillar: "insight",
      strength: Math.abs(market.leader.change24h),
      chart: false,
      text: `Today is a ${leaderSymbol} market, not a BTC market.\n\n${leaderSymbol} leads majors at ${signedPercent(market.leader.change24h)} today and ${signedPercent(market.leader.change7d)} over 7d. ${Math.sign(market.leader.change24h) === Math.sign(market.leader.change7d) ? "Momentum agrees across timeframes." : "Daily strength is fighting the weekly trend."} BTC: ${btc24h} at ${price}.`,
    },
  ];

  if (snapshot.global && Number.isFinite(snapshot.global.marketCapChange24h)) {
    const benchmarkVsBtc = snapshot.global.marketCapChange24h >= market.btc.change24h
      ? "outpacing"
      : "trailing";
    insights.push({
      angle: "market_overview",
      pillar: "insight",
      strength: market.btcMarketSpread24h,
      chart: false,
      text: `${benchmarkVsBtc === "trailing" ? "This move is being led by BTC—not crypto as a whole." : "This move is broader than BTC."}\n\nBTC is ${btc24h}; total crypto market cap is ${signedPercent(snapshot.global.marketCapChange24h)}. The gap is ${market.btcMarketSpread24h.toFixed(2)}pp, with BTC at ${price}.`,
    });
  }
  if (
    snapshot.global &&
    Number.isFinite(snapshot.global.btcDominance) &&
    Number.isFinite(snapshot.global.marketCapChange24h)
  ) {
    const performance = market.btc.change24h >= snapshot.global.marketCapChange24h
      ? "outperforming"
      : "underperforming";
    insights.push({
      angle: "btc_dominance",
      pillar: "insight",
      strength: market.btcMarketSpread24h,
      chart: false,
      text: `Price direction and capital rotation are not the same signal.\n\nBTC dominance is ${snapshot.global.btcDominance.toFixed(2)}%; BTC is ${btc24h} at ${price}. Total crypto cap is ${signedPercent(snapshot.global.marketCapChange24h)}, so BTC is ${performance} the market.`,
    });
  }
  if (Number.isFinite(market.globalTurnoverPercent)) {
    insights.push({
      angle: "market_turnover",
      pillar: "insight",
      strength: Math.abs(market.globalTurnoverPercent - metrics.turnoverPercent),
      chart: false,
      text: `${market.globalTurnoverPercent > metrics.turnoverPercent ? "The action is happening away from BTC." : "BTC is capturing more activity than the wider market."}\n\nCrypto-wide turnover is ${market.globalTurnoverPercent.toFixed(2)}% of market cap versus ${metrics.turnoverPercent.toFixed(2)}% for BTC. BTC is ${btc24h} at ${price}. Activity is not direction.`,
    });
  }

  return [...insights, ...legacyPool.filter((item) => item.pillar !== "insight")];
}

export function buildDeterministicCandidates(snapshot, recentTweets = []) {
  const pool = buildDeterministicCandidatePool(snapshot);
  const dateValue = snapshot.updatedAt instanceof Date ? snapshot.updatedAt : new Date();
  const dayNumber = Math.floor(dateValue.getTime() / 86_400_000);
  const recentAngles = new Set(recentTweets.slice(0, 3).map(classifyAngle));
  const choose = (items, count, usedAngles) => {
    const rotated = rotate(items, dayNumber).sort((left, right) => {
      const recentDifference = Number(recentAngles.has(left.angle)) - Number(recentAngles.has(right.angle));
      return recentDifference || (Number(right.strength || 0) - Number(left.strength || 0));
    });
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
  const insight = choose(pool.filter((item) => item.pillar === "insight"), 1, usedAngles);
  const setup = choose(pool.filter((item) => item.pillar === "setup"), 1, usedAngles);
  const chart = choose(pool.filter((item) => item.pillar === "chart"), 1, usedAngles);
  return [...insight, ...setup, ...chart].map((item) => item.text);
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
