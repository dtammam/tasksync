$repo      = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repo "server"
$dataDir   = Join-Path $repo "data"
$dbFile    = Join-Path $dataDir "tasksync.db"
$envFile   = Join-Path $repo ".env"

# The server fails closed at boot unless JWT_SECRET and DEV_LOGIN_PASSWORD are
# set to real values. It loads them (via dotenvy) from the repo-root .env,
# which cargo finds one directory above server/. Check early with a friendly
# message instead of letting the boot preflight fail.
if (-not (Test-Path $envFile)) {
    Write-Host "No .env found at $envFile" -ForegroundColor Yellow
    Write-Host "The server refuses to boot without JWT_SECRET and DEV_LOGIN_PASSWORD set."
    Write-Host "Create it first:  cp .env.example .env  (then set real values for both)."
    exit 1
}

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
