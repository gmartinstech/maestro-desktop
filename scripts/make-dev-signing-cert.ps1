<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for INTERNAL Maestro Studio builds.

.DESCRIPTION
  Produces a .pfx that electron/build/sign-windows.js consumes via WINDOWS_DEV_PFX.
  This exists so the team can install a signed build on their own Windows machines
  without Azure Trusted Signing credentials.

  This is NOT a substitute for real code signing. A self-signed certificate earns no
  Authenticode trust: SmartScreen still warns, and the signature is only meaningful on
  machines where this certificate has been imported into Trusted Root. Never ship a
  build signed this way to end users — use Azure Trusted Signing (see sign-windows.js).

.PARAMETER OutPath
  Where to write the .pfx. Defaults to build/dev-signing.pfx (gitignored).

.PARAMETER Password
  Password to protect the .pfx. Required.

.PARAMETER Trust
  Also import the certificate into LocalMachine\Root so builds signed with it are
  trusted on THIS machine. Requires an elevated shell.

.EXAMPLE
  pwsh scripts/make-dev-signing-cert.ps1 -Password 'choose-something' -Trust
#>
[CmdletBinding()]
param(
  [string]$OutPath = "build/dev-signing.pfx",
  [Parameter(Mandatory = $true)][string]$Password,
  [switch]$Trust
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw "Windows only: New-SelfSignedCertificate is not available on this platform." }

$outDir = Split-Path -Parent $OutPath
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

Write-Host "Creating self-signed code-signing certificate..."
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=MartinsTech Maestro Studio (DEV — not for release)" `
  -KeyUsage DigitalSignature `
  -FriendlyName "Maestro Studio dev signing" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(2) `
  -HashAlgorithm SHA256

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $OutPath -Password $secure | Out-Null
Write-Host "Wrote $OutPath (thumbprint $($cert.Thumbprint))"

if ($Trust) {
  # Without this the signature is present but untrusted, so Windows still treats the
  # installer as from an unknown publisher on this machine.
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { throw "-Trust requires an elevated (Run as Administrator) shell." }
  Import-PfxCertificate -FilePath $OutPath -CertStoreLocation "Cert:\LocalMachine\Root" -Password $secure | Out-Null
  Write-Host "Imported into LocalMachine\Root — builds signed with this cert are now trusted on THIS machine only."
}

Write-Host ""
Write-Host "To build a signed installer:" -ForegroundColor Cyan
Write-Host "  `$env:WINDOWS_DEV_PFX = (Resolve-Path '$OutPath').Path"
Write-Host "  `$env:WINDOWS_DEV_PFX_PASSWORD = '<password>'"
Write-Host "  pwsh scripts/build-app-win.ps1"
