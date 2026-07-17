@echo off
cd /d "%~dp0"

git add src/components/ChoreImportModal.jsx src/lib/choreImport.js src/lib/xlsxBorders.js src/pages/admin/ChoreArrangementDetailPage.jsx sql/add_chore_temple_date.sql
git commit -F commit_msg_chore_roster.txt
git push origin main

echo.
echo Done. Press any key to close.
pause >nul
