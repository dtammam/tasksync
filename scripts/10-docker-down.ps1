$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "Stopping tasksync containers..."
docker compose down

