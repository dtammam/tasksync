$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "Building and starting tasksync containers..."
docker compose up --build -d server web

if ($env:WEB_HOST_PORT -and $env:WEB_HOST_PORT.Trim()) {
	$webHostPort = $env:WEB_HOST_PORT.Trim()
} else {
	$webHostPort = "5173"
}
if ($env:SERVER_HOST_PORT -and $env:SERVER_HOST_PORT.Trim()) {
	$serverHostPort = $env:SERVER_HOST_PORT.Trim()
} else {
	$serverHostPort = "3000"
}
Write-Host "Web:    http://localhost:$webHostPort"
Write-Host "API:    http://localhost:$serverHostPort"
Write-Host "Health: http://localhost:$serverHostPort/health"

