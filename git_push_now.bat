@echo off
cd /d "%~dp0"
git add src/lib/auth.jsx
git add src/lib/supabase.js
git add src/components/ProtectedRoute.jsx
git add src/components/AdminLayout.jsx
git add src/pages/admin/EventsPage.jsx
git add src/pages/admin/EventDetailPage.jsx
git add src/pages/admin/CheckinPage.jsx
git add src/App.jsx
git add role_setup.sql
git commit -m "feat: 後台角色權限（師父/義工）"
git push
echo.
echo === 推送完成，Vercel 自動部署中 ===
pause
