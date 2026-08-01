import { TwitterApi } from "twitter-api-v2";
import {
  fetchMarketSnapshot,
  generateCandidates,
  generateRecommendation,
  telegramRequest,
} from "./api/post-tweet.js";
import { getAutoScheduleState, hasRecentPost } from "./lib/auto-schedule.js";

const REQUIRED_ENV = [
  "TWITTER_CONSUMER_KEY",
  "TWITTER_CONSUMER_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_SECRET",
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
];

function assertConfiguration() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

function createTwitterClient() {
  return new TwitterApi({
    appKey: process.env.TWITTER_CONSUMER_KEY,
    appSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
}

async function notify(text) {
  await telegramRequest("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview: true,
  });
}

async function getAccountTimeline(client) {
  const me = await client.v2.me();
  const timeline = await client.v2.userTimeline(me.data.id, {
    max_results: 10,
    "tweet.fields": ["text", "created_at"],
  });
  const tweets = timeline.data?.data || [];
  if (tweets.some((tweet) => !Number.isFinite(Date.parse(tweet.created_at)))) {
    throw new Error("X timeline did not return valid post timestamps");
  }
  return tweets;
}

async function main() {
  const force = process.env.AUTO_POST_FORCE === "true";
  const schedule = getAutoScheduleState(new Date(), process.env.SCHEDULED_CRON || "");
  if (!force && !schedule.shouldRun) {
    console.log(
      `Auto fallback skipped: ${schedule.localDate} ${schedule.localHour}:00 Europe/Belgrade, eligible=${schedule.eligibleDay}`,
    );
    return;
  }

  assertConfiguration();
  const twitterClient = createTwitterClient();
  const recentTweets = await getAccountTimeline(twitterClient);
  const accountPostedRecently = hasRecentPost(recentTweets);

  if (accountPostedRecently) {
    await notify("ℹ️ Auto fallback je preskočen: nalog već ima objavu u prethodna 24 sata.")
      .catch((error) => console.warn("Could not send Telegram skip notice:", error.message));
    console.log("Auto fallback skipped because the account posted in the last 24 hours");
    return;
  }

  const snapshot = await fetchMarketSnapshot();
  const candidates = await generateCandidates(snapshot, recentTweets.map((tweet) => tweet.text));
  const textCandidates = candidates.slice(0, 2);
  const recommendation = await generateRecommendation(textCandidates, snapshot);
  const tweetText = textCandidates[recommendation.pick - 1];

  // Close the race where a manual approval lands while Claude is generating.
  const latestTweets = await getAccountTimeline(twitterClient);
  if (hasRecentPost(latestTweets)) {
    await notify("ℹ️ Auto fallback je preskočen: ručna objava je stigla tokom generisanja.")
      .catch((error) => console.warn("Could not send Telegram race notice:", error.message));
    console.log("Auto fallback skipped after final timeline recheck");
    return;
  }

  const tweet = await twitterClient.v2.tweet(tweetText);
  const tweetUrl = `https://x.com/AlphaGuruReal/status/${tweet.data.id}`;

  await notify(`✅ Auto fallback je objavljen:\n${tweetText}\n\n${tweetUrl}`)
    .catch((error) => console.warn("Tweet published, but Telegram notice failed:", error.message));
  console.log(`Published automatic fallback tweet ${tweet.data.id}`);
}

main().catch(async (error) => {
  console.error("Auto fallback failed:", error);
  await notify(`⚠️ Auto fallback nije uspeo.\n${String(error.message).slice(0, 180)}`).catch(() => {});
  process.exit(1);
});
