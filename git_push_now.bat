@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git commit -m "feat: 交通方式拆上山/下山、調整義工欄位順序、報名名單可排序"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
