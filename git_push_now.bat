@echo off
cd /d "%~dp0"
git add src/pages/KioskPage.jsx
git commit -m "fix: 報名摘要標籤改藍色、字體與值同大"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
