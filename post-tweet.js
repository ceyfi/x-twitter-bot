import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOPICS = [
  "crypto market trends or Bitcoin/Ethereum price action",
  "artificial intelligence news or a breakthrough in AI",
  "stock market or macroeconomic insight (Fed, inflation, earnings)",
  "DeFi or Web3 development",
  "a contrarian take on investing or trading psychology",
];

async function generateTweet() {
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 150,
    system: `You are a real person who trades crypto and follows financial markets closely.
You're not a bot, not a brand — just someone who's been in markets for years and occasionally shares thoughts on Twitter.

Your writing style:
- Casual and direct, like texting a friend who's also into markets
- Sometimes bullish, sometimes skeptical, sometimes just observing
- Use lowercase sometimes, skip punctuation occasionally
- No hashtag spam (max 1 hashtag, often none)
- No emojis unless genuinely fitting
- Short sentences. Real opinions. Max 240 characters.`,
    messages: [
      {
        role: "user",
        content: `Write one tweet about: ${topic}.
Sound like a real person. Keep it under 240 characters.
Return ONLY the tweet text, nothing else.`,
      },
    ],
  });

  return message.content[0].text.trim();
}

async function postTweet(tweetText) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("Logging in to Twitter...");
    await page.goto("https://x.com/i/flow/login");
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "screenshot.png" });
    console.log("Screenshot saved");

    // Unesi email/username
    await page.waitForSelector('input[name="text"]', { timeout: 15000 });
    await page.locator('input[name="text"]').click();
    await page.locator('input[name="text"]').fill(process.env.TWITTER_EMAIL);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // Ponekad Twitter traži username umesto emaila
    const usernameInput = page.locator('input[name="text"]');
    if (await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await usernameInput.fill(process.env.TWITTER_EMAIL.split("@")[0]);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
    }

    // Unesi lozinku
    await page.locator('input[name="password"]').fill(process.env.TWITTER_PASSWORD);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);

    console.log("Logged in. Composing tweet...");

    // Klikni na compose
    await page.click('[data-testid="SideNav_NewTweet_Button"]');
    await page.waitForTimeout(1500);

    // Unesi tekst tweeta
    await page.click('[data-testid="tweetTextarea_0"]');
    await page.type('[data-testid="tweetTextarea_0"]', tweetText, { delay: 30 });
    await page.waitForTimeout(1000);

    // Objavi
    await page.click('[data-testid="tweetButtonInline"]');
    await page.waitForTimeout(2000);

    console.log("Tweet posted successfully:", tweetText);
  } finally {
    await browser.close();
  }
}

async function main() {
  const tweet = await generateTweet();
  console.log("Generated tweet:", tweet);
  await postTweet(tweet);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
