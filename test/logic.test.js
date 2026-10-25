import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySlotsBetween, nextDailySlotAfter, parseCommand } from "../src/logic.js";

// 台北時間 → UTC 毫秒
const tpe = (s) => Date.parse(s + "+08:00");
const hhmm = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(11, 16);

test("解析指令，跟 Python 版行為一致", () => {
  assert.deepEqual(parseCommand("/help"), { kind: "help" });
  assert.deepEqual(parseCommand(" 洗衣服 60 "), { kind: "start", name: "洗衣服", minutes: 60 });
  assert.deepEqual(parseCommand("洗 衣服 5"), { kind: "start", name: "洗 衣服", minutes: 5 });
  assert.deepEqual(parseCommand("洗衣服 ok"), { kind: "done", name: "洗衣服" });
  assert.deepEqual(parseCommand("洗衣服 完成"), { kind: "done", name: "洗衣服" });
  assert.deepEqual(parseCommand("提醒時間 5"), { kind: "interval", minutes: 5 });
  assert.deepEqual(parseCommand("提醒時間 0"), { kind: "interval_bad" });
  assert.deepEqual(parseCommand("喝水提醒 關"), { kind: "water", enabled: false });
  assert.deepEqual(parseCommand("喝水提醒 on"), { kind: "water", enabled: true });
  assert.deepEqual(parseCommand("喝水提醒 嗯"), { kind: "water_bad" });
  assert.deepEqual(parseCommand("洗衣服 0"), { kind: "bad" });
  assert.deepEqual(parseCommand("洗衣服 -3"), { kind: "bad" });
  assert.deepEqual(parseCommand("洗衣服"), { kind: "bad" });
  assert.deepEqual(parseCommand(""), { kind: "bad" });
});

test("週三一整天的每日提醒時刻（台北時間）", () => {
  const slots = dailySlotsBetween(tpe("2026-10-27T23:59:00"), tpe("2026-10-28T23:59:00"));
  assert.deepEqual(slots.map((s) => `${hhmm(s.at)} ${s.key}`), [
    "05:00 wake_up", "05:25 meditate_morning", "06:00 breakfast", "06:40 jog",
    "07:10 water:7", "10:10 water:10", "11:10 water:11", "11:25 lunchbox",
    "14:10 water:14", "15:10 water:15", "16:10 water:16", "17:10 water:17",
    "20:10 wind_down", "21:25 meditate_night", "22:10 sleep",
  ]);
});

test("週日沒有便當提醒", () => {
  const slots = dailySlotsBetween(tpe("2026-10-25T00:00:00"), tpe("2026-10-25T23:59:00"));
  assert.ok(!slots.some((s) => s.key === "lunchbox"));
  const sat = dailySlotsBetween(tpe("2026-10-24T00:00:00"), tpe("2026-10-24T23:59:00"));
  assert.ok(sat.some((s) => s.key === "lunchbox"));
});

test("區間是 (from, to]：剛好在 from 的不重發，剛好在 to 的要發", () => {
  const at = tpe("2026-10-28T07:10:00");
  assert.equal(dailySlotsBetween(at, at + 60e3).length, 0);
  assert.equal(dailySlotsBetween(at - 60e3, at).length, 1);
});

test("下一個每日提醒，跨日也找得到", () => {
  assert.equal(hhmm(nextDailySlotAfter(tpe("2026-10-28T22:10:00"))), "05:00");
  assert.equal(hhmm(nextDailySlotAfter(tpe("2026-10-28T11:12:00"))), "11:25");
});
