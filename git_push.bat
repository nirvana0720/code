@echo off
cd /d "%~dp0"
del .git\index.lock 2>nul
git add src/pages/admin/EventDetailPage.jsx
git commit -m "feat: 條件顯示改為下拉選單，顯示名稱自動填入程式識別碼"
git push origin main
echo.
echo 完成！請關閉此視窗。
pause
