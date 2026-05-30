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

const PERSONAS = [
  "contrarian trader who questions popular narratives",
  "macro observer focused on big picture trends",
  "skeptical investor who's seen too many cycles",
  "AI enthusiast watching how it intersects with finance",
  "market psychologist focused on crowd behavior and sentiment",
  "bitcoin-curious person who also watches traditional markets",
];

const TOPICS = [
  "crypto market trends or Bitcoin/Ethereum price action",
  "artificial intelligence and its impact on markets or jobs",
  "stock market or macroeconomic conditions (Fed, inflation, earnings)",
  "DeFi or Web3 — what's working and what isn't",
  "trading psychology or investor behavior",
  "the intersection of AI and crypto",
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
];

async function getRecentTweets() {
  try {
    const me = await twitterClient.v2.me();
    const tweets = await twitterClient.v2.userTimeline(me.data.id, {
      max_results: 10,
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
    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    const recentTweets = await getRecentTweets();

    const recentContext = recentTweets.length > 0
      ? `\n\nYour recent tweets (do NOT repeat these ideas, topics or phrasing):\n${recentTweets.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 150,
      system: `You are a real person who trades crypto and follows financial markets closely.
You're not a bot, not a brand, not a newsletter — just someone who's been in markets for years and occasionally shares thoughts on Twitter.

Today write from the perspective of: ${persona}.

Your writing style:
- Casual and direct, like texting a friend who's also into markets
- Sometimes bullish, sometimes skeptical, sometimes just observing
- Lowercase sometimes, skip punctuation occasionally
- No hashtag spam (max 1 hashtag, often none)
- No emojis unless genuinely fitting
- No "thread 🧵" or clickbait openers
- Short sentences. Real opinions. Max 240 characters.

Avoid these clichéd phrases at all costs: ${BANNED_PHRASES.join(", ")}`,
      messages: [
        {
          role: "user",
          content: `Write one tweet about: ${topic}.${recentContext}

Sound like a real person. Keep it under 240 characters.
Return ONLY the tweet text, nothing else.`,
        },
      ],
    });

    const tweetText = message.content[0].text.trim();
    const tweet = await twitterClient.v2.tweet(tweetText);

    console.log(`Posted as [${persona}]: ${tweetText}`);

    return res.status(200).json({
      success: true,
      tweet: tweetText,
      persona,
      topic,
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
