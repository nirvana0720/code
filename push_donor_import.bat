@echo off
cd /d "%~dp0"

git add src/pages/admin/DonorManagePage.jsx
git commit -F commit_msg_donor_import.txt
git push origin main

echo.
echo Done. Press any key to close.
pause >nul
