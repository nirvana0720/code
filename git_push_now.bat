@echo off
cd /d "%~dp0"
git add src/pages/admin/EventDetailPage.jsx
git add src/components/DynamicForm.jsx
git add src/lib/supabase.js
git add add_placeholder_column.sql
git commit -m "feat: 訪客QR碼移至編號欄、CSV民國年檔名、備註欄位、表單編號樣式、取消報到按鈕、交通欄位顯隱切換"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
