# telegram-clock-alert-bot

Telegram 事項提醒（鬧鐘）機器人：傳「事項 分鐘數」設定提醒，時間到會反覆催促，
直到回覆「事項 ok」或「事項 完成」為止。純 Telegram 互動，不需要接 Google 帳號。

執行環境：Python 3。開發機是第二台桌電（`C:\claude_practicefiles\telegram-clock-alert-bot`），
正式運行是免費部署在 Render 上，24 小時都能收 Telegram 訊息。

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

之後每 5 分鐘催一次，會立刻套用到所有進行中的提醒（不用重新啟動）。

---

## 部署步驟

### 1. 建立 GitHub repo 並 push 程式碼

（如果要我幫忙在 GitHub 上建 repo 並 push，跟我說一聲，照既有工作流程處理。）

### 2. Render 部署

1. [Render](https://dashboard.render.com/) 新增 **Web Service**，連到剛建立的 GitHub repo。
2. 設定：
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python bot.py`
   - **Instance Type**: Free
3. 到 Environment 頁籤，加入環境變數：

   | Key | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | 你的 Telegram bot token |
   | `ALLOWED_TELEGRAM_USER_ID` | 你自己的 Telegram user id |

4. 部署完成後，Render 會給一個網址，打開應該會看到
   `telegram-clock-alert-bot is running`，代表健康檢查端點正常。

### 3. UptimeRobot 保活

Render 免費 Web Service 閒置 15 分鐘沒有 HTTP 請求會自動休眠，休眠期間排定的提醒
就不會準時發送，一定要靠外部服務定期 ping 保持醒著：

1. 到 [UptimeRobot](https://uptimerobot.com/)（可沿用其他機器人同一組帳號）。
2. 新增一個 Monitor，類型選 HTTP(s)，網址填 Render 給的網址，檢查間隔選 5 分鐘。
3. 存檔即可。

### 4. 測試

在 Telegram 找到機器人，傳 `/start` 應該會收到使用說明，再傳「測試 1」，
約 1 分鐘後應該會收到「「測試」1分到了！...」的提醒，回「測試 完成」應該會停止。

---

## 已知限制

- 提醒狀態存在記憶體中，**不會持久化**：如果 Render 重新部署或程序重啟，
  當時所有進行中的提醒都會消失（跟鬧鐘一樣，本來就是短期、一次性的用途，
  不像 trade-calc 或其他記帳類機器人需要長期保存資料）。
- 只要 UptimeRobot 持續保活、程序沒有重啟，排定的提醒就會準時。

## 疑難排解

- **機器人完全沒反應**：先確認 Render 的 Logs 頁籤有沒有錯誤訊息；再確認
  UptimeRobot 的 Monitor 狀態是 Up；`ALLOWED_TELEGRAM_USER_ID` 打錯也會讓
  機器人「已讀不回」（其實是回了「沒有權限」，但只回給你以外的人才看得到）。
- **本機測試**：用 PowerShell 設定環境變數後直接執行：

  ```powershell
  $env:TELEGRAM_BOT_TOKEN = "..."
  $env:ALLOWED_TELEGRAM_USER_ID = "..."
  python bot.py
  ```

  測試完記得先停掉本機程序再部署到 Render，避免同一個 token 本機跟雲端
  同時長輪詢造成衝突。
