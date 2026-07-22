@echo off
REM Launcher for the puyi-signup automated test runner (test Supabase project only).
cd /d "%~dp0"

if not exist "config.json" (
  echo config.json not found in test folder.
  echo Copy config.example.json to config.json and fill in the test project URL/key.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo node command not found. This computer should already have Node.js installed
  echo (Vite dev server needs it too^). Please install Node.js and try again.
  pause
  exit /b 1
)

node "run.js"

echo.
pause
