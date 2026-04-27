@echo off
cd /d "%~dp0"
git add src/pages/KioskPage.jsx
git commit -m "style: 鎖定提示文字改2行置中"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
