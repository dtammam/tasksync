$repo      = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repo "server"
$dataDir   = Join-Path $repo "data"
$dbFile    = Join-Path $dataDir "tasksync.db"

taskkill /F /IM tasksync-server.exe /IM seed.exe 2>$null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $dbFile

$env:PATH         = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$dbFileForward    = ($dbFile -replace '\\','/')
# Use sqlite://C:/... with mode=rwc to ensure file creation works on Windows
$env:DATABASE_URL = "sqlite://" + $dbFileForward + "?mode=rwc"
$env:RUST_LOG     = "info"

Set-Location $serverDir
Write-Host "DATABASE_URL=$env:DATABASE_URL"
& "$env:USERPROFILE\.cargo\bin\cargo.exe" run --bin seed
