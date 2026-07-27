const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "data", "journal.db"));
db.pragma("journal_mode = WAL");

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableHasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// ---- One-time migration of the old single-user schema out of the way ----
// The pre-multiuser `entries` table used `date` as its primary key, which
// can't hold two different users' entries for the same day. Rename it aside
// so migrateLegacyData() can copy its rows onto the first admin account.
if (tableExists("entries") && !tableHasColumn("entries", "user_id")) {
  db.exec("ALTER TABLE entries RENAME TO entries_legacy");
}
// The old singleton `settings` row (id = 1) is superseded by per-user
// user_settings plus a global bot_state row for the Telegram poll offset.
if (tableExists("settings") && !tableExists("settings_legacy")) {
  db.exec("ALTER TABLE settings RENAME TO settings_legacy");
}

// ---- Users ----
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
for (const migration of [
  "ALTER TABLE users ADD COLUMN email TEXT",
  "ALTER TABLE users ADD COLUMN reset_token_hash TEXT",
  "ALTER TABLE users ADD COLUMN reset_token_expires INTEGER",
]) {
  try {
    db.exec(migration);
  } catch {
    // already applied on a prior run
  }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");

// ---- Per-user settings + global bot state ----
// Created here (ahead of the users helpers below) because createUser() seeds
// a user_settings row for every new account.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_time TEXT NOT NULL DEFAULT '20:00',
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    telegram_link_code TEXT NOT NULL DEFAULT ''
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    telegram_last_update_id INTEGER NOT NULL DEFAULT 0
  )
`);
if (!db.prepare("SELECT 1 FROM bot_state WHERE id = 1").get()) {
  let seedOffset = 0;
  if (tableExists("settings_legacy")) {
    const legacy = db.prepare("SELECT telegram_last_update_id FROM settings_legacy WHERE id = 1").get();
    if (legacy) seedOffset = legacy.telegram_last_update_id;
  }
  db.prepare("INSERT INTO bot_state (id, telegram_last_update_id) VALUES (1, ?)").run(seedOffset);
}

const getUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const getUserByUsernameStmt = db.prepare("SELECT * FROM users WHERE username = ?");
const getUserByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
const listUsersStmt = db.prepare(
  "SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at ASC"
);
const countUsersStmt = db.prepare("SELECT COUNT(*) AS n FROM users");
const insertUserStmt = db.prepare(`
  INSERT INTO users (username, email, password_hash, is_admin)
  VALUES (@username, @email, @password_hash, @is_admin)
`);
const insertUserSettingsStmt = db.prepare("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)");
const setUserEmailStmt = db.prepare("UPDATE users SET email = ? WHERE id = ?");
const setPasswordStmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
const setResetTokenStmt = db.prepare(
  "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?"
);
const clearResetTokenStmt = db.prepare(
  "UPDATE users SET reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
);
const getUserByResetTokenHashStmt = db.prepare("SELECT * FROM users WHERE reset_token_hash = ?");

const createUserTxn = db.transaction(({ username, email, password_hash, is_admin }) => {
  const info = insertUserStmt.run({ username, email: email || null, password_hash, is_admin: is_admin ? 1 : 0 });
  insertUserSettingsStmt.run(info.lastInsertRowid);
  return getUserByIdStmt.get(info.lastInsertRowid);
});

function getUserById(id) {
  return getUserByIdStmt.get(id);
}

function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username);
}

function getUserByEmail(email) {
  if (!email) return null;
  return getUserByEmailStmt.get(email);
}

function listUsers() {
  return listUsersStmt.all();
}

function countUsers() {
  return countUsersStmt.get().n;
}

function createUser({ username, email, password_hash, is_admin }) {
  return createUserTxn({ username, email, password_hash, is_admin });
}

function setUserEmail(userId, email) {
  setUserEmailStmt.run(email || null, userId);
}

function setPassword(userId, password_hash) {
  setPasswordStmt.run(password_hash, userId);
}

function setResetToken(userId, tokenHash, expires) {
  setResetTokenStmt.run(tokenHash, expires, userId);
}

function clearResetToken(userId) {
  clearResetTokenStmt.run(userId);
}

function getUserByValidResetTokenHash(tokenHash) {
  const user = getUserByResetTokenHashStmt.get(tokenHash);
  if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) return null;
  return user;
}

const getSettingsStmt = db.prepare("SELECT * FROM user_settings WHERE user_id = ?");
const updateSettingsStmt = db.prepare(`
  UPDATE user_settings SET reminder_enabled = @reminder_enabled, reminder_time = @reminder_time
  WHERE user_id = @user_id
