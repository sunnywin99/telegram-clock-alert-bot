---
name: telegram-clock-alert-bot
description: Background and feature spec for telegram-clock-alert-bot — a Python service that lets the user text a Telegram bot "事項 分鐘數" (e.g. 洗衣服 60) to start a repeating reminder, which fires once after that many minutes and then re-fires every N minutes (default 10, adjustable via 提醒時間 N) until the user replies "事項 ok" or "事項 完成", plus fixed daily routine and water-drinking reminders. Pure Telegram interaction, no external account/Google integration. Use when the user references "telegram-clock-alert-bot", 「事項提醒」/「鬧鐘機器人」, ClockAlertFromTeBot, asks to continue/resume work on it, or asks what this project is / where it lives.
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
(originally) Render + UptimeRobot skeleton, but **the only one of the four with no Google
Cloud/OAuth dependency at all**: state lives entirely in the process's
memory via python-telegram-bot's `JobQueue` (APScheduler under the hood).

- Local repo: `C:\claude_practicefiles\telegram-clock-alert-bot` (git,
  `master` branch)
- GitHub: https://github.com/sunnywin99/telegram-clock-alert-bot (private)
- `gh` (GitHub CLI) already authenticated on this machine under account
  `sunnywin99` — same account as [[project_trade_calc]].
- **Production: self-hosted third desktop PC** (Render is no longer used).
  Repo lives at `C:\telegram-clock-alert-bot` on that machine, run by the
  Windows Scheduled Task `TelegramClockAlertBot` (`install_task.ps1`:
  `SYSTEM`, `AtStartup`, auto-restart) via `run_bot.ps1`, which logs to
  `bot.log`. Env vars come from `.env` there (`load_dotenv()`).
  - History: deployed to Render free tier on 2026-08-27 (kept awake by an
    UptimeRobot monitor). Render's free 750hr/month pool ran out, so
    self-hosting support was added 2026-09-09 (see
    [[project_third_desktop_server_plan]]). The exact date Render was
    stopped wasn't recorded; the 2026-09-14 commit already targets the
    Windows self-hosted environment, so the move happened ~09-09..09-14.
    The Render service and UptimeRobot monitor are no longer needed.
  - Reminders in flight are lost whenever the desktop reboots or the task
    is restarted (accepted tradeoff, see below).
- **Development: Claude Code cloud sessions (since 2026-10-08)**, not the
  second desktop's CLI. The desktop only runs the bot; it gets new code via
  `git pull` + task restart (see workflow). Never edit files directly on the
  desktop — uncommitted local edits there made `git pull` fail once
  (resolved with `git stash`).
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
making changes** — this file is a snapshot as of commit `161e703`
(2026-10-08) and the code may have moved on since.

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
- State is **not persisted** — a desktop reboot or bot restart loses
  all in-flight reminders, and resets the water toggle (on) and the repeat
  interval (10). Deliberate simplicity: alarms are inherently
  short-lived/ephemeral, unlike the sibling bots' Google-Sheets-backed data
  which needs to survive indefinitely.

- **Water reminder** (`喝水提醒`): sends 「喝水提醒：該喝水了，喝 150cc 水。」 at
  minute 10 of hours 7, 10, 11, 14, 15, 16, 17 (`WATER_REMINDER_MINUTE`,
  `range(7, 18)` minus `WATER_REMINDER_SKIP_HOURS = {8, 9, 12, 13}` — right
  after breakfast/lunch; nothing after 17:10 so it never collides with the
  20:10 wind-down). On by default; `喝水提醒 關/開` toggles
  `settings["water_reminder_enabled"]`. The user explicitly does **not**
  want on-the-hour reminders.
- **Fixed daily routine** (`FIXED_REMINDERS`, no toggle, deliberately not
  put in Google Calendar): 05:00 起床, 05:25 打坐, 06:00 準備早餐, 06:40 超慢跑,
  11:25 包素食便當 (Mon–Sat only), 20:10 關手機及電腦準備睡覺, 21:25 打坐,
  22:10 睡覺. Both water and routine reminders are `job_queue.run_daily`
  jobs scheduled at startup to `ALLOWED_TELEGRAM_USER_ID`.
- `/help` (`USAGE_TEXT`) lists all of the above — keep it in sync with any
  time change, along with `README.md`.

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
running") in a background thread, left over from the Render days when the
free Web Service tier needed an HTTP endpoint to consider "alive" — the actual bot logic is 100%
Telegram long polling, no webhook. JobQueue requires the
`python-telegram-bot[job-queue]` extra (pulls in `apscheduler`).

### Environment variables (`.env` on the desktop, never committed)

| Key | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ClockAlertFromTeBot's token from @BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user id may control reminders (`8735906224`, same account as the sibling bots — get via @userinfobot) |
| `PORT` | Health-check port, default 8080; set distinct values if several bots share the desktop |

That's it — no Google credentials, no OAuth, no spreadsheet id. This is the
simplest env-var footprint of any bot in this family.

## Working style for this project

Same user as [[project_trade_calc]] and the other Telegram bots — expect
Traditional Chinese only (see [[feedback_chinese_only]]). The user is not a
PowerShell expert: give exact commands to paste, and remember the scheduled
task runs as `SYSTEM`, so stopping/starting it needs an **administrator**
PowerShell (otherwise `HRESULT 0x80070005`). There is no
`Restart-ScheduledTask` cmdlet. Two `python.exe` processes for `bot.py` is
normal (the venv launcher spawns the real interpreter as a child).

Note: `bot.log` contains the bot token, because httpx logs every
`api.telegram.org/bot<TOKEN>/...` request URL at INFO level. Don't ask the
user to paste raw log lines without warning them.

## When invoked

1. Check `git log --oneline -10` + skim `bot.py` to see what's changed
   since this doc was written.
2. Summarize current state / answer the user's question using the fresh
   info, not blindly from this file.
3. If asked to continue development, every change follows this
   **standing 5-step workflow**:
   1. Edit the code (`bot.py`/`README.md`, keep `USAGE_TEXT` in sync),
      `python3 -m py_compile bot.py`.
   2. Commit + push to the session's branch, then (with the user's OK)
      fast-forward `master`. `master` is always what the desktop runs.
   3. Tell the user to update the desktop, in an administrator PowerShell
      in `C:\telegram-clock-alert-bot`:
      ```powershell
      git pull
      Stop-ScheduledTask -TaskName "TelegramClockAlertBot"
      Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*bot.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
      Start-ScheduledTask -TaskName "TelegramClockAlertBot"
      ```
      then send `/help` to confirm the new version. Restarting clears
      in-flight reminders.
   4. Add a new `ENTRIES` item to telegram-clock-alert-bot-history's
      `index.html` (plain Traditional Chinese), commit/push to its
      `master`, and republish its Artifact:
      https://claude.ai/artifact/CCetjwWe42F1yiqMhYpybg
   5. Update this `SKILL-backup.md` (commit + push). If the second
      desktop's CLI is still used, copy it to
      `.claude/skills/telegram-clock-alert-bot/SKILL.md` there too.
