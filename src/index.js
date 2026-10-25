/**
 * Cloudflare Worker 版的事項提醒／鬧鐘機器人。
 *
 * - Telegram 有新訊息時呼叫 POST /telegram（webhook），不再長輪詢。
 * - 所有狀態（進行中的提醒、喝水開關、重複間隔）存在一個 Durable Object 的儲存裡，
 *   重新部署也不會消失。
 * - Durable Object 的 alarm 會設在「下一個該發的提醒」那一刻，準時送出；
 *   另外每分鐘的 cron 再檢查一次，當作保險（例如剛部署完 alarm 還沒排）。
 *
 * 設定（Cloudflare 後台 → Worker → Settings → Variables and Secrets）：
 *   TELEGRAM_BOT_TOKEN        Secret，跟 @BotFather 申請的 token
 *   ALLOWED_TELEGRAM_USER_ID  寫在 wrangler.toml 的 [vars]，只處理這個 Telegram user id 的訊息
 *
 * 第一次部署後打開 https://<worker 網址>/setup，會幫你向 Telegram 註冊 webhook。
 */
import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_INTERVAL_MINUTES,
  USAGE_TEXT,
  dailySlotsBetween,
  firstAlertText,
  nextDailySlotAfter,
  parseCommand,
  repeatAlertText,
} from "./logic.js";

const MINUTE = 60 * 1000;
// alarm 或 cron 晚了太久（例如 Cloudflare 故障）時，太舊的每日提醒就不補發了
const DAILY_LATE_TOLERANCE_MS = 30 * MINUTE;
const STORE_NAME = "main";

async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function telegram(env, method, body) {
  // TELEGRAM_API_BASE 只在本機測試時用來指向假的 Telegram 伺服器
  const base = env.TELEGRAM_API_BASE || "https://api.telegram.org";
  const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) console.error(`Telegram ${method} 失敗：${data.description}`);
  return data;
}

function sendMessage(env, chatId, text) {
  return telegram(env, "sendMessage", { chat_id: chatId, text });
}

export class ReminderStore extends DurableObject {
  // 讀、改、寫儲存之間不能有 await fetch，不然 alarm 和 cron 同時進來可能重複發送；
  // 所以每個方法都先把狀態改好存起來，最後才送 Telegram 訊息。

  async loadState() {
    const s = await this.ctx.storage.get(["reminders", "settings", "dailyCursor"]);
    return {
      // {事項名稱: {chatId, initialMinutes, dueAt, stage: "first" | "repeat"}}
      reminders: s.get("reminders") || {},
      settings: s.get("settings") || { intervalMinutes: DEFAULT_INTERVAL_MINUTES, waterEnabled: true },
      dailyCursor: s.get("dailyCursor"),
    };
  }

  async saveAndReschedule(state, now) {
    await this.ctx.storage.put({
      reminders: state.reminders,
      settings: state.settings,
      dailyCursor: state.dailyCursor,
    });
    let next = nextDailySlotAfter(Math.max(now, state.dailyCursor ?? now));
    for (const r of Object.values(state.reminders)) next = Math.min(next, r.dueAt);
    await this.ctx.storage.setAlarm(Math.max(next, now + 1000));
  }

  async alarm() {
    await this.tick();
  }

  /** 送出所有到期的提醒，並把 alarm 排到下一個提醒的時間 */
  async tick() {
    const now = Date.now();
    const state = await this.loadState();
    const outgoing = [];

    // 第一次執行時從現在開始算，不補發部署之前的每日提醒
    const cursor = state.dailyCursor ?? now;
    for (const slot of dailySlotsBetween(cursor, now)) {
      if (now - slot.at > DAILY_LATE_TOLERANCE_MS) continue;
      if (slot.water && !state.settings.waterEnabled) continue;
      outgoing.push([Number(this.env.ALLOWED_TELEGRAM_USER_ID), slot.text]);
    }
    state.dailyCursor = now;

    const interval = state.settings.intervalMinutes;
    for (const [name, r] of Object.entries(state.reminders)) {
      if (r.dueAt > now) continue;
      outgoing.push([
        r.chatId,
        r.stage === "first" ? firstAlertText(name, r.initialMinutes, interval) : repeatAlertText(name),
      ]);
      r.stage = "repeat";
      r.dueAt = now + interval * MINUTE;
    }

    await this.saveAndReschedule(state, now);
    for (const [chatId, text] of outgoing) await sendMessage(this.env, chatId, text);
  }

