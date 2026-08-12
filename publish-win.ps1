# Builds + signs + publishes the Windows installer to the GitHub Release
# matching electron/package.json's version. Windows is the only shipped target.
#
# Usage:
#   pwsh publish-win.ps1     (or)     powershell -File publish-win.ps1
#
# Prereqs:
#   - .env.windows populated with AZURE_* secrets + GH_TOKEN

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
$BuildScript = Join-Path $ScriptDir 'scripts\build-app-win.ps1'

if (-not (Test-Path $BuildScript)) {
    Write-Error "Cannot find $BuildScript"
    exit 1
}

Write-Host "Publishing Windows release..."
& $BuildScript -Publish
exit $LASTEXITCODE
