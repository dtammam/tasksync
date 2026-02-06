param(
	[string]$AdminPassword = "tasksync",
	[string]$ContributorPassword = "tasksync"
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$env:SEED_ADMIN_PASSWORD = $AdminPassword
$env:SEED_CONTRIB_PASSWORD = $ContributorPassword

Write-Host "Seeding default space/users/lists in Docker volume..."
docker compose --profile setup run --rm seed