  /** 處理一則 Telegram 訊息，回傳要回覆的文字 */
  async handleText(chatId, text) {
    const now = Date.now();
    const state = await this.loadState();
    const cmd = parseCommand(text);
    let reply;

    switch (cmd.kind) {
      case "help":
        reply = USAGE_TEXT;
        break;
      case "interval":
        state.settings.intervalMinutes = cmd.minutes;
        reply = `已將重複提醒間隔改成每 ${cmd.minutes} 分鐘。`;
        break;
      case "interval_bad":
        reply = "「提醒時間」後面要接一個正整數（分鐘數），例如「提醒時間 5」。";
        break;
      case "water":
        state.settings.waterEnabled = cmd.enabled;
        reply = cmd.enabled ? "喝水提醒已開啟，每天 7:10~17:10 每小時的 10 分會提醒喝 150cc 水。" : "喝水提醒已關閉。";
        break;
      case "water_bad":
        reply = "「喝水提醒」後面要接「開」或「關」，例如「喝水提醒 關」。";
        break;
      case "done":
        if (state.reminders[cmd.name]) {
          delete state.reminders[cmd.name];
          reply = `已停止「${cmd.name}」的提醒。`;
        } else {
          reply = `目前沒有「${cmd.name}」的提醒在進行中。`;
        }
        break;
      case "start":
        // 同名事項重打就重新計時
        state.reminders[cmd.name] = {
          chatId, initialMinutes: cmd.minutes, dueAt: now + cmd.minutes * MINUTE, stage: "first",
        };
        reply = `好，${cmd.minutes} 分鐘後提醒你「${cmd.name}」。`;
        break;
      default:
        reply = "看不懂這個指令。\n\n" + USAGE_TEXT;
    }

    await this.saveAndReschedule(state, now);
    return reply;
  }
}

function store(env) {
  return env.REMINDERS.get(env.REMINDERS.idFromName(STORE_NAME));
}

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message || typeof message.text !== "string") return; // 只處理文字訊息
  const userId = message.from?.id;
  if (userId !== Number(env.ALLOWED_TELEGRAM_USER_ID)) {
    console.warn(`拒絕未授權使用者 ${userId ?? "unknown"} 的訊息`);
    await sendMessage(env, message.chat.id, "這個機器人只服務特定使用者，你沒有權限使用。");
    return;
  }
  const reply = await store(env).handleText(message.chat.id, message.text);
  await sendMessage(env, message.chat.id, reply);
}

async function setup(url, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "還沒設定 TELEGRAM_BOT_TOKEN：請到 Cloudflare 後台這個 Worker 的 Settings → Variables and Secrets 新增（類型選 Secret），存檔後再打開這個網址一次。";
  }
  const me = await telegram(env, "getMe", {});
  if (!me.ok) return `Bot Token 無效（${me.description}），請確認 TELEGRAM_BOT_TOKEN 有沒有貼錯。`;
  const hook = `${url.origin}/telegram`;
  const res = await telegram(env, "setWebhook", {
    url: hook,
    secret_token: await webhookSecret(env.TELEGRAM_BOT_TOKEN),
    allowed_updates: ["message"],
  });
  if (!res.ok) return `向 Telegram 註冊 webhook 失敗：${res.description}`;
  await store(env).tick(); // 順便把每日提醒的 alarm 排好
  return `設定完成！@${me.result.username} 現在由這個 Worker 處理訊息（${hook}）。傳 /help 給機器人試試看。`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram" && request.method === "POST") {
      const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN || "");
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json().catch(() => null);
      // 一律回 200，避免 Telegram 因為錯誤一直重送同一則訊息
      if (update) {
        try {
          await handleUpdate(update, env);
        } catch (err) {
          console.error("處理訊息失敗", err);
        }
      }
      return new Response("ok");
    }

    if (url.pathname === "/setup") {
      return new Response(await setup(url, env), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new Response("telegram-clock-alert-bot is running", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(store(env).tick());
  },
};
