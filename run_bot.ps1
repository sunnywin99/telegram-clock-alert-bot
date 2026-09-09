# 給工作排程器呼叫用的啟動腳本：切到自己所在的資料夾、跑 venv 裡的 python、
# 把輸出寫進 bot.log 方便事後查錯誤。
Set-Location -Path $PSScriptRoot
& "$PSScriptRoot\venv\Scripts\python.exe" "$PSScriptRoot\bot.py" *>> "$PSScriptRoot\bot.log"
exit $LASTEXITCODE