`);
const setTelegramChatIdStmt = db.prepare(
  "UPDATE user_settings SET telegram_chat_id = ?, telegram_link_code = '' WHERE user_id = ?"
);
const clearTelegramChatIdStmt = db.prepare("UPDATE user_settings SET telegram_chat_id = '' WHERE user_id = ?");
const setTelegramLinkCodeStmt = db.prepare("UPDATE user_settings SET telegram_link_code = ? WHERE user_id = ?");
const getUserByTelegramChatIdStmt = db.prepare(`
  SELECT u.* FROM users u JOIN user_settings s ON s.user_id = u.id
  WHERE s.telegram_chat_id != '' AND s.telegram_chat_id = ?
`);
const getUserByLinkCodeStmt = db.prepare(`
  SELECT u.* FROM users u JOIN user_settings s ON s.user_id = u.id
  WHERE s.telegram_link_code != '' AND s.telegram_link_code = ?
`);
const listUsersWithReminderEnabledStmt = db.prepare(`
  SELECT u.id AS user_id, u.username, s.reminder_time, s.telegram_chat_id
  FROM users u JOIN user_settings s ON s.user_id = u.id
  WHERE s.reminder_enabled = 1 AND s.telegram_chat_id != ''
`);
const getBotOffsetStmt = db.prepare("SELECT telegram_last_update_id FROM bot_state WHERE id = 1");
const setBotOffsetStmt = db.prepare("UPDATE bot_state SET telegram_last_update_id = ? WHERE id = 1");

function getSettings(userId) {
  insertUserSettingsStmt.run(userId);
  return getSettingsStmt.get(userId);
}

function saveSettings(userId, { reminder_enabled, reminder_time }) {
  updateSettingsStmt.run({ user_id: userId, reminder_enabled: reminder_enabled ? 1 : 0, reminder_time });
  return getSettings(userId);
}

function setTelegramChatId(userId, chatId) {
  setTelegramChatIdStmt.run(chatId, userId);
}

function clearTelegramChatId(userId) {
  clearTelegramChatIdStmt.run(userId);
}

function setTelegramLinkCode(userId, code) {
  setTelegramLinkCodeStmt.run(code, userId);
}

function getUserByTelegramChatId(chatId) {
  return getUserByTelegramChatIdStmt.get(chatId);
}

function getUserByLinkCode(code) {
  if (!code) return null;
  return getUserByLinkCodeStmt.get(code);
}

function listUsersWithReminderEnabled() {
  return listUsersWithReminderEnabledStmt.all();
}

function getBotOffset() {
  return getBotOffsetStmt.get().telegram_last_update_id;
}

function setBotOffset(updateId) {
  setBotOffsetStmt.run(updateId);
}

// ---- Journal entries ----
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    prompt TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
  )
`);

const getEntryStmt = db.prepare("SELECT * FROM entries WHERE user_id = ? AND date = ?");
const listEntriesStmt = db.prepare(
  "SELECT date, prompt, content FROM entries WHERE user_id = ? AND content != '' ORDER BY date DESC"
);
const upsertStmt = db.prepare(`
  INSERT INTO entries (user_id, date, prompt, content, updated_at)
  VALUES (@user_id, @date, @prompt, @content, datetime('now'))
  ON CONFLICT(user_id, date) DO UPDATE SET
    content = excluded.content,
    prompt = excluded.prompt,
    updated_at = datetime('now')
`);

function getEntry(userId, date) {
  return getEntryStmt.get(userId, date);
}

function listEntries(userId) {
  return listEntriesStmt.all(userId);
}

function saveEntry(userId, date, prompt, content) {
  upsertStmt.run({ user_id: userId, date, prompt, content });
}

