# telegram-clock-alert-bot

Telegram 事項提醒（鬧鐘）機器人：傳「事項 分鐘數」設定提醒，時間到會反覆催促，
直到回覆「事項 ok」或「事項 完成」為止。純 Telegram 互動，不需要接 Google 帳號。

執行環境：**Cloudflare Workers 免費方案**（JavaScript），不需要任何一台電腦一直開著。
push 到 GitHub 的 `master` 後，Cloudflare 會自動部署新版本。

---

## 輸入格式

**開始提醒**：傳「事項 分鐘數」，例如：

```
洗衣服 60
```

60 分鐘後機器人會傳「「洗衣服」60分到了！...」，之後每隔預設 10 分鐘會再提醒一次，
直到收到停止指令。同一個事項名稱重打一次會直接重新計時（取代舊的）。

**停止提醒**：傳「事項 ok」或「事項 完成」，例如：

```
洗衣服 完成
```

**改重複提醒間隔**（預設 10 分鐘）：傳「提醒時間 分鐘數」，例如：

```
提醒時間 5
```

之後每 5 分鐘催一次，從下一次催促開始套用到所有進行中的提醒。

**喝水提醒**：每天 7:10~17:10 每小時的 10 分各提醒一次「喝 150cc 水」（8~9點、12~13點剛吃飽飯不提醒，17:10 之後也不提醒，刻意不整點提醒），**預設開啟**，不用手動設定。
傳「喝水提醒 關」關閉、「喝水提醒 開」重新開啟：

```
喝水提醒 關
喝水提醒 開
```

**每日作息提醒**：固定時間發送，沒有開關（不像喝水提醒可以關掉），刻意不寫進 Google
日曆，因為是每天都一樣的固定行程，寫進日曆只會讓日曆變得很亂：

| 時間 | 內容 |
|---|---|
| 05:00 | 起床 |
| 05:25 | 打坐三十分鐘 |
| 06:00 | 準備早餐 |
| 06:40 | 超慢跑30分鐘 |
| 11:25（週一~週六） | 包素食便當 |
| 20:10 | 關手機及電腦，準備睡覺 |
| 21:25 | 打坐三十分鐘 |
| 22:10 | 睡覺 |

---

## 運作方式

- Telegram 收到訊息時呼叫 Worker 的 `POST /telegram`（webhook），不再用長輪詢。
- 進行中的提醒、喝水開關、重複間隔都存在一個 Durable Object 的儲存裡，**重新部署也不會消失**。
- Durable Object 的 alarm 會排在下一個該發的提醒那一刻，準時送出；另外每 5 分鐘的 cron 再檢查一次當作保險。
- 程式：`src/index.js`（Worker 與 Durable Object）、`src/logic.js`（指令解析、每日時刻表、說明文字）。
  測試：`npm test`。

## 第一次設定（只需要做一次）

1. 註冊／登入 [Cloudflare](https://dash.cloudflare.com/)（免費方案即可）。
2. 左邊選 **Workers & Pages** → **Create** → **Import a repository**（或 Connect to Git），
   授權 Cloudflare 讀取 GitHub，選 `sunnywin99/telegram-clock-alert-bot`，分支 `master`。
   其他設定都用預設值（Cloudflare 會讀 `wrangler.toml`），按 **Deploy**。
3. 部署完成後，到這個 Worker 的 **Settings → Variables and Secrets** → **Add**：
   類型選 **Secret**，名稱 `TELEGRAM_BOT_TOKEN`，值貼上 Bot Token，存檔。
4. 打開 `https://<worker 網址>/setup`（網址在 Worker 頁面上，結尾是 `.workers.dev`），
   看到「設定完成！」就代表 Telegram 已經改成把訊息送到這個 Worker。
5. 在 Telegram 傳 `/help`，再傳「測試 1」，約 1 分鐘後應該收到提醒，回「測試 完成」停止。

`ALLOWED_TELEGRAM_USER_ID` 寫在 `wrangler.toml` 的 `[vars]`，不是機密；要換人用就改那裡。

## 之後改程式

改好 push（或合併）到 `master`，Cloudflare 會自動重新部署，不用做任何事。
可以在 Worker 頁面的 **Deployments** 看部署有沒有成功，**Logs** 看執行記錄。

## 疑難排解

- **機器人完全沒反應**：重新打開一次 `/setup` 看它說什麼（Token 沒設、Token 錯誤都會直接告訴你）。
  `ALLOWED_TELEGRAM_USER_ID` 打錯的話，機器人會回「沒有權限」。
- **本機測試**：`npm install` 後建立 `.dev.vars`（寫 `TELEGRAM_BOT_TOKEN=...`），執行 `npx wrangler dev`。
  注意本機的 `/setup` 會把 webhook 指到本機網址，測完要再打開一次正式 Worker 的 `/setup`。
- **舊版**：2026-10 以前是 Python 版（`bot.py`，跑在 Render、後來自架桌電），可以在 git 歷史找到。
