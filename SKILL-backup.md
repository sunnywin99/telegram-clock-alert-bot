---
name: telegram-clock-alert-bot
description: Background and feature spec for telegram-clock-alert-bot — a Cloudflare Worker (JavaScript, formerly Python) that lets the user text a Telegram bot "事項 分鐘數" (e.g. 洗衣服 60) to start a repeating reminder, which fires once after that many minutes and then re-fires every N minutes (default 10, adjustable via 提醒時間 N) until the user replies "事項 ok" or "事項 完成", plus fixed daily routine and water-drinking reminders. Pure Telegram interaction, no external account/Google integration. Use when the user references "telegram-clock-alert-bot", 「事項提醒」/「鬧鐘機器人」, ClockAlertFromTeBot, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-clock-alert-bot

Base directory for this skill (second desktop's CLI): `C:\claude_practicefiles\.claude\skills\telegram-clock-alert-bot`

## What this is

A small Telegram bot with no external account — the user texts a dedicated
Telegram bot `事項 分鐘數` (e.g. `洗衣服 60`) and gets reminded once after that
many minutes, then nagged every N minutes (default 10) until they reply
`事項 ok` or `事項 完成`. It also sends fixed daily routine reminders and
water-drinking reminders. Sibling project to [[project_telegram_calendar_bot]],
[[project_telegram_heartsutra_bot]], and [[project_telegram_relation_mark_bot]],
but **the only one with no Google Cloud/OAuth dependency at all**.

- GitHub: https://github.com/sunnywin99/telegram-clock-alert-bot (private)
- **Production: Cloudflare Workers free plan (since 2026-10-25).** The
  Worker is connected to the GitHub repo via Cloudflare Workers Builds, so
  every push to `master` deploys automatically. No computer has to stay on.
  - The only secret, `TELEGRAM_BOT_TOKEN`, lives in the Cloudflare dashboard
    (Worker → Settings → Variables and Secrets). `ALLOWED_TELEGRAM_USER_ID`
    (`8735906224`) is a plain var in `wrangler.toml`.
  - After the first deploy (or if the bot stops responding) open
    `https://telegram-clock-alert-bot.sunnywin99.workers.dev/setup` — it checks the token with `getMe`
    and registers the Telegram webhook.
- History: Python + python-telegram-bot long-polling on Render free tier
  (2026-08-27, UptimeRobot keep-alive) → Render's 750hr/month pool ran out →
  self-hosted third desktop via Windows Scheduled Task (~2026-09-09..09-14)
  → the third desktop died → rewritten as a Cloudflare Worker (2026-10-25).
  The Python files were removed from the repo then; they're in git history.
  Render, UptimeRobot and the desktop scheduled task are no longer used.
- **Development: Claude Code cloud sessions (since 2026-10-08).**
- Telegram bot: **ClockAlertFromTeBot**, created by the user via @BotFather.
  The user chose to keep the original token when moving to Cloudflare.
- For the full chronological build history (plain Traditional Chinese), see
  the telegram-clock-alert-bot-history repo and its Artifact
  https://claude.ai/artifact/CCetjwWe42F1yiqMhYpybg — that's the
  authoritative changelog; this file is just an orientation summary.

**Always re-read `src/` and run `git log --oneline` in the repo before
making changes** — the code may have moved on since this file was written.

## Message format and design decisions

- **Start a reminder**: `事項 分鐘數`, e.g. `洗衣服 60` → first alert fires
  `分鐘數` minutes later. Parsed like Python's `text.rsplit(maxsplit=1)` —
  everything before the last whitespace is the 事項 name.
- **Stop a reminder**: `事項 ok` or `事項 完成` (`DONE_WORDS`).
- **Change the repeat interval**: `提醒時間 分鐘數`. A **single global
  setting** (default 10), applied from each reminder's next nag onward.
- **Same 事項 name started again** → replaces the old one, fresh countdown.
- **Multiple concurrent named reminders** are supported (keyed by name).
- **State is persisted** in a Durable Object (reminders, water toggle,
  interval) — redeploys don't lose anything. (The Python version kept it in
  memory and lost it on every restart.)
- **Water reminder** (`喝水提醒`): 「喝水提醒：該喝水了，喝 150cc 水。」 at minute
  10 of hours 7, 10, 11, 14, 15, 16, 17 (skips 8, 9, 12, 13 — right after
  breakfast/lunch; nothing after 17:10 so it never collides with the 20:10
  wind-down). On by default; `喝水提醒 關/開` toggles it. The user explicitly
  does **not** want on-the-hour reminders.
- **Fixed daily routine** (`FIXED_REMINDERS`, no toggle, deliberately not in
  Google Calendar): 05:00 起床, 05:25 打坐, 06:00 準備早餐, 06:40 超慢跑,
  11:25 包素食便當 (Mon–Sat only), 20:10 關手機及電腦準備睡覺, 21:25 打坐,
  22:10 睡覺. Times are Asia/Taipei (fixed UTC+8 in code).
- `/help` (`USAGE_TEXT` in `src/logic.js`) lists all of the above — keep it
  in sync with any time change, along with `README.md` and the tests.

## Architecture

```
Telegram ──webhook POST /telegram──> Worker (src/index.js)
                                       ├─ checks X-Telegram-Bot-Api-Secret-Token
                                       │  (= first 32 hex chars of sha256(token))
                                       ├─ checks ALLOWED_TELEGRAM_USER_ID
                                       └─ ReminderStore Durable Object ("main").handleText
                                            ├─ parseCommand (src/logic.js)
                                            ├─ updates storage, re-arms alarm
                                            └─ returns reply text

ReminderStore.alarm() / cron every 5 min ──> tick()
    ├─ daily slots in (dailyCursor, now] → send (skip if >30 min late,
    │  skip water when disabled)
    ├─ reminders with dueAt <= now → send first/repeat text,
    │  dueAt = now + interval
    └─ save state BEFORE sending (alarm and cron can interleave during
       fetch), then setAlarm(earliest next reminder or daily slot)
```

- `GET /setup` registers the webhook; `GET /` is a plain health check.
- `TELEGRAM_API_BASE` env var exists only so local tests can point at a
  fake Telegram server.
- Durable Object uses the SQLite backend (`new_sqlite_classes`), which is
  what the free plan supports.

## Working style for this project

Same user as [[project_trade_calc]] and the other Telegram bots — expect
Traditional Chinese only (see [[feedback_chinese_only]]). Not a developer:
give exact click paths / commands to paste, one step at a time.

## When invoked

1. Check `git log --oneline -10` + skim `src/` to see what's changed since
   this doc was written.
2. Summarize current state / answer the user's question using the fresh
   info, not blindly from this file.
3. If asked to continue development, every change follows this
   **standing 4-step workflow**:
   1. Edit `src/` (keep `USAGE_TEXT`, `README.md`, `test/` in sync),
      run `npm test`. For behavior changes, a local run with
      `npx wrangler dev` + a fake Telegram server via `TELEGRAM_API_BASE`
      in `.dev.vars` is a good end-to-end check.
   2. Commit + push to the session's branch, then (with the user's OK)
      fast-forward `master`. Cloudflare auto-deploys `master`; check the
      Worker's Deployments tab if the user reports nothing changed.
   3. Add a new `ENTRIES` item to telegram-clock-alert-bot-history's
      `index.html` (plain Traditional Chinese), commit/push to its
      `master`, and republish its Artifact:
      https://claude.ai/artifact/CCetjwWe42F1yiqMhYpybg
   4. Update this `SKILL-backup.md` (commit + push).
