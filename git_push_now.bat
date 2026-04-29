@echo off
cd /d "%~dp0"
git add src/pages/admin/StudentsPage.jsx
git commit -m "feat: 學員管理加入單筆新增 modal 與下載模板功能"
git push
echo.
echo ✅ 已推送，Vercel 約 1 分鐘後自動部署完成
pause
