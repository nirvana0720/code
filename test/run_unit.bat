@echo off
REM Launcher for the multi-slot-transport pure-logic unit tests (no network / no Supabase project needed).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo node command not found. This computer should already have Node.js installed
  echo (Vite dev server needs it too^). Please install Node.js and try again.
  pause
  exit /b 1
)

node "run_unit.mjs"

echo.
pause
