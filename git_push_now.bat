@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git commit -m "fix: 修正 EventDetailPage JSX Fragment 語法錯誤"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
