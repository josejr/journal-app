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

function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

async function tick() {
  const now = currentHHMM();
  const date = todayStr();

  for (const user of db.listUsersWithReminderEnabled()) {
    if (user.reminder_time !== now) continue;

    const entry = db.getEntry(user.user_id, date);
    if (entry && entry.content.trim()) continue;

    const prompt = entry ? entry.prompt : promptForDate(date);
    try {
      await telegram.sendReminder(user.telegram_chat_id, prompt);
      console.log(`[reminder] Sent to ${user.username} (Telegram chat ${user.telegram_chat_id})`);
    } catch (err) {
      console.error(`[reminder] Failed to send to ${user.username}:`, err.message);
    }
  }
}

// Runs once at boot; every user's reminder_time is checked on each minute's
// tick, so per-user changes in Settings take effect without rescheduling.
function reschedule() {
  if (task) return;
  task = cron.schedule("* * * * *", tick);
  console.log("[reminder] Watching for due reminders every minute");
}

module.exports = { reschedule };
