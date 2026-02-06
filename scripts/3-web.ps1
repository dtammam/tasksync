$repo = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repo "web"

# Expose Vite on all adapters by default; override with HOST/PORT env if desired
$webHost = $env:HOST
if ([string]::IsNullOrEmpty($webHost)) { $webHost = "0.0.0.0" }
$webPort = $env:WEB_PORT
if ([string]::IsNullOrEmpty($webPort)) { $webPort = "5173" }

Set-Location $webDir
Write-Host "Starting web on $webHost`:$webPort"
# npm v10 on Windows (with PowerShell script-shell) drops the flag names when
# forwarded through `npm run dev -- --host ... --port ...`, turning them into
# positional args (e.g., `vite dev 0.0.0.0 5173`) and Vite then treats the host
# string as the project root, serving 404s. Call Vite directly to preserve flags.
npx vite dev --host $webHost --port $webPort --clearScreen false
