[CmdletBinding()]
param(
	[switch]$SkipPlaywright
)

$ErrorActionPreference = "Stop"

$repo    = Split-Path -Parent $PSScriptRoot
$webDir  = Join-Path $repo "web"
$srvDir  = Join-Path $repo "server"

# Ensure cargo and node are available when invoked from Git hooks
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs;$env:PATH"

Push-Location $webDir
Write-Host "web: npm run lint"
npm run lint
Write-Host "web: npm run check"
npm run check
Write-Host "web: npm run test"
npm run test

if ($SkipPlaywright) {
	Write-Host "web: skipping Playwright (SkipPlaywright switch set)"
} else {
	Write-Host "web: npx playwright test"
	npx playwright test
}
Pop-Location

Push-Location $srvDir
Write-Host "server: cargo test"
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test
Pop-Location
