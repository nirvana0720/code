@echo off
cd /d "%~dp0"
git add src/components/DynamicForm.jsx
git commit -m "fix: datetime 欄位拆日期+時間兩框，強制24小時制"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
