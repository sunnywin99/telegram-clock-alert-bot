"""
主程式：Telegram 長輪詢，做「事項提醒／鬧鐘」機器人。
Render 免費方案保活用的健康檢查網址也在這裡。

用法：
    洗衣服 60          → 60 分鐘後提醒「洗衣服 60分到了」，之後預設每 10 分鐘催一次
    洗衣服 ok / 洗衣服 完成  → 停止「洗衣服」的提醒
    提醒時間 5          → 把重複提醒的間隔改成 5 分鐘（預設 10 分鐘，套用到所有進行中的提醒）

環境變數（Render 的 Environment 頁籤設定，或本機/自架伺服器同資料夾的 .env 檔，見 .env.example）：
    TELEGRAM_BOT_TOKEN        跟 @BotFather 申請的 token
    ALLOWED_TELEGRAM_USER_ID  只允許這個 Telegram user id 的訊息被處理（防止別人亂用）
    PORT                      Render 會自動設定；自架伺服器同時跑多個 bot 時要各自設不同埠號
"""
import logging
import os
import threading
from datetime import time, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import Flask
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ALLOWED_TELEGRAM_USER_ID = int(os.environ["ALLOWED_TELEGRAM_USER_ID"])
PORT = int(os.environ.get("PORT", "8080"))

TIMEZONE = ZoneInfo("Asia/Taipei")

DEFAULT_INTERVAL_MINUTES = 10
INTERVAL_TASK_NAME = "提醒時間"
DONE_WORDS = {"ok", "OK", "Ok", "完成"}

WATER_REMINDER_NAME = "喝水提醒"
WATER_REMINDER_HOURS = range(7, 21)  # 7:00 ~ 20:00，整點各一次
WATER_REMINDER_TEXT = "喝水提醒：該喝水了，喝 150cc 水。"
ON_WORDS = {"開", "開啟", "on", "On", "ON"}
OFF_WORDS = {"關", "關閉", "off", "Off", "OFF"}

# 進行中的提醒：{事項名稱: {"job": Job, "initial_minutes": int, "chat_id": int}}
active_reminders: dict[str, dict] = {}
# 重複提醒間隔（分鐘），"提醒時間 N" 會改這個值，套用到所有進行中與之後的提醒
# 喝水提醒開關（預設開啟），"喝水提醒 開／關" 會改這個值
settings = {"interval_minutes": DEFAULT_INTERVAL_MINUTES, "water_reminder_enabled": True}

USAGE_TEXT = (
    "這是事項提醒（鬧鐘）機器人，用法：\n\n"
    "開始提醒：傳「事項 分鐘數」，例如：\n"
    "洗衣服 60\n"
    "→ 60 分鐘後提醒你「洗衣服 60分到了」，之後預設每 10 分鐘催一次，直到你回覆完成。\n\n"
    "停止提醒：傳「事項 ok」或「事項 完成」，例如：\n"
    "洗衣服 完成\n\n"
    f"改重複提醒間隔（預設 {DEFAULT_INTERVAL_MINUTES} 分鐘）：傳「提醒時間 分鐘數」，例如：\n"
    "提醒時間 5\n"
    "→ 之後每 5 分鐘催一次（立刻套用到所有進行中的提醒）。\n\n"
    "喝水提醒：預設開啟，每天 7:00~20:00 整點提醒喝 150cc 水，傳「喝水提醒 關」關閉、"
    "「喝水提醒 開」重新開啟。"
)


def _cancel_job(name: str):
    existing = active_reminders.pop(name, None)
    if existing is not None:
        existing["job"].schedule_removal()


def _schedule_repeat(app: Application, chat_id: int, name: str, initial_minutes: int):
    interval = settings["interval_minutes"]
    job = app.job_queue.run_once(
        _on_repeat_alert,
        when=timedelta(minutes=interval),
        data={"chat_id": chat_id, "name": name, "initial_minutes": initial_minutes},
        name=f"reminder:{name}",
    )
    active_reminders[name] = {"job": job, "initial_minutes": initial_minutes, "chat_id": chat_id}


async def _on_first_alert(context: ContextTypes.DEFAULT_TYPE):
    data = context.job.data
    name = data["name"]
    initial_minutes = data["initial_minutes"]
    if name not in active_reminders:
        return  # 已經被取消了
    await context.bot.send_message(
        chat_id=data["chat_id"],
        text=(
            f"「{name}」{initial_minutes}分到了！\n"
            f"完成請回覆「{name} ok」或「{name} 完成」，"
            f"不然我每 {settings['interval_minutes']} 分鐘會再提醒一次。"
        ),
    )
    _schedule_repeat(context.application, data["chat_id"], name, initial_minutes)


