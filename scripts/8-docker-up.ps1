$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "Building and starting tasksync containers..."
docker compose up --build -d server web

Write-Host "Web:    http://localhost:5173"
Write-Host "API:    http://localhost:3000"
Write-Host "Health: http://localhost:3000/health"

