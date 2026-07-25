require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const telegram = require("./telegram");
const reminder = require("./reminder");
const { promptForDate, randomPrompt } = require("./prompts");

const app = express();
const PORT = process.env.PORT || 3001;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

app.get("/", (req, res) => {
  res.redirect(`/entry/${todayStr()}`);
});

app.get("/entry/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).send("Invalid date");

  const existing = db.getEntry(date);
  const basePrompt = existing ? existing.prompt : promptForDate(date);
  const prompt = req.query.newPrompt ? randomPrompt(basePrompt) : basePrompt;

  res.render("entry", {
    date,
    prompt,
    content: existing ? existing.content : "",
    isToday: date === todayStr(),
    saved: false,
  });
});

app.post("/entry/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).send("Invalid date");

  const { prompt, content } = req.body;
  db.saveEntry(date, prompt || promptForDate(date), content || "");

  res.render("entry", {
    date,
    prompt: prompt || promptForDate(date),
    content: content || "",
    isToday: date === todayStr(),
    saved: true,
  });
});

app.get("/history", (req, res) => {
  const entries = db.listEntries();
  res.render("history", { entries });
});

app.get("/settings", (req, res) => {
  res.render("settings", {
    settings: db.getSettings(),
    telegramConfigured: telegram.isConfigured(),
    message: null,
    error: null,
  });
});

app.post("/settings", (req, res) => {
  const reminder_enabled = req.body.reminder_enabled === "on";
  const reminder_time = req.body.reminder_time || "20:00";

  const settings = db.saveSettings({ reminder_enabled, reminder_time });
  reminder.reschedule();

  res.render("settings", {
    settings,
    telegramConfigured: telegram.isConfigured(),
    message: "Settings saved.",
    error: null,
  });
});

app.post("/settings/test", async (req, res) => {
  const settings = db.getSettings();
  let message = null;
  let error = null;
  try {
    await telegram.sendReminder(settings.telegram_chat_id, promptForDate(todayStr()));
    message = "Test message sent!";
  } catch (err) {
    error = err.message;
  }

  res.render("settings", {
    settings,
    telegramConfigured: telegram.isConfigured(),
    message,
    error,
  });
});

function saveTelegramReply(text) {
  const date = todayStr();
  const existing = db.getEntry(date);
  const prompt = existing ? existing.prompt : promptForDate(date);
  const content = existing && existing.content ? `${existing.content}\n\n${text}` : text;
  db.saveEntry(date, prompt, content);
  console.log(`[telegram] Saved journal entry for ${date}`);
}

app.listen(PORT, () => {
  console.log(`Journal app running at http://localhost:${PORT}`);
  reminder.reschedule();

  if (telegram.isConfigured()) {
    setInterval(() => {
      telegram.pollUpdates(saveTelegramReply).catch((err) => {
        console.error("[telegram] Poll failed:", err.message);
      });
    }, 4000);
  }
});
