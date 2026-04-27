@echo off
cd /d "%~dp0"
git add src/pages/KioskPage.jsx src/components/DynamicForm.jsx
git commit -m "fix: 報名摘要加編號+同行顯示、datetime拆日期時間框"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
