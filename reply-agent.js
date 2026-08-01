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

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const SEARCH_QUERIES = [
  "bitcoin liquidity -is:retweet lang:en",
  "market psychology trading -is:retweet lang:en",
  "AI replacing jobs finance -is:retweet lang:en",
  "crypto narrative collapse -is:retweet lang:en",
  "bitcoin cycle -is:retweet lang:en",
];

async function searchTweets(query) {
  try {
    const results = await twitterClient.v2.search(query, {
      max_results: 10,
      "tweet.fields": ["author_id", "public_metrics", "text", "created_at"],
      "user.fields": ["public_metrics", "username", "name"],
      expansions: ["author_id"],
    });
    return results;
  } catch (err) {
    console.error("Search error:", err.message);
    return null;
  }
}

async function generateReply(originalTweet, authorUsername) {
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 120,
    system: `You are Alpha Guru (@AlphaGuruReal) — a crypto and markets person who's been in the game for years.
You're leaving a reply on someone's tweet. Be genuine, add value, spark conversation.

Rules:
- Max 220 characters
- Respond to a specific claim or fact in the original tweet
- Add one concrete implication, counterpoint, or precise question
- Never invent personal experience, trades, results, conversations, or credentials
- No generic praise, motivational advice, slogans, hashtags, or engagement bait
- Do not paraphrase the original tweet
- If there is no useful reply, return exactly: SKIP`,
    messages: [
      {
        role: "user",
        content: `Write a reply to this tweet by @${authorUsername}:

"${originalTweet}"

Return ONLY the reply text, nothing else.`,
      },
    ],
  });

  return message.content[0].text.trim().replace(/^['\"]|['\"]$/g, "");
}

async function sendTelegramWithButtons(text, tweetId) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Pošalji", callback_data: `send:${tweetId}` },
            { text: "❌ Skip", callback_data: `skip:${tweetId}` },
          ],
        ],
      },
    }),
  });
  const result = await res.json();
  if (!res.ok || !result.ok) {
    throw new Error(`Telegram send failed: ${result.description || res.status}`);
  }
  return result;
}

async function main() {
  console.log("Starting reply agent...");

  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  console.log("Searching:", query);

  const results = await searchTweets(query);
  if (!results?.data?.data?.length) {
    console.log("No tweets found.");
    return;
  }

  const tweets = results.data.data;
  const users = results.data.includes?.users || [];

  // Samo nalozi sa 500+ followera
  const filtered = tweets.filter((tweet) => {
    const user = users.find((u) => u.id === tweet.author_id);
    return user?.public_metrics?.followers_count >= 500;
  });

  if (!filtered.length) {
    console.log("No tweets from accounts with 500+ followers.");
    return;
  }

  // Top 3 po likes
  const top = filtered
    .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0))
    .slice(0, 3);

  console.log(`Found ${top.length} relevant tweets. Generating replies...`);

  for (const tweet of top) {
    const user = users.find((u) => u.id === tweet.author_id);
    const username = user?.username || "unknown";
    const followers = user?.public_metrics?.followers_count || 0;
    const likes = tweet.public_metrics?.like_count || 0;

    const reply = await generateReply(tweet.text, username);
    if (reply === "SKIP" || reply.length > 280) {
      console.log(`Skipped tweet ${tweet.id}: no useful candidate`);
      continue;
    }
    const tweetUrl = `https://twitter.com/${username}/status/${tweet.id}`;

    // Format koji webhook može da parsira
    const msg =
      `🐦 <b>Reply suggestion</b>\n\n` +
      `<b>@${escapeHtml(username)}</b> · ${followers.toLocaleString()} followers · ${likes} likes\n\n` +
      `<i>${escapeHtml(tweet.text.slice(0, 220))}${tweet.text.length > 220 ? "..." : ""}</i>\n\n` +
      `💬 <b>Predlog odgovora:</b>\n` +
      `${escapeHtml(reply)}\n\n` +
      `🔗 <a href="${tweetUrl}">Otvori tweet</a>`;

    await sendTelegramWithButtons(msg, tweet.id);
    console.log(`Sent suggestion for tweet ${tweet.id} by @${username}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
