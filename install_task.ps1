# 在這台伺服器上把這個 bot 註冊成「開機自動啟動」的排程工作。
# 用系統帳號 SYSTEM 執行，不需要登入畫面、不用存密碼；當掉會自動重試。
#
# 注意：這個 bot 的進行中提醒只存在記憶體裡，服務重啟（包含這台伺服器重開機、
# 排程工作被重試）都會把進行中的提醒清空，跟 Render 重新部署會清空是一樣的限制。
#
# 使用方式（用「系統管理員」身分開 PowerShell）：
#   .\install_task.ps1
#
# 移除：
#   Unregister-ScheduledTask -TaskName "TelegramClockAlertBot" -Confirm:$false

$ErrorActionPreference = "Stop"
$taskName = "TelegramClockAlertBot"
$repoDir = $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$repoDir\run_bot.ps1`"" `
    -WorkingDirectory $repoDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "已註冊排程工作：$taskName"
Write-Host "立即測試啟動：Start-ScheduledTask -TaskName '$taskName'"
Write-Host "查看是否在跑：Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "查看記錄檔：$repoDir\bot.log"
