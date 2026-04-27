@echo off
cd /d "%~dp0"
git add src/pages/KioskPage.jsx
git commit -m "fix: 報名摘要標籤與值分兩行，避免手機換行錯亂"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
