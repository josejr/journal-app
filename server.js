require("dotenv").config();
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const path = require("path");
const db = require("./db");
const { hashPassword, verifyPassword, hashToken } = require("./auth");
const SqliteSessionStore = require("./sessionStore");
const mailer = require("./mailer");
const telegram = require("./telegram");
const reminder = require("./reminder");
const { promptForDate, randomPrompt } = require("./prompts");
const { formatDisplayDate, monthLabel, daysInMonth, startWeekday, shiftMonth, monthKey } = require("./dates");
const { extractTags } = require("./tags");

const app = express();
const PORT = process.env.PORT || 3001;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(__dirname, "data", "session-secret");
  try {
    return fs.readFileSync(secretPath, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function generateLinkCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += LINK_CODE_CHARS[crypto.randomInt(LINK_CODE_CHARS.length)];
  return code;
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function todayStr() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  const user = db.getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).send("Admins only");
  next();
}

app.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  const message = req.query.reset === "success" ? "Password reset. Log in with your new password." : null;
  res.render("login", { error: null, message });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername((username || "").trim());

  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.render("login", { error: "Invalid username or password.", message: null });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).send("Login failed");
    req.session.userId = user.id;
    res.redirect("/");
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/forgot-password", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("forgot-password", { mailerConfigured: mailer.isConfigured(), message: null, error: null });
});

app.post("/forgot-password", (req, res) => {
  const email = (req.body.email || "").trim();
  const user = db.getUserByEmail(email);

  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    db.setResetToken(user.id, hashToken(token), Date.now() + RESET_TOKEN_TTL_MS);
    const resetUrl = `${req.protocol}://${req.get("host")}/reset-password/${token}`;
    mailer
      .sendPasswordResetEmail(user.email, resetUrl)
      .catch((err) => console.error("[mailer] Failed to send reset email:", err.message));
  }

  // Same message whether or not the email matched an account, so this can't be used to probe who has one.
  res.render("forgot-password", {
    mailerConfigured: mailer.isConfigured(),
    message: "If an account exists for that email, a reset link is on its way.",
    error: null,
  });
});

app.get("/reset-password/:token", (req, res) => {
  const user = db.getUserByValidResetTokenHash(hashToken(req.params.token));
  res.render("reset-password", { token: req.params.token, valid: Boolean(user), error: null });
});

app.post("/reset-password/:token", (req, res) => {
  const user = db.getUserByValidResetTokenHash(hashToken(req.params.token));
  if (!user) {
    return res.render("reset-password", { token: req.params.token, valid: false, error: null });
  }

  const { password, confirm } = req.body;
  if (!password || password.length < 6) {
    return res.render("reset-password", {
      token: req.params.token,
      valid: true,
      error: "Password must be at least 6 characters.",
    });
  }
  if (password !== confirm) {
    return res.render("reset-password", { token: req.params.token, valid: true, error: "Passwords didn't match." });
  }

  db.setPassword(user.id, hashPassword(password));
  db.clearResetToken(user.id);
  res.redirect("/login?reset=success");
});

app.use(requireAuth);

app.get("/", (req, res) => {
  res.redirect(`/entry/${todayStr()}`);
});

app.get("/entry/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).send("Invalid date");

  const existing = db.getEntry(req.user.id, date);
  const basePrompt = existing ? existing.prompt : promptForDate(date);
  const prompt = req.query.newPrompt ? randomPrompt(basePrompt) : basePrompt;

  const content = existing ? existing.content : "";
  res.render("entry", {
    user: req.user,
    date,
    displayDate: formatDisplayDate(date),
    prompt,
    content,
    tags: extractTags(content),
    isToday: date === todayStr(),
    saved: false,
    activeGoals: activeGoalsForSidebar(req.user.id),
  });
});

