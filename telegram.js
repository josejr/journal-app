const db = require("./db");

const { TELEGRAM_BOT_TOKEN } = process.env;

function isConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN);
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
}

async function sendMessage(chatId, text) {
  const res = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram send failed");
  return data;
}

async function sendReminder(chatId, prompt) {
  if (!isConfigured()) {
    throw new Error("Telegram isn't configured. Set TELEGRAM_BOT_TOKEN in .env");
  }
  if (!chatId) {
    throw new Error("No Telegram chat linked yet — link your account from Settings");
  }
  return sendMessage(chatId, `Time to journal. Today's prompt: ${prompt}`);
}

// Long-polls Telegram for new messages and routes every non-command message
// to onMessage(chatId, text). The caller decides how to interpret it (link
// code vs. journal entry) since that now depends on which user, if any, the
// chat is linked to.
async function pollUpdates(onMessage) {
  if (!isConfigured()) return;

  const offset = db.getBotOffset();
  const res = await fetch(`${apiUrl("getUpdates")}?offset=${offset + 1}&timeout=0`);
  const data = await res.json();
  if (!data.ok) return;

  for (const update of data.result) {
    db.setBotOffset(update.update_id);

    const msg = update.message;
    if (!msg || !msg.text) continue;
    if (msg.text.startsWith("/")) continue;

    const chatId = String(msg.chat.id);
    await onMessage(chatId, msg.text);
  }
}

module.exports = { sendMessage, sendReminder, isConfigured, pollUpdates };
