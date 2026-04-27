@echo off
cd /d "%~dp0"
git add src/lib/supabase.js src/pages/admin/EventDetailPage.jsx src/pages/KioskPage.jsx events_lock.sql
git commit -m "feat: 活動停止異動功能 — 後台鎖定開關 + 前台唯讀提示"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
