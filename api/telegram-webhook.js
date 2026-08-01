import { timingSafeEqual } from "node:crypto";
import { TwitterApi } from "twitter-api-v2";

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const TELEGRAM_API = "https://api.telegram.org";

function secretsMatch(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function telegramRequest(method, body) {
  const response = await fetch(
    `${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  }
  return result;
}

function extractDailyCandidate(messageText, candidateIndex) {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 2) {
    return null;
  }
  const plainText = messageText
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const number = candidateIndex + 1;
  const nextSection = number < 3 ? `Predlog ${number + 1}:` : "Market snapshot:";
  const pattern = new RegExp(`Predlog ${number}:\\n([\\s\\S]+?)\\n\\n${nextSection}`);
  const match = plainText.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractQuoteCandidate(messageText) {
  const match = messageText.match(/Predlog odgovora:\n([\s\S]+?)\n\n(?:🔗|Otvori tweet)/);
  return match?.[1]?.trim() || null;
}

async function downloadTelegramPhoto(photoSizes) {
  const largest = photoSizes?.[photoSizes.length - 1];
  if (!largest?.file_id) throw new Error("Telegram photo is missing");

  const file = await telegramRequest("getFile", { file_id: largest.file_id });
  const filePath = file.result?.file_path;
  if (!filePath) throw new Error("Telegram did not return a photo path");

  const response = await fetch(
    `${TELEGRAM_API}/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
  );
  if (!response.ok) throw new Error(`Telegram photo download failed: ${response.status}`);

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: /\.png$/i.test(filePath) ? "image/png" : "image/jpeg",
  };
}

async function answerCallback(callbackQueryId, text) {
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function disableButtons(chatId, messageId) {
  await telegramRequest("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

async function markHandled(chatId, messageId, messageText, status, hasPhoto) {
  const method = hasPhoto ? "editMessageCaption" : "editMessageText";
  const contentField = hasPhoto ? "caption" : "text";
  const body = {
    chat_id: chatId,
    message_id: messageId,
    [contentField]: `${messageText}\n\n${status}`,
    reply_markup: { inline_keyboard: [] },
  };
  if (!hasPhoto) body.disable_web_page_preview = true;
  await telegramRequest(method, body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!secretsMatch(receivedSecret, expectedSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cb = req.body?.callback_query;
  if (!cb) return res.status(200).json({ ok: true });

  const chatId = String(cb.message?.chat?.id || "");
  if (!process.env.TELEGRAM_CHAT_ID || chatId !== String(process.env.TELEGRAM_CHAT_ID)) {
    return res.status(403).json({ error: "Wrong Telegram chat" });
  }

  const messageId = cb.message?.message_id;
  const hasPhoto = Boolean(cb.message?.photo?.length);
  const messageText = cb.message?.caption || cb.message?.text || "";
  const [action, target, candidateIndex, mediaType] = String(cb.data || "").split(":");

  try {
    if (action === "skip") {
      await answerCallback(cb.id, "Preskočeno");
      await markHandled(chatId, messageId, messageText, "❌ Preskočeno", hasPhoto);
      return res.status(200).json({ ok: true });
    }

    if (action === "post" && target === "daily") {
      const tweetText = extractDailyCandidate(messageText, Number(candidateIndex));
      if (!tweetText || tweetText.length > 280) throw new Error("Invalid daily candidate");

      await answerCallback(cb.id, "Objavljujem...");
      await disableButtons(chatId, messageId);
      let tweet;
      if (mediaType === "image" && Number(candidateIndex) === 2) {
        const photo = await downloadTelegramPhoto(cb.message.photo);
        const mediaId = await twitterClient.v1.uploadMedia(photo.buffer, {
          mimeType: photo.mimeType,
        });
        tweet = await twitterClient.v2.tweet({
          text: tweetText,
          media: { media_ids: [mediaId] },
        });
      } else {
        tweet = await twitterClient.v2.tweet(tweetText);
      }
      await markHandled(chatId, messageId, messageText, "✅ Objavljeno", hasPhoto).catch((error) =>
        console.warn("Tweet published, but Telegram status update failed:", error.message),
      );
      console.log(`Published approved daily tweet ${tweet.data.id}`);
      return res.status(200).json({ ok: true });
    }

    if (action === "send" && /^\d+$/.test(target)) {
      const replyText = extractQuoteCandidate(messageText);
      if (!replyText || replyText.length > 280) throw new Error("Invalid quote candidate");

      await answerCallback(cb.id, "Objavljujem...");
      await disableButtons(chatId, messageId);
      const tweet = await twitterClient.v2.tweet({
        text: replyText,
        quote_tweet_id: target,
      });
      await markHandled(chatId, messageId, messageText, "✅ Quote objavljen", hasPhoto).catch((error) =>
        console.warn("Quote published, but Telegram status update failed:", error.message),
      );
      console.log(`Published approved quote ${tweet.data.id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown callback action" });
  } catch (error) {
    console.error("Approval error:", error);
    await answerCallback(cb.id, `Greška: ${error.message.slice(0, 120)}`).catch(() => {});
    await markHandled(chatId, messageId, messageText, "⚠️ Objavljivanje nije uspelo", hasPhoto)
      .catch(() => {});
    // Acknowledge the Telegram update to prevent automatic delivery retries and
    // possible duplicate X posts. A failed candidate can be regenerated manually.
    return res.status(200).json({ ok: false, error: "Approval failed" });
  }
}