// ---- Goals ----
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
try {
  db.exec("ALTER TABLE goals ADD COLUMN user_id INTEGER REFERENCES users(id)");
} catch {
  // already applied on a prior run
}

const listGoalsByStatusStmt = db.prepare(
  "SELECT * FROM goals WHERE user_id = ? AND status = ? ORDER BY target_date ASC, created_at ASC"
);
const insertGoalStmt = db.prepare(`
  INSERT INTO goals (user_id, title, specific, measurable, achievable, relevant, target_date)
  VALUES (@user_id, @title, @specific, @measurable, @achievable, @relevant, @target_date)
`);
const setGoalStatusStmt = db.prepare("UPDATE goals SET status = ? WHERE id = ? AND user_id = ?");
const deleteGoalStmt = db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?");

function listGoalsByStatus(userId, status) {
  return listGoalsByStatusStmt.all(userId, status);
}

function createGoal(userId, { title, specific, measurable, achievable, relevant, target_date }) {
  insertGoalStmt.run({ user_id: userId, title, specific, measurable, achievable, relevant, target_date });
}

function setGoalStatus(userId, id, status) {
  setGoalStatusStmt.run(status, id, userId);
}

function deleteGoal(userId, id) {
  deleteGoalStmt.run(id, userId);
}

// ---- Sessions (backing store for express-session) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  )
`);
db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());

const getSessionStmt = db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?");
const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (sid, sess, expires) VALUES (@sid, @sess, @expires)
  ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
`);
const destroySessionStmt = db.prepare("DELETE FROM sessions WHERE sid = ?");

function getSession(sid) {
  const row = getSessionStmt.get(sid);
  if (!row || row.expires < Date.now()) return null;
  return row.sess;
}

function setSession(sid, sess, expires) {
  upsertSessionStmt.run({ sid, sess, expires });
}

function destroySession(sid) {
  destroySessionStmt.run(sid);
}

// ---- One-time legacy data migration, run by scripts/create-admin.js ----
function migrateLegacyData(adminUserId) {
  const summary = { entries: 0, goals: 0, settings: false };

  if (tableExists("entries_legacy")) {
    const rows = db.prepare("SELECT * FROM entries_legacy").all();
    const insert = db.prepare(`
      INSERT INTO entries (user_id, date, prompt, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO NOTHING
    `);
    const txn = db.transaction((entries) => {
      for (const e of entries) {
        insert.run(adminUserId, e.date, e.prompt, e.content, e.created_at, e.updated_at);
      }
    });
    txn(rows);
    db.exec("DROP TABLE entries_legacy");
    summary.entries = rows.length;
  }

  const goalsResult = db.prepare("UPDATE goals SET user_id = ? WHERE user_id IS NULL").run(adminUserId);
  summary.goals = goalsResult.changes;

  if (tableExists("settings_legacy")) {
    const legacy = db.prepare("SELECT * FROM settings_legacy WHERE id = 1").get();
    if (legacy) {
      saveSettings(adminUserId, {
        reminder_enabled: Boolean(legacy.reminder_enabled),
        reminder_time: legacy.reminder_time,
      });
      if (legacy.telegram_chat_id) setTelegramChatId(adminUserId, legacy.telegram_chat_id);
      summary.settings = true;
    }
    db.exec("DROP TABLE settings_legacy");
  }

  return summary;
}

module.exports = {
  getUserById,
  getUserByUsername,
  getUserByEmail,
  listUsers,
  countUsers,
  createUser,
  setUserEmail,
  setPassword,
  setResetToken,
  clearResetToken,
  getUserByValidResetTokenHash,
  getSettings,
  saveSettings,
  setTelegramChatId,
  clearTelegramChatId,
  setTelegramLinkCode,
  getUserByTelegramChatId,
  getUserByLinkCode,
  listUsersWithReminderEnabled,
  getBotOffset,
  setBotOffset,
  getEntry,
  listEntries,
  saveEntry,
  listGoalsByStatus,
  createGoal,
  setGoalStatus,
  deleteGoal,
  getSession,
  setSession,
  destroySession,
  migrateLegacyData,
};
