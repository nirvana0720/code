@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git commit -m "fix: 報名名單橫向捲動、批次列印改3欄+邊距縮小、訪客modal可捲動"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
