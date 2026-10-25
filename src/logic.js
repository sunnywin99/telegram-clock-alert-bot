// 不碰網路、不碰儲存的純邏輯：指令解析、每日提醒時刻表、說明文字。
// 抽出來是為了能用 node --test 直接測（test/logic.test.js）。

export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Taipei，沒有日光節約
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_INTERVAL_MINUTES = 10;
export const INTERVAL_TASK_NAME = "提醒時間";
export const DONE_WORDS = new Set(["ok", "OK", "Ok", "完成"]);

export const WATER_REMINDER_NAME = "喝水提醒";
// 7:10~17:10 每小時的 10 分各一次（不整點提醒），但排除早餐、午餐剛吃飽的時段（8~9點、12~13點）不適合喝太多水；
// 17:10 之後不再提醒（晚餐後、20 點要準備睡覺了）
const WATER_REMINDER_SKIP_HOURS = new Set([8, 9, 12, 13]);
export const WATER_REMINDER_HOURS = [];
for (let h = 7; h < 18; h++) if (!WATER_REMINDER_SKIP_HOURS.has(h)) WATER_REMINDER_HOURS.push(h);
export const WATER_REMINDER_MINUTE = 10;
export const WATER_REMINDER_TEXT = "喝水提醒：該喝水了，喝 150cc 水。";
export const ON_WORDS = new Set(["開", "開啟", "on", "On", "ON"]);
export const OFF_WORDS = new Set(["關", "關閉", "off", "Off", "OFF"]);

const MONDAY_TO_SATURDAY = [1, 2, 3, 4, 5, 6]; // getUTCDay()：0=週日...6=週六

// 每天固定時間的作息提醒：[key, 訊息, 時, 分, 星期幾要發／null 代表每天]
export const FIXED_REMINDERS = [
  ["wake_up", "起床時間到了！", 5, 0, null],
  ["meditate_morning", "打坐提醒：打坐三十分鐘。", 5, 25, null],
  ["breakfast", "準備早餐時間到了！", 6, 0, null],
  ["jog", "超慢跑時間到了，跑30分鐘。", 6, 40, null],
  ["lunchbox", "包素食便當時間到了！", 11, 25, MONDAY_TO_SATURDAY],
  ["wind_down", "該關手機及電腦，準備睡覺了。", 20, 10, null],
  ["meditate_night", "打坐提醒：打坐三十分鐘。", 21, 25, null],
  ["sleep", "睡覺時間到了！", 22, 10, null],
];

export const USAGE_TEXT =
  "這是事項提醒（鬧鐘）機器人，用法：\n\n" +
  "開始提醒：傳「事項 分鐘數」，例如：\n" +
  "洗衣服 60\n" +
  "→ 60 分鐘後提醒你「洗衣服 60分到了」，之後預設每 10 分鐘催一次，直到你回覆完成。\n\n" +
  "停止提醒：傳「事項 ok」或「事項 完成」，例如：\n" +
  "洗衣服 完成\n\n" +
  `改重複提醒間隔（預設 ${DEFAULT_INTERVAL_MINUTES} 分鐘）：傳「提醒時間 分鐘數」，例如：\n` +
  "提醒時間 5\n" +
  "→ 之後每 5 分鐘催一次（下一次催促起套用到所有進行中的提醒）。\n\n" +
  "喝水提醒：預設開啟，每天 7:10~17:10 每小時的 10 分提醒喝 150cc 水（8~9點、12~13點" +
  "剛吃飽飯不提醒），傳「喝水提醒 關」關閉、「喝水提醒 開」重新開啟。\n\n" +
  "每日作息提醒（固定，無法關閉）：\n" +
  "05:00 起床／05:25 打坐三十分鐘／06:00 準備早餐／06:40 超慢跑30分鐘／\n" +
  "11:25 包素食便當（週一~週六）／20:10 關手機及電腦準備睡覺／\n" +
  "21:25 打坐三十分鐘／22:10 睡覺";

const POSITIVE_INT = /^[0-9]+$/;

/**
 * 把一則文字訊息解析成要做的事，跟原本 Python 版 handle_message 的判斷順序一樣：
 *   help / bad / interval / water / done / start
 */
export function parseCommand(rawText) {
  const text = (rawText || "").trim();
  if (text === "/start" || text === "/help") return { kind: "help" };

  // 等同 Python 的 text.rsplit(maxsplit=1)：最後一段空白前全部是事項名稱
  const m = text.match(/^(.*\S)\s+(\S+)$/s);
  if (!m) return { kind: "bad" };
  const [, name, action] = m;
  const isPositiveInt = POSITIVE_INT.test(action) && Number(action) > 0;

  if (name === INTERVAL_TASK_NAME) {
    return isPositiveInt ? { kind: "interval", minutes: Number(action) } : { kind: "interval_bad" };
  }
  if (name === WATER_REMINDER_NAME) {
    if (ON_WORDS.has(action)) return { kind: "water", enabled: true };
    if (OFF_WORDS.has(action)) return { kind: "water", enabled: false };
    return { kind: "water_bad" };
  }
  if (DONE_WORDS.has(action)) return { kind: "done", name };
  if (isPositiveInt) return { kind: "start", name, minutes: Number(action) };
  return { kind: "bad" };
}

/** 所有每日提醒（作息＋喝水），回傳 [{key, text, hour, minute, days, water}] */
function dailySchedule() {
  const list = FIXED_REMINDERS.map(([key, text, hour, minute, days]) => ({
    key, text, hour, minute, days, water: false,
  }));
  for (const hour of WATER_REMINDER_HOURS) {
    list.push({
      key: `water:${hour}`, text: WATER_REMINDER_TEXT, hour, minute: WATER_REMINDER_MINUTE,
      days: null, water: true,
    });
  }
  return list;
}
const DAILY = dailySchedule();

/** 時間區間 (fromMs, toMs] 內所有該發的每日提醒，依時間排序 */
export function dailySlotsBetween(fromMs, toMs) {
  const out = [];
  if (toMs <= fromMs) return out;
  // 以台北時間的「日」為單位往前後各多掃一天，避免跨日邊界漏掉
  const firstDay = Math.floor((fromMs + TZ_OFFSET_MS) / DAY) - 1;
  const lastDay = Math.floor((toMs + TZ_OFFSET_MS) / DAY) + 1;
  for (let d = firstDay; d <= lastDay; d++) {
    const dayStartUtc = d * DAY - TZ_OFFSET_MS; // 台北時間該日 00:00 對應的 UTC 毫秒
    const weekday = new Date(d * DAY).getUTCDay();
    for (const r of DAILY) {
      if (r.days && !r.days.includes(weekday)) continue;
      const at = dayStartUtc + (r.hour * 60 + r.minute) * MINUTE;
      if (at > fromMs && at <= toMs) out.push({ ...r, at });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** afterMs 之後（不含）下一個每日提醒的時間 */
export function nextDailySlotAfter(afterMs) {
  return dailySlotsBetween(afterMs, afterMs + 2 * DAY)[0].at;
}

export function firstAlertText(name, initialMinutes, intervalMinutes) {
  return (
    `「${name}」${initialMinutes}分到了！\n` +
    `完成請回覆「${name} ok」或「${name} 完成」，` +
    `不然我每 ${intervalMinutes} 分鐘會再提醒一次。`
  );
}

export function repeatAlertText(name) {
  return `提醒：「${name}」還沒完成，請回覆「${name} ok」或「${name} 完成」。`;
}
