# 自動找 GitHub Desktop 內建的 git.exe
$gitExe = "git"

$ghDesktopDirs = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter "app-*" -Directory -ErrorAction SilentlyContinue
foreach ($dir in $ghDesktopDirs) {
    $candidate = Join-Path $dir.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) {
        $gitExe = $candidate
    }
}

Write-Host "使用 git: $gitExe" -ForegroundColor Cyan

# 切換到腳本所在目錄
Set-Location $PSScriptRoot

# 加入所有修改的檔案
& $gitExe add src/lib/auth.jsx
& $gitExe add src/lib/supabase.js
& $gitExe add src/components/ProtectedRoute.jsx
& $gitExe add src/components/AdminLayout.jsx
& $gitExe add src/pages/admin/EventsPage.jsx
& $gitExe add src/pages/admin/EventDetailPage.jsx
& $gitExe add src/pages/admin/CheckinPage.jsx
& $gitExe add src/App.jsx
& $gitExe add role_setup.sql

& $gitExe commit -m "feat: 後台角色權限（師父/義工）"
& $gitExe push

Write-Host ""
Write-Host "=== 推送完成，Vercel 自動部署中 ===" -ForegroundColor Green
Read-Host "按 Enter 關閉"
