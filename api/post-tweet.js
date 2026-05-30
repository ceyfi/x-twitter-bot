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

const TOPICS = [
  "crypto market trends or Bitcoin/Ethereum price action",
  "artificial intelligence news or a breakthrough in AI",
  "stock market or macroeconomic insight (Fed, inflation, earnings)",
  "DeFi or Web3 development",
  "a contrarian take on investing or trading psychology",
];

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

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 150,
      system: `You are a real person who trades crypto and follows financial markets closely.
You're not a bot, not a brand, not a newsletter — just someone who's been in markets for years and occasionally shares thoughts on Twitter.

Your writing style:
- Casual and direct, like texting a friend who's also into markets
- Sometimes you're bullish, sometimes skeptical, sometimes just observing
- You use lowercase sometimes, skip punctuation occasionally, write how people actually talk
- No hashtag spam — maybe one hashtag if it really fits, often none
- No emojis unless it's genuinely funny or fitting
- No "thread 🧵" or "here's what you need to know" clickbait
- Short sentences. Real opinions. Sometimes a question at the end to spark conversation.
- Max 240 characters`,
      messages: [
        {
          role: "user",
          content: `Write one tweet about: ${topic}.
Sound like a real person, not a content creator. Keep it under 240 characters.
Return ONLY the tweet text, nothing else.`,
        },
      ],
    });

    const tweetText = message.content[0].text.trim();

    const tweet = await twitterClient.v2.tweet(tweetText);

    console.log("Tweet posted:", tweetText);

    return res.status(200).json({
      success: true,
      tweet: tweetText,
      id: tweet.data.id,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      error: error.message,
      code: error.code,
      data: error.data || null
    });
  }
}
