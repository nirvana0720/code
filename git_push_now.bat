@echo off
chcp 65001 > nul
cd /d D:\Claude\projects\puyi-signup\code
git add -A
git status
git commit -m "feat: delete event, sort activities, diff modal"
git push
echo.
echo === Done! Vercel auto-deploys in ~1 min ===
pause
