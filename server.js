require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
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

  const content = existing ? existing.content : "";
  res.render("entry", {
    date,
    displayDate: formatDisplayDate(date),
    prompt,
    content,
    tags: extractTags(content),
    isToday: date === todayStr(),
    saved: false,
    activeGoals: activeGoalsForSidebar(),
  });
});

app.post("/entry/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).send("Invalid date");

  const { prompt, content } = req.body;
  db.saveEntry(date, prompt || promptForDate(date), content || "");

  res.render("entry", {
    date,
    displayDate: formatDisplayDate(date),
    prompt: prompt || promptForDate(date),
    content: content || "",
    tags: extractTags(content || ""),
    isToday: date === todayStr(),
    saved: true,
    activeGoals: activeGoalsForSidebar(),
  });
});

function activeGoalsForSidebar() {
  return db.listGoalsByStatus("active").map((g) => ({
    ...g,
    displayTargetDate: g.target_date ? formatDisplayDate(g.target_date) : null,
  }));
}

app.get("/history", (req, res) => {
  let entries = db.listEntries().map((e) => ({
    ...e,
    displayDate: formatDisplayDate(e.date),
    tags: extractTags(e.content),
  }));

  const tagFilter = req.query.tag || null;
  if (tagFilter) {
    const wanted = tagFilter.toLowerCase();
    entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === wanted));
  }

  res.render("history", { entries, tagFilter });
});

app.get("/calendar", (req, res) => {
  const today = todayStr();
  let [year, month] = today.split("-").map(Number);
  if (/^\d{4}-\d{2}$/.test(req.query.month || "")) {
    [year, month] = req.query.month.split("-").map(Number);
  }

  const entryDates = new Set(db.listEntries().map((e) => e.date));

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
    activeGoals: db.listGoalsByStatus("active").map(formatGoal),
    completedGoals: db.listGoalsByStatus("completed").map(formatGoal),
    error: null,
  });
});

app.post("/goals", (req, res) => {
  const title = (req.body.title || "").trim();
  const target_date = req.body.target_date || "";

  if (!title) {
    return res.render("goals", {
      activeGoals: db.listGoalsByStatus("active").map(formatGoal),
      completedGoals: db.listGoalsByStatus("completed").map(formatGoal),
      error: "A goal needs at least a title.",
    });
  }
  if (target_date && !DATE_RE.test(target_date)) {
    return res.status(400).send("Invalid target date");
  }

  db.createGoal({
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
  db.setGoalStatus(Number(req.params.id), "completed");
  res.redirect("/goals");
});

app.post("/goals/:id/reactivate", (req, res) => {
  db.setGoalStatus(Number(req.params.id), "active");
  res.redirect("/goals");
});

app.post("/goals/:id/delete", (req, res) => {
  db.deleteGoal(Number(req.params.id));
  res.redirect("/goals");
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
