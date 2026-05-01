# push.ps1 - find git and push to GitHub
$ErrorActionPreference = "Stop"

# Find git: system PATH first, then GitHub Desktop
$git = $null
try { $git = (Get-Command git -ErrorAction Stop).Source } catch {}

if (-not $git) {
    $ghDesktop = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter "app-*" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($ghDesktop) {
        $candidate = Join-Path $ghDesktop.FullName "resources\app\git\cmd\git.exe"
        if (Test-Path $candidate) { $git = $candidate }
    }
}

if (-not $git) {
    Write-Host "[ERROR] git not found. Please use GitHub Desktop to push manually." -ForegroundColor Red
    exit 1
}

Write-Host "Using git: $git" -ForegroundColor Cyan

Set-Location "D:\Claude\projects\puyi-signup\code"
& $git add -A
& $git status
& $git commit -m "fix: rename transport label and auto-fill carpool"
& $git push

Write-Host ""
Write-Host "=== Done! Vercel auto-deploys in ~1 min ===" -ForegroundColor Green
