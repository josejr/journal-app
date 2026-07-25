const cron = require("node-cron");
const db = require("./db");
const telegram = require("./telegram");
const { promptForDate } = require("./prompts");

let task = null;

function todayStr() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

function timeToCron(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const [, hour, minute] = match;
  return `${Number(minute)} ${Number(hour)} * * *`;
}

async function fireReminder() {
  const settings = db.getSettings();
  const date = todayStr();
  const entry = db.getEntry(date);

  if (entry && entry.content.trim()) {
    console.log(`[reminder] Skipped — already journaled today (${date})`);
    return;
  }

  const prompt = entry ? entry.prompt : promptForDate(date);
  try {
    await telegram.sendReminder(settings.telegram_chat_id, prompt);
    console.log(`[reminder] Sent to Telegram chat ${settings.telegram_chat_id}`);
  } catch (err) {
    console.error("[reminder] Failed to send:", err.message);
  }
}

function reschedule() {
  if (task) {
    task.stop();
    task = null;
  }

  const settings = db.getSettings();
  if (!settings.reminder_enabled || !settings.telegram_chat_id) return;

  const cronExpr = timeToCron(settings.reminder_time);
  if (!cronExpr) {
    console.error(`[reminder] Invalid reminder_time "${settings.reminder_time}"`);
    return;
  }

  task = cron.schedule(cronExpr, fireReminder);
  console.log(`[reminder] Scheduled daily at ${settings.reminder_time} to Telegram chat ${settings.telegram_chat_id}`);
}

module.exports = { reschedule, fireReminder };
