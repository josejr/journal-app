# Daily Journal

A small multiuser daily journal app with writing prompts and optional per-user Telegram reminders.

## Features

- Multiuser accounts with login/logout; each user's entries, goals, and settings are private to them
- Invite-only signup — new accounts are created by an admin from the Admin page, not self-service
- A new writing prompt each day (consistent per date, with a shuffle option if you want a different one)
- Save and revisit past entries in a simple history view, and edit any previous day's entry
- Dates displayed as mm/dd/yyyy throughout
- Hashtags — type `#anything` in an entry and it becomes a clickable tag; click a tag to filter History to matching entries
- Calendar view — a month grid showing which days have entries, with one click through to any day
- S.M.A.R.T. goals — track goals (Specific, Measurable, Achievable, Relevant, Time-bound) on a dedicated Goals page; active goals show as a condensed sidebar next to the journal entry
- Free daily reminders via a Telegram bot — the bot sends you the day's prompt, and replying to it in Telegram saves that message as the day's entry; each user links their own Telegram chat independently
- "Forgot password?" on the login page emails a time-limited reset link, if the account has an email on file and SMTP is configured

## Setup

```bash
npm install
cp .env.example .env
npm run create-admin
npm start
```

`create-admin` is a one-time interactive script that creates your first (admin) account. If you're upgrading from a
pre-multiuser copy of this app, it also attaches any existing journal entries, goals, and settings to that new account
so nothing is lost.

The app runs at `http://localhost:3001` by default (override with `PORT` in `.env`). Log in at `/login`.

## Adding more users

Once you're logged in as an admin, go to **Admin** in the nav (visible only to admins) to create additional accounts
with a username and temporary password. There's no public signup page — accounts are invite-only.

## Telegram reminders (optional)

1. Create a bot via [@BotFather](https://t.me/BotFather) in Telegram (`/newbot`) and copy the token it gives you.
2. Set `TELEGRAM_BOT_TOKEN` in `.env` and restart the app.
3. Each user links their own chat from their Settings page: click "Generate link code", then send that code to the
   bot in Telegram to link it to your account.
4. Turn on the daily reminder from Settings and pick a time.

Once linked, the bot sends that user's daily prompt at their chosen time, and any reply they send is saved as that
day's journal entry for their account. One bot token is shared across all users; the bot tells each linked chat apart
by which account's link code (or previously linked chat ID) matches.

## Password resets (optional)

1. Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` in `.env` (works with any standard SMTP provider — a Gmail account
   with an [app password](https://myaccount.google.com/apppasswords), SendGrid, Mailgun, etc.) and restart the app.
2. Each user adds their email from Settings > Account.
3. "Forgot password?" on the login page emails that user a link, valid for 1 hour and usable once, to set a new
   password.

Without SMTP configured, the forgot-password page says so. There's no admin-side password override yet, so make sure
your own account has an email set once SMTP is configured — otherwise recovering a lost admin password means editing
the database directly.

## Tech stack

- Express + EJS for the server and views
- better-sqlite3 for storage, including a custom SQLite-backed session store
- Node's built-in `crypto.scrypt` for password hashing (no extra auth dependency)
- nodemailer for password-reset emails via SMTP
- node-cron for scheduling daily reminders (checked per-user, once a minute)
- Telegram Bot API (via `fetch`, no extra SDK) for reminders and entry capture
