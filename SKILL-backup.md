---
name: telegram-clock-alert-bot
description: Background and feature spec for telegram-clock-alert-bot — a Python service that lets the user text a Telegram bot "事項 分鐘數" (e.g. 洗衣服 60) to start a repeating reminder, which fires once after that many minutes and then re-fires every N minutes (default 10, adjustable via 提醒時間 N) until the user replies "事項 ok" or "事項 完成". Pure Telegram interaction, no external account/Google integration. Use when the user references "telegram-clock-alert-bot", 「事項提醒」/「鬧鐘機器人」, ClockAlertFromTeBot, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-clock-alert-bot

Base directory for this skill: `C:\claude_practicefiles\.claude\skills\telegram-clock-alert-bot`

## What this is

A small Python backend, pure Telegram long-polling, no external account —
the user texts a dedicated Telegram bot `事項 分鐘數` (e.g. `洗衣服 60`) and
gets reminded once after that many minutes, then nagged every N minutes
(default 10) until they reply `事項 ok` or `事項 完成`. Sibling project to
[[project_telegram_calendar_bot]], [[project_telegram_heartsutra_bot]], and
[[project_telegram_relation_mark_bot]] — same Telegram-long-polling +
Render + UptimeRobot skeleton, but **the only one of the four with no Google
Cloud/OAuth dependency at all**: state lives entirely in the process's
memory via python-telegram-bot's `JobQueue` (APScheduler under the hood).

- Local repo: `C:\claude_practicefiles\telegram-clock-alert-bot` (git,
  `master` branch)
- GitHub: https://github.com/sunnywin99/telegram-clock-alert-bot (private)
- `gh` (GitHub CLI) already authenticated on this machine under account
  `sunnywin99` — same account as [[project_trade_calc]].
- Deploy target: **Render free Web Service** (Python backend, not a Claude
  Artifact). **Deployed and live as of 2026-08-27**:
  `https://telegram-clock-alert-bot.onrender.com` (service id
  `srv-da7rrpqjnfac7397m8eg`, region Oregon). Kept alive via an UptimeRobot
  HTTP(s) monitor hitting the Flask health-check route (`/`) every 5
  minutes — **especially important for this project**: unlike the other
  bots, if Render's free instance spins down, reminders scheduled to fire
  during that window are simply missed/delayed, not just "slow to answer".
- Development happens on 第二台桌電 — see [[machine_setup]].
- Telegram bot: **ClockAlertFromTeBot**, a bot the user had already created
  via @BotFather before asking for this feature (token supplied directly in
  chat, not created fresh by Claude this session — unlike the sibling bots'
  per-project-gets-its-own-bot pattern where Claude walks the user through
  @BotFather).
- For the full chronological build history (translated to plain Traditional
  Chinese), see [[project_telegram_clock_alert_bot_history]] / the
  telegram-clock-alert-bot-history Artifact — that's the authoritative
  changelog, this file is just an orientation summary.

**Always re-read `bot.py` and run `git log --oneline` in the repo before
making changes** — this file is a snapshot as of commit `fcd2166`
(2026-08-27) and the code may have moved on since.

## Message format and design decisions

- **Start a reminder**: `事項 分鐘數`, e.g. `洗衣服 60` → first alert fires
  `分鐘數` minutes later. Parsed via `text.rsplit(maxsplit=1)` — everything
  before the last space is the 事項 name (so names with spaces in them work
  as long as the trailing token is the number/ok/完成).
- **Stop a reminder**: `事項 ok` or `事項 完成` (`DONE_WORDS = {"ok", "OK",
  "Ok", "完成"}`).
- **Change the repeat interval**: `提醒時間 分鐘數`, e.g. `提醒時間 5`. This
  is a **single global setting** (`settings["interval_minutes"]`, default
  10), not per-task — chosen for simplicity since the user didn't ask for
  per-task intervals. It's read fresh every time the next repeat is
  scheduled, so changing it takes effect immediately on all currently
  running reminders, not just future ones.
- **Same 事項 name started again while already running** → the old job is
  cancelled and a fresh countdown starts (`_start_reminder` calls
  `_cancel_job` first). This wasn't explicitly requested but is the obvious
  reading of "if I retype the same task" and matches how a real alarm reset
  would behave.
- **Multiple concurrent named reminders** are supported — `active_reminders`
  is a dict keyed by 事項 name, so `洗衣服 60` and `煮飯 30` running at the
  same time are independent.
