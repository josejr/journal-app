const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "data", "journal.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    date TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_time TEXT NOT NULL DEFAULT '20:00',
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    telegram_last_update_id INTEGER NOT NULL DEFAULT 0
  )
`);
for (const migration of [
  "ALTER TABLE settings ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE settings ADD COLUMN telegram_last_update_id INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE settings DROP COLUMN phone_number",
]) {
  try {
    db.exec(migration);
  } catch {
    // already applied on a prior run (or column never existed on a fresh db)
  }
}
db.exec(`
  INSERT OR IGNORE INTO settings (id, reminder_enabled, reminder_time, telegram_chat_id, telegram_last_update_id)
  VALUES (1, 0, '20:00', '', 0)
`);

const getSettingsStmt = db.prepare("SELECT * FROM settings WHERE id = 1");
const updateSettingsStmt = db.prepare(`
  UPDATE settings SET reminder_enabled = @reminder_enabled,
    reminder_time = @reminder_time
  WHERE id = 1
`);
const setTelegramChatIdStmt = db.prepare("UPDATE settings SET telegram_chat_id = ? WHERE id = 1");
const setTelegramOffsetStmt = db.prepare("UPDATE settings SET telegram_last_update_id = ? WHERE id = 1");

function getSettings() {
  return getSettingsStmt.get();
}

function saveSettings({ reminder_enabled, reminder_time }) {
  updateSettingsStmt.run({ reminder_enabled: reminder_enabled ? 1 : 0, reminder_time });
  return getSettings();
}

function setTelegramChatId(chatId) {
  setTelegramChatIdStmt.run(chatId);
}

function setTelegramOffset(updateId) {
  setTelegramOffsetStmt.run(updateId);
}

const getEntryStmt = db.prepare("SELECT * FROM entries WHERE date = ?");
const listEntriesStmt = db.prepare(
  "SELECT date, prompt, content FROM entries WHERE content != '' ORDER BY date DESC"
);
const upsertStmt = db.prepare(`
  INSERT INTO entries (date, prompt, content, updated_at)
  VALUES (@date, @prompt, @content, datetime('now'))
  ON CONFLICT(date) DO UPDATE SET
    content = excluded.content,
    prompt = excluded.prompt,
    updated_at = datetime('now')
`);

function getEntry(date) {
  return getEntryStmt.get(date);
}

function listEntries() {
  return listEntriesStmt.all();
}

function saveEntry(date, prompt, content) {
  upsertStmt.run({ date, prompt, content });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    specific TEXT NOT NULL DEFAULT '',
    measurable TEXT NOT NULL DEFAULT '',
    achievable TEXT NOT NULL DEFAULT '',
    relevant TEXT NOT NULL DEFAULT '',
    target_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const listGoalsByStatusStmt = db.prepare(
  "SELECT * FROM goals WHERE status = ? ORDER BY target_date ASC, created_at ASC"
);
const insertGoalStmt = db.prepare(`
  INSERT INTO goals (title, specific, measurable, achievable, relevant, target_date)
  VALUES (@title, @specific, @measurable, @achievable, @relevant, @target_date)
`);
const setGoalStatusStmt = db.prepare("UPDATE goals SET status = ? WHERE id = ?");
const deleteGoalStmt = db.prepare("DELETE FROM goals WHERE id = ?");

function listGoalsByStatus(status) {
  return listGoalsByStatusStmt.all(status);
}

function createGoal({ title, specific, measurable, achievable, relevant, target_date }) {
  insertGoalStmt.run({ title, specific, measurable, achievable, relevant, target_date });
}

function setGoalStatus(id, status) {
  setGoalStatusStmt.run(status, id);
}

function deleteGoal(id) {
  deleteGoalStmt.run(id);
}

module.exports = {
  getEntry,
  listEntries,
  saveEntry,
  getSettings,
  saveSettings,
  setTelegramChatId,
  setTelegramOffset,
  listGoalsByStatus,
  createGoal,
  setGoalStatus,
  deleteGoal,
};