app.post("/entry/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).send("Invalid date");

  const { prompt, content } = req.body;
  db.saveEntry(req.user.id, date, prompt || promptForDate(date), content || "");

  res.render("entry", {
    user: req.user,
    date,
    displayDate: formatDisplayDate(date),
    prompt: prompt || promptForDate(date),
    content: content || "",
    tags: extractTags(content || ""),
    isToday: date === todayStr(),
    saved: true,
    activeGoals: activeGoalsForSidebar(req.user.id),
  });
});

function activeGoalsForSidebar(userId) {
  return db.listGoalsByStatus(userId, "active").map((g) => ({
    ...g,
    displayTargetDate: g.target_date ? formatDisplayDate(g.target_date) : null,
  }));
}

app.get("/history", (req, res) => {
  let entries = db.listEntries(req.user.id).map((e) => ({
    ...e,
    displayDate: formatDisplayDate(e.date),
    tags: extractTags(e.content),
  }));

  const tagFilter = req.query.tag || null;
  if (tagFilter) {
    const wanted = tagFilter.toLowerCase();
    entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === wanted));
  }

  res.render("history", { user: req.user, entries, tagFilter });
});

app.get("/calendar", (req, res) => {
  const today = todayStr();
  let [year, month] = today.split("-").map(Number);
  if (/^\d{4}-\d{2}$/.test(req.query.month || "")) {
    [year, month] = req.query.month.split("-").map(Number);
  }

  const entryDates = new Set(db.listEntries(req.user.id).map((e) => e.date));

  const cells = [];
  for (let i = 0; i < startWeekday(year, month); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, date, hasEntry: entryDates.has(date), isToday: date === today });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  res.render("calendar", {
    user: req.user,
    monthLabel: monthLabel(year, month),
    weeks,
    prevMonth: monthKey(prev.year, prev.month),
    nextMonth: monthKey(next.year, next.month),
  });
});

function formatGoal(g) {
  return { ...g, displayTargetDate: g.target_date ? formatDisplayDate(g.target_date) : null };
}

app.get("/goals", (req, res) => {
  res.render("goals", {
    user: req.user,
    activeGoals: db.listGoalsByStatus(req.user.id, "active").map(formatGoal),
    completedGoals: db.listGoalsByStatus(req.user.id, "completed").map(formatGoal),
    error: null,
  });
});

app.post("/goals", (req, res) => {
  const title = (req.body.title || "").trim();
  const target_date = req.body.target_date || "";

  if (!title) {
    return res.render("goals", {
      user: req.user,
      activeGoals: db.listGoalsByStatus(req.user.id, "active").map(formatGoal),
      completedGoals: db.listGoalsByStatus(req.user.id, "completed").map(formatGoal),
      error: "A goal needs at least a title.",
    });
  }
  if (target_date && !DATE_RE.test(target_date)) {
    return res.status(400).send("Invalid target date");
  }

  db.createGoal(req.user.id, {
    title,
    specific: (req.body.specific || "").trim(),
    measurable: (req.body.measurable || "").trim(),
    achievable: (req.body.achievable || "").trim(),
    relevant: (req.body.relevant || "").trim(),
    target_date,
  });

  res.redirect("/goals");
});

app.post("/goals/:id/complete", (req, res) => {
  db.setGoalStatus(req.user.id, Number(req.params.id), "completed");
  res.redirect("/goals");
});

app.post("/goals/:id/reactivate", (req, res) => {
  db.setGoalStatus(req.user.id, Number(req.params.id), "active");
  res.redirect("/goals");
});

app.post("/goals/:id/delete", (req, res) => {
  db.deleteGoal(req.user.id, Number(req.params.id));
  res.redirect("/goals");
});

app.get("/settings", (req, res) => {
  res.render("settings", {
    user: req.user,
    settings: db.getSettings(req.user.id),
    telegramConfigured: telegram.isConfigured(),
    message: null,
    error: null,
  });
});

app.post("/settings", (req, res) => {
  const reminder_enabled = req.body.reminder_enabled === "on";
  const reminder_time = req.body.reminder_time || "20:00";

  const settings = db.saveSettings(req.user.id, { reminder_enabled, reminder_time });

  res.render("settings", {
    user: req.user,
    settings,
    telegramConfigured: telegram.isConfigured(),
    message: "Settings saved.",
    error: null,
  });
});

