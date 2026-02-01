$repo = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repo "web"

Set-Location $webDir
npm run dev -- --host
