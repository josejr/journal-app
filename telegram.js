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
    throw new Error("No Telegram chat linked yet — message your bot to link it");
  }
  return sendMessage(chatId, `Time to journal. Today's prompt: ${prompt}`);
}

// Long-polls Telegram for new messages. Auto-links the first chat that
// messages the bot, then routes every later message from that chat to
// onEntry(text) so it can be saved as a journal entry.
async function pollUpdates(onEntry) {
  if (!isConfigured()) return;

  const settings = db.getSettings();
  const res = await fetch(`${apiUrl("getUpdates")}?offset=${settings.telegram_last_update_id + 1}&timeout=0`);
  const data = await res.json();
  if (!data.ok) return;

  for (const update of data.result) {
    db.setTelegramOffset(update.update_id);

    const msg = update.message;
    if (!msg || !msg.text) continue;

    const chatId = String(msg.chat.id);
    const current = db.getSettings();

    if (!current.telegram_chat_id) {
      db.setTelegramChatId(chatId);
      await sendMessage(chatId, "Linked! I'll send your daily journal prompt here — just reply to save your entry.");
      continue;
    }

    if (chatId !== current.telegram_chat_id) continue;
    if (msg.text.startsWith("/")) continue;

    onEntry(msg.text);
  }
}

module.exports = { sendReminder, isConfigured, pollUpdates };
