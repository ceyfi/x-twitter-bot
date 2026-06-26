import { TwitterApi } from "twitter-api-v2";

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function answerCallback(callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function editMessage(chatId, messageId, newText) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

function extractReplyFromMessage(messageText) {
  // Parsiramo reply između "Predlog odgovora:" i "🔗"
  const match = messageText.match(/Predlog odgovora:\n([\s\S]+?)\n\n🔗/);
  return match ? match[1].trim() : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const update = req.body;

  // Handle callback query (dugme pritisnuto)
  if (update?.callback_query) {
    const cb = update.callback_query;
    const data = cb.data; // "send:<tweetId>" ili "skip:<tweetId>"
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;
    const messageText = cb.message?.text || "";

    if (!data) {
      await answerCallback(cb.id, "Greška");
      return res.status(200).json({ ok: true });
    }

    const [action, tweetId] = data.split(":");

    if (action === "skip") {
      await answerCallback(cb.id, "Preskočeno ✓");
      await editMessage(chatId, messageId, messageText.replace("💬 <b>Predlog odgovora:</b>", "💬 <b>Predlog odgovora (preskočen):</b>") + "\n\n❌ <i>Preskočeno</i>");
      return res.status(200).json({ ok: true });
    }

    if (action === "send") {
      const replyText = extractReplyFromMessage(messageText);

      if (!replyText) {
        await answerCallback(cb.id, "Nije moglo da se parsira :(");
        return res.status(200).json({ ok: true });
      }

      try {
        // Pošalji reply na Twitter
        await twitterClient.v2.tweet({
          text: replyText,
          reply: { in_reply_to_tweet_id: tweetId },
        });

        await answerCallback(cb.id, "Poslato! ✅");

        // Uredi poruku da pokaže da je poslato
        const updatedText =
          messageText + "\n\n✅ <b>Odgovor poslat!</b>";
        await editMessage(chatId, messageId, updatedText);

        console.log(`Reply posted to tweet ${tweetId}: ${replyText}`);
      } catch (err) {
        const detail = JSON.stringify(err.data || err.message);
        console.error("Twitter error:", detail);
        await answerCallback(cb.id, `Greška: ${detail.slice(0, 180)}`);
      }

      return res.status(200).json({ ok: true });
    }
  }

  return res.status(200).json({ ok: true });
}
