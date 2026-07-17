@echo off
cd /d "%~dp0"

git add sql/fix_leader_scan_rpc.sql src/lib/supabase.js
git commit -F commit_msg_fix_leader_scan.txt
git push origin main

echo.
echo Done. Press any key to close.
pause >nul
