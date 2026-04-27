@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git commit -m "fix: 批次列印改為 A4 印 8 張（2欄×4列），QR code 縮至 80px，修正多頁換頁問題"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
