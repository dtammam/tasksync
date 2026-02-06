$repo      = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repo "server"
$dataDir   = Join-Path $repo "data"
$dbFile    = Join-Path $dataDir "tasksync.db"

# Stop any existing dev servers so the port can bind cleanly.
taskkill /F /IM tasksync-server.exe /IM cargo.exe 2>$null

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$env:PATH         = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$dbFileForward    = ($dbFile -replace '\\','/')
$env:DATABASE_URL = "sqlite://" + $dbFileForward
$env:RUST_LOG     = "info"

Set-Location $serverDir
Write-Host "DATABASE_URL=$env:DATABASE_URL"
Write-Host "Starting API on http://localhost:3000 (health: /health)"
& "$env:USERPROFILE\.cargo\bin\cargo.exe" run --bin tasksync-server
