import { TwitterApi } from "twitter-api-v2";
import Anthropic from "@anthropic-ai/sdk";

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CORE_THEMES = [
  "liquidity and how it drives everything",
  "market psychology and crowd behavior",
  "AI adoption and its effect on white collar work",
  "bitcoin",
  "how narratives form and collapse in markets",
];

const FORMATS = [
  "observation",
  "question — ask followers something that makes them think",
  "contrarian take — challenge what everyone believes right now",
  "prediction",
  "mistake learned — something you got wrong and what it cost you",
  "short story — one sentence story about something you witnessed in markets",
  "unpopular opinion",
  "mental model — a framework for thinking about markets",
  "one sentence insight — brutally short",
  "comparison — two things that seem different but aren't",
];

const LENGTHS = [
  "very short (under 80 characters)",
  "one sentence",
  "two to three sentences",
  "a question only — nothing else",
];

const BANNED_PHRASES = [
  "the market is a transfer of wealth",
  "smart money",
  "stay humble",
  "zoom out",
  "this cycle is different",
  "we are still early",
  "nobody is talking about",
  "do your own research",
  "DYOR",
  "to the moon",
  "buidl",
  "have fun staying poor",
  "gm",
  "wagmi",
  "ngmi",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getRecentTweets() {
  try {
    const me = await twitterClient.v2.me();
    const tweets = await twitterClient.v2.userTimeline(me.data.id, {
      max_results: 20,
      "tweet.fields": ["text"],
    });
    return tweets.data?.data?.map((t) => t.text) || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const theme = pick(CORE_THEMES);
    const format = pick(FORMATS);
    const length = pick(LENGTHS);
    const recentTweets = await getRecentTweets();

    const recentContext = recentTweets.length > 0
      ? `\nYour recent tweets — do NOT repeat these ideas, topics or phrasing:\n${recentTweets.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 150,
      system: `You are Alpha Guru (@AlphaGuruReal) — a real person who's been trading crypto and watching markets for years.
You have a distinct voice and specific obsessions: liquidity, market psychology, AI replacing white collar jobs, bitcoin, and how narratives form and collapse.
You're not a content creator. You share raw thoughts, not polished takes.

Writing rules:
- Lowercase most of the time
- Skip punctuation when it feels natural
- No hashtag spam (one max, often none)
- No emojis unless it really fits
- No clickbait openers
- Sound like a person, not a brand
- Vary sentence openings — avoid repeatedly starting with: "I think", "Feels like", "Most people", "Everyone", "The market"

Banned phrases (never use): ${BANNED_PHRASES.join(", ")}`,
      messages: [
        {
          role: "user",
          content: `Theme: ${theme}
Format: ${format}
Length: ${length}
${recentContext}
Write the tweet. Return ONLY the tweet text, nothing else.`,
        },
      ],
    });

    const tweetText = message.content[0].text.trim();
    const tweet = await twitterClient.v2.tweet(tweetText);

    console.log(`[${format}] [${length}]: ${tweetText}`);

    return res.status(200).json({
      success: true,
      tweet: tweetText,
      format,
      theme,
      length,
      id: tweet.data.id,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      error: error.message,
      code: error.code,
      data: error.data || null,
    });
  }
}
