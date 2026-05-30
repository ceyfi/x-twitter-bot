import { TwitterApi } from "twitter-api-v2";
import OpenAI from "openai";

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.x.ai/v1",
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

    const completion = await grok.chat.completions.create({
      model: "grok-3",
      messages: [
        {
          role: "system",
          content: `You are a sharp, opinionated finance and crypto Twitter personality.
You write concise, insightful tweets that sound like a real human — not a bot.
Style: direct, confident, sometimes contrarian. No hashtag spam (max 2 relevant hashtags).
No emojis unless it really fits. No corporate speak. Max 240 characters.
Write as if you've been in markets for years and have seen it all.`,
        },
        {
          role: "user",
          content: `Write one tweet about: ${topic}.
Make it feel natural, like something a knowledgeable trader or investor would post.
Keep it under 240 characters. Return ONLY the tweet text, nothing else.`,
        },
      ],
      max_tokens: 100,
      temperature: 0.9,
    });

    const tweetText = completion.choices[0].message.content.trim();

    const tweet = await twitterClient.v2.tweet(tweetText);

    console.log("Tweet posted:", tweetText);

    return res.status(200).json({
      success: true,
      tweet: tweetText,
      id: tweet.data.id,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