app.post("/settings/test", async (req, res) => {
  const settings = db.getSettings(req.user.id);
  let message = null;
  let error = null;
  try {
    await telegram.sendReminder(settings.telegram_chat_id, promptForDate(todayStr()));
    message = "Test message sent!";
  } catch (err) {
    error = err.message;
  }

  res.render("settings", {
    user: req.user,
    settings,
    telegramConfigured: telegram.isConfigured(),
    message,
    error,
  });
});

app.post("/settings/telegram/link", (req, res) => {
  db.setTelegramLinkCode(req.user.id, generateLinkCode());
  res.redirect("/settings");
});

app.post("/settings/telegram/unlink", (req, res) => {
  db.clearTelegramChatId(req.user.id);
  res.redirect("/settings");
});

app.post("/settings/account", (req, res) => {
  const email = (req.body.email || "").trim();
  const existing = db.getUserByEmail(email);
  let message = null;
  let error = null;

  if (email && existing && existing.id !== req.user.id) {
    error = `"${email}" is already in use by another account.`;
  } else {
    db.setUserEmail(req.user.id, email);
    req.user.email = email;
    message = "Email updated.";
  }

  res.render("settings", {
    user: req.user,
    settings: db.getSettings(req.user.id),
    telegramConfigured: telegram.isConfigured(),
    message,
    error,
  });
});

app.get("/admin/users", requireAdmin, (req, res) => {
  res.render("admin-users", { user: req.user, users: db.listUsers(), error: null, message: null });
});

app.post("/admin/users", requireAdmin, (req, res) => {
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim();
  const password = req.body.password || "";
  const is_admin = req.body.is_admin === "on";

  if (!username || !password) {
    return res.render("admin-users", {
      user: req.user,
      users: db.listUsers(),
      error: "Username and password are both required.",
      message: null,
    });
  }
  if (db.getUserByUsername(username)) {
    return res.render("admin-users", {
      user: req.user,
      users: db.listUsers(),
      error: `"${username}" is already taken.`,
      message: null,
    });
  }
  if (email && db.getUserByEmail(email)) {
    return res.render("admin-users", {
      user: req.user,
      users: db.listUsers(),
      error: `"${email}" is already in use by another account.`,
      message: null,
    });
  }

  db.createUser({ username, email, password_hash: hashPassword(password), is_admin });

  res.render("admin-users", {
    user: req.user,
    users: db.listUsers(),
    error: null,
    message: `Created account for "${username}".`,
  });
});

function handleTelegramMessage(chatId, text) {
  const linkUser = db.getUserByLinkCode(text.trim());
  if (linkUser) {
    db.setTelegramChatId(linkUser.id, chatId);
    telegram
      .sendMessage(chatId, "Linked! I'll send your daily journal prompt here — just reply to save your entry.")
      .catch((err) => console.error("[telegram] Failed to confirm link:", err.message));
    return;
  }

  const user = db.getUserByTelegramChatId(chatId);
  if (!user) {
    telegram
      .sendMessage(chatId, "This chat isn't linked yet. Generate a link code from Settings in the app and send it here.")
      .catch((err) => console.error("[telegram] Failed to reply:", err.message));
    return;
  }

  const date = todayStr();
  const existing = db.getEntry(user.id, date);
  const prompt = existing ? existing.prompt : promptForDate(date);
  const content = existing && existing.content ? `${existing.content}\n\n${text}` : text;
  db.saveEntry(user.id, date, prompt, content);
  console.log(`[telegram] Saved journal entry for ${user.username} (${date})`);
}

app.listen(PORT, () => {
  console.log(`Journal app running at http://localhost:${PORT}`);
  reminder.reschedule();

  if (telegram.isConfigured()) {
    setInterval(() => {
      telegram.pollUpdates(handleTelegramMessage).catch((err) => {
        console.error("[telegram] Poll failed:", err.message);
      });
    }, 4000);
  }
});