async def _on_repeat_alert(context: ContextTypes.DEFAULT_TYPE):
    data = context.job.data
    name = data["name"]
    if name not in active_reminders:
        return  # 已經被取消了
    await context.bot.send_message(
        chat_id=data["chat_id"],
        text=f"提醒：「{name}」還沒完成，請回覆「{name} ok」或「{name} 完成」。",
    )
    _schedule_repeat(context.application, data["chat_id"], name, data["initial_minutes"])


def _start_reminder(app: Application, chat_id: int, name: str, minutes: int):
    _cancel_job(name)  # 同名事項重打就重新計時
    job = app.job_queue.run_once(
        _on_first_alert,
        when=timedelta(minutes=minutes),
        data={"chat_id": chat_id, "name": name, "initial_minutes": minutes},
        name=f"reminder:{name}",
    )
    active_reminders[name] = {"job": job, "initial_minutes": minutes, "chat_id": chat_id}


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user is None or user.id != ALLOWED_TELEGRAM_USER_ID:
        await update.message.reply_text("這個機器人只服務特定使用者，你沒有權限使用。")
        logger.warning("拒絕未授權使用者 %s 的訊息", user.id if user else "unknown")
        return

    text = (update.message.text or "").strip()

    if text in ("/start", "/help"):
        await update.message.reply_text(USAGE_TEXT)
        return

    parts = text.rsplit(maxsplit=1)
    if len(parts) != 2:
        await update.message.reply_text("看不懂這個指令。\n\n" + USAGE_TEXT)
        return

    name, action = parts

    if name == INTERVAL_TASK_NAME:
        if not action.isdigit() or int(action) <= 0:
            await update.message.reply_text("「提醒時間」後面要接一個正整數（分鐘數），例如「提醒時間 5」。")
            return
        settings["interval_minutes"] = int(action)
        await update.message.reply_text(f"已將重複提醒間隔改成每 {action} 分鐘。")
        return

    if name == WATER_REMINDER_NAME:
        if action in ON_WORDS:
            settings["water_reminder_enabled"] = True
            await update.message.reply_text("喝水提醒已開啟，每天 7:00~20:00 整點會提醒喝 150cc 水。")
        elif action in OFF_WORDS:
            settings["water_reminder_enabled"] = False
            await update.message.reply_text("喝水提醒已關閉。")
        else:
            await update.message.reply_text("「喝水提醒」後面要接「開」或「關」，例如「喝水提醒 關」。")
        return

    if action in DONE_WORDS:
        if name in active_reminders:
            _cancel_job(name)
            await update.message.reply_text(f"已停止「{name}」的提醒。")
        else:
            await update.message.reply_text(f"目前沒有「{name}」的提醒在進行中。")
        return

    if action.isdigit() and int(action) > 0:
        minutes = int(action)
        _start_reminder(context.application, update.effective_chat.id, name, minutes)
        await update.message.reply_text(f"好，{minutes} 分鐘後提醒你「{name}」。")
        return

    await update.message.reply_text("看不懂這個指令。\n\n" + USAGE_TEXT)


async def _on_water_reminder(context: ContextTypes.DEFAULT_TYPE):
    if not settings["water_reminder_enabled"]:
        return
    await context.bot.send_message(chat_id=context.job.data["chat_id"], text=WATER_REMINDER_TEXT)


def _schedule_water_reminders(app: Application):
    for hour in WATER_REMINDER_HOURS:
        app.job_queue.run_daily(
            _on_water_reminder,
            time=time(hour=hour, minute=0, tzinfo=TIMEZONE),
            data={"chat_id": ALLOWED_TELEGRAM_USER_ID},
            name=f"water:{hour}",
        )


def _run_health_check_server():
    app = Flask(__name__)

    @app.route("/")
    def index():
        return "telegram-clock-alert-bot is running"

    app.run(host="0.0.0.0", port=PORT)


def main():
    threading.Thread(target=_run_health_check_server, daemon=True).start()

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(MessageHandler(filters.TEXT, handle_message))
    _schedule_water_reminders(application)

    logger.info("機器人啟動，開始長輪詢...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
