import { TwitterApi } from "twitter-api-v2";
import Anthropic from "@anthropic-ai/sdk";
import { createCanvas } from "@napi-rs/canvas";

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

// Wrap text na više linija
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let lines = [];

  for (let word of words) {
    const testLine = line + word + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line !== "") {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());

  const totalHeight = lines.length * lineHeight;
  const startY = y - totalHeight / 2 + lineHeight / 2;

  lines.forEach((l, i) => {
    ctx.fillText(l, x, startY + i * lineHeight);
  });
}

// Generisi quote grafiku
function generateQuoteImage(tweetText) {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Crna pozadina
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  // Zlatni border
  ctx.strokeStyle = "#C9A84C";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, width - 80, height - 80);

  // Tanki unutrašnji border
  ctx.strokeStyle = "#C9A84C44";
  ctx.lineWidth = 1;
  ctx.strokeRect(52, 52, width - 104, height - 104);

  // Uglovi — dekorativni
  const cornerSize = 20;
  ctx.strokeStyle = "#C9A84C";
  ctx.lineWidth = 2;
  // Gornji levi
  ctx.beginPath(); ctx.moveTo(40, 40 + cornerSize); ctx.lineTo(40, 40); ctx.lineTo(40 + cornerSize, 40); ctx.stroke();
  // Gornji desni
  ctx.beginPath(); ctx.moveTo(width - 40 - cornerSize, 40); ctx.lineTo(width - 40, 40); ctx.lineTo(width - 40, 40 + cornerSize); ctx.stroke();
  // Donji levi
  ctx.beginPath(); ctx.moveTo(40, height - 40 - cornerSize); ctx.lineTo(40, height - 40); ctx.lineTo(40 + cornerSize, height - 40); ctx.stroke();
  // Donji desni
  ctx.beginPath(); ctx.moveTo(width - 40 - cornerSize, height - 40); ctx.lineTo(width - 40, height - 40); ctx.lineTo(width - 40, height - 40 - cornerSize); ctx.stroke();

  // Navodnici
  ctx.fillStyle = "#C9A84C22";
  ctx.font = "bold 180px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText("“", 60, 240);

  // Tweet tekst
  ctx.fillStyle = "#E8E8E8";
  ctx.font = "bold 46px Georgia, serif";
  ctx.textAlign = "center";
  wrapText(ctx, tweetText, width / 2, height / 2 - 20, width - 200, 66);

  // Linija iznad brenda
  ctx.strokeStyle = "#C9A84C55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(200, height - 110);
  ctx.lineTo(width - 200, height - 110);
  ctx.stroke();

  // AG brending
  ctx.fillStyle = "#C9A84C";
  ctx.font = "bold 22px Georgia, serif";
  ctx.letterSpacing = "4px";
  ctx.fillText("ALPHA GURU", width / 2, height - 78);

  ctx.fillStyle = "#666666";
  ctx.font = "16px Georgia, serif";
  ctx.fillText("@AlphaGuruReal  ·  Markets · Crypto · AI", width / 2, height - 52);

  return canvas.toBuffer("image/png");
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
    const includeImage = Math.random() < 0.2; // 20% šansa za sliku

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

    let tweet;
    if (includeImage) {
      // Generiši sliku i uploaduj
      const imageBuffer = generateQuoteImage(tweetText);
      const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });
      tweet = await twitterClient.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] },
      });
      console.log(`[WITH IMAGE] [${format}]: ${tweetText}`);
    } else {
      tweet = await twitterClient.v2.tweet(tweetText);
      console.log(`[${format}] [${length}]: ${tweetText}`);
    }

    return res.status(200).json({
      success: true,
      tweet: tweetText,
      format,
      theme,
      length,
      hasImage: includeImage,
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
