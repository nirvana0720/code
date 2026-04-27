@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git commit -m "fix: 批次列印改4欄，QR放大至110px，天地邊距2mm，預覽內距縮小"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
