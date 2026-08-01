const DAY_MS = 24 * 60 * 60 * 1000;
const BELGRADE_TIME_ZONE = "Europe/Belgrade";

function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function scheduledReference(now, scheduledCron = "") {
  const hourMatch = scheduledCron.match(/^0\s+(17|18)\s+\*\s+\*\s+\*$/);
  if (!hourMatch) return now;
  const reference = new Date(now);
  reference.setUTCHours(Number(hourMatch[1]), 0, 0, 0);
  return reference;
}

export function getAutoScheduleState(
  now = new Date(),
  scheduledCron = "",
  startDate = process.env.AUTO_POST_START_DATE || "2026-08-02",
) {
  const reference = scheduledReference(now, scheduledCron);
  const parts = localParts(reference);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const startDay = Date.parse(`${startDate}T00:00:00Z`);
  const daysSinceStart = Math.floor((localDay - startDay) / DAY_MS);
  const validStart = Number.isFinite(startDay);

  return {
    localDate,
    localHour: Number(parts.hour),
    eligibleDay: validStart && daysSinceStart >= 0 && daysSinceStart % 2 === 0,
    shouldRun: validStart && Number(parts.hour) === 19 && daysSinceStart >= 0 && daysSinceStart % 2 === 0,
  };
}

export function hasRecentPost(tweets, nowMs = Date.now(), windowMs = DAY_MS) {
  const cutoff = nowMs - windowMs;
  return tweets.some((tweet) => {
    const createdAt = Date.parse(tweet.created_at);
    return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= nowMs + 60_000;
  });
}