- State is **not persisted** — a Render redeploy or process restart loses
  all in-flight reminders. Deliberate simplicity: alarms are inherently
  short-lived/ephemeral, unlike the sibling bots' Google-Sheets-backed data
  which needs to survive indefinitely.

## Architecture

```
Telegram user ──("洗衣服 60")──> bot.py (long polling, python-telegram-bot)
                                      │
                                      ├─ parts = text.rsplit(maxsplit=1)
                                      ├─ name == "提醒時間"? → set settings["interval_minutes"], reply
                                      ├─ action in DONE_WORDS? → cancel active_reminders[name]'s Job, reply
                                      └─ action is a positive int? → _start_reminder:
                                            job_queue.run_once(_on_first_alert, minutes) 
                                            active_reminders[name] = {job, initial_minutes, chat_id}

_on_first_alert (fires once, N minutes later)
    ├─ send "「事項」N分到了！..."
    └─ _schedule_repeat → job_queue.run_once(_on_repeat_alert, settings["interval_minutes"])

_on_repeat_alert (fires repeatedly until cancelled)
    ├─ send "提醒：「事項」還沒完成..."
    └─ _schedule_repeat again (reads settings["interval_minutes"] fresh each time)
```

`bot.py` also runs a tiny Flask app (`/` → "telegram-clock-alert-bot is
running") in a background thread purely so Render's free Web Service tier
has an HTTP endpoint to consider "alive" — the actual bot logic is 100%
Telegram long polling, no webhook. JobQueue requires the
`python-telegram-bot[job-queue]` extra (pulls in `apscheduler`).

### Environment variables (set in Render's dashboard, never committed)

| Key | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ClockAlertFromTeBot's token from @BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user id may control reminders (`8735906224`, same account as the sibling bots — get via @userinfobot) |
| `PORT` | Set automatically by Render |

That's it — no Google credentials, no OAuth, no spreadsheet id. This is the
simplest env-var footprint of any bot in this family.

## Working style for this project

Same user as [[project_trade_calc]] and the other Telegram bots — expect
Traditional Chinese only (see [[feedback_chinese_only]]). Local testing
pattern: run `bot.py` locally with env vars set via the venv's Python,
confirm a real Telegram round-trip, stop the local process before deploying
to Render (avoids a `getUpdates` polling conflict between local + cloud on
the same token). UptimeRobot's own dashboard
(`dashboard.uptimerobot.com`) is known to hang under claude-in-chrome
automation — the user sets that step up manually, same as the sibling bots.
Render deploy itself (creating the Web Service, pasting env vars) **was**
done via claude-in-chrome browser automation successfully in this project's
first build — ask which connected machine's Chrome to use each time (see
[[machine_setup]] for the current, corrected deviceId↔machine-name mapping).

## When invoked

1. Confirm the repo is still at `C:\claude_practicefiles\telegram-clock-alert-bot`
   and check `git log --oneline -10` + skim `bot.py` to see what's changed
   since this doc was written.
2. Summarize current state / answer the user's question using the fresh
   info, not blindly from this file.
3. If asked to continue development, every change follows the same
   **standing 6-step workflow** (see
   [[feedback_telegram_clock_alert_bot_workflow]], mirroring the sibling
   bots' workflow, minus any Google-Cloud-console step since this project
   has none):
   1. Edit the code (`bot.py`/`README.md`).
   2. `git commit` + `git push` (telegram-clock-alert-bot repo).
   3. Confirm Render picked up the new commit and redeployed cleanly (check
      the Render dashboard's Deploy/Logs tab) — pushing to GitHub does not
      by itself mean the live bot is running the new code. **Also note**:
      a redeploy clears `active_reminders` — any reminders in flight at
      that moment are lost, which is expected/acceptable for this project.
   4. Add a new `ENTRIES` item to telegram-clock-alert-bot-history's
      `index.html` (translated to plain Traditional Chinese), then
      commit/push/republish that repo's Artifact.
   5. Update this skill file (`SKILL.md`) with whatever changed, and sync
      `SKILL-backup.md` in the telegram-clock-alert-bot repo (commit+push)
      so the disaster-recovery backup copy doesn't drift.
   6. Update memory (`[[project_telegram_clock_alert_bot]]` and any other
      relevant memory file) with what changed and why.
