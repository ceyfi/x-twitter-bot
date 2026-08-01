const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl =
  process.env.TELEGRAM_WEBHOOK_URL ||
  "https://x-twitter-bot.vercel.app/api/telegram-webhook";

if (!token || !secret) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error(
    "TELEGRAM_WEBHOOK_SECRET must be 16-256 characters using only letters, numbers, _ or -",
  );
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["callback_query"],
    drop_pending_updates: true,
  }),
});

const result = await response.json();
if (!response.ok || !result.ok) {
  console.error(`Webhook registration failed: ${result.description || response.status}`);
  process.exit(1);
}

console.log(`Telegram webhook registered: ${webhookUrl}`);
