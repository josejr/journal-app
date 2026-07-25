# Daily Journal

A small daily journal app with writing prompts and optional Telegram reminders.

## Features

- A new writing prompt each day (consistent per date, with a shuffle option if you want a different one)
- Save and revisit past entries in a simple history view, and edit any previous day's entry
- Dates displayed as mm/dd/yyyy throughout
- Hashtags — type `#anything` in an entry and it becomes a clickable tag; click a tag to filter History to matching entries
- Calendar view — a month grid showing which days have entries, with one click through to any day
- Free daily reminders via a Telegram bot — the bot sends you the day's prompt, and replying to it in Telegram saves that message as the day's entry

## Setup

```bash
npm install
cp .env.example .env
npm start
```

The app runs at `http://localhost:3001` by default (override with `PORT` in `.env`).

## Telegram reminders (optional)

1. Create a bot via [@BotFather](https://t.me/BotFather) in Telegram (`/newbot`) and copy the token it gives you.
2. Set `TELEGRAM_BOT_TOKEN` in `.env`.
3. Restart the app, then open a chat with your bot and send it any message — it links automatically and confirms.
4. Turn on the daily reminder from the Settings page and pick a time.

Once linked, the bot sends you the day's prompt at your chosen time, and any reply you send is saved as that day's journal entry.

## Tech stack

- Express + EJS for the server and views
- better-sqlite3 for storage
- node-cron for scheduling the daily reminder
- Telegram Bot API (via `fetch`, no extra SDK) for reminders and entry capture
