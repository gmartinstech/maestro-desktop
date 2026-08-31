[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ArtifactPath
)

$ErrorActionPreference = 'Stop'
$StoreCdnHost = 'cloudinha'
$StoreCdnStagingDir = '/home/ubuntu/maestro-releases/incoming'
$StoreCdnPublicDir = '/home/martinstech-cdn/htdocs/cdn.martinstech.net/maestro/downloads'
$StoreCdnPublicBaseUrl = 'https://cdn.martinstech.net/maestro/downloads'
$ScriptDir = Split-Path -Parent $PSCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir

function Import-LocalEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $index = $line.IndexOf('=')
            $name = $line.Substring(0, $index).Trim()
            $value = $line.Substring($index + 1).Trim()
            if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

function Get-ZipEntryText([System.IO.Compression.ZipArchive]$Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if (-not $entry) { throw "AppX is missing $Name" }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Save-ZipEntry([System.IO.Compression.ZipArchive]$Archive, [string]$Name, [string]$Destination) {
    $entry = $Archive.GetEntry($Name)
    if (-not $entry) { throw "AppX is missing $Name" }
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Destination)) | Out-Null
    $source = $entry.Open()
    $target = [System.IO.File]::Create($Destination)
    try { $source.CopyTo($target) } finally { $target.Dispose(); $source.Dispose() }
}

function Invoke-NodeJson([string]$Script, [string[]]$Arguments, [string]$InputJson = $null) {
    if ($null -eq $InputJson) {
        $output = & node -e $Script @Arguments 2>&1
    } else {
        $output = $InputJson | & node -e $Script @Arguments 2>&1
    }
    if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    return (($output -join '') | ConvertFrom-Json)
}

foreach ($tool in @('node', 'scp', 'ssh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required for Store AppX publication" }
}

Import-LocalEnv (Join-Path $ProjectRoot '.env.windows')
$ModeScript = @'
const { resolveWindowsBuildMode } = require(process.argv[1]);
resolveWindowsBuildMode({ store: true });
process.stdout.write(JSON.stringify({
  identityName: process.env.MAESTRO_STORE_IDENTITY_NAME,
  publisher: process.env.MAESTRO_STORE_PUBLISHER,
}));
'@
$StoreIdentity = Invoke-NodeJson $ModeScript @((Join-Path $ProjectRoot 'scripts\windowsBuildMode.js'))

$Artifact = Get-Item -LiteralPath $ArtifactPath -ErrorAction Stop
if (-not $Artifact.Name.EndsWith('.appx', [StringComparison]::OrdinalIgnoreCase)) { throw 'ArtifactPath must name an .appx file' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("maestro-store-publish-" + [guid]::NewGuid().ToString('N'))
$StagedAppx = $null
$StagedMetadata = $null
$PublicAppxPartial = $null
$PublicMetadataPartial = $null
try {
    [System.IO.Directory]::CreateDirectory($TemporaryDirectory) | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Artifact.FullName)
    try {
        [xml]$Manifest = Get-ZipEntryText $archive 'AppxManifest.xml'
        $OAuthEnv = Get-ZipEntryText $archive 'app/resources/backend/.env'
        $AsarPath = Join-Path $TemporaryDirectory 'app.asar'
        Save-ZipEntry $archive 'app/resources/app.asar' $AsarPath
    } finally { $archive.Dispose() }

    $OAuthLines = @($OAuthEnv -split "`r?`n" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') })
    if ($OAuthLines.Count -ne 1 -or -not $OAuthLines[0].StartsWith('MAESTRO_OAUTH_BASE_URL=')) {
        throw 'Bundled backend .env must contain only MAESTRO_OAUTH_BASE_URL'
    }
    $OAuthBaseUrl = $OAuthLines[0].Substring('MAESTRO_OAUTH_BASE_URL='.Length)

    $AsarReader = @'
const asar = require(process.argv[1]);
const info = JSON.parse(asar.extractFile(process.argv[2], 'build-info.json').toString('utf8'));
process.stdout.write(JSON.stringify(info));
'@
    $BuildInfo = Invoke-NodeJson $AsarReader @((Join-Path $ProjectRoot 'electron\node_modules\@electron\asar'), $AsarPath)
    $Sha256 = (Get-FileHash -LiteralPath $Artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $ValidationInput = [ordered]@{
        fileName = $Artifact.Name
        identityName = [string]$Manifest.Package.Identity.Name
        publisher = [string]$Manifest.Package.Identity.Publisher
        expectedIdentityName = [string]$StoreIdentity.identityName
        expectedPublisher = [string]$StoreIdentity.publisher
        buildInfo = $BuildInfo
        oauthBaseUrl = $OAuthBaseUrl
        sha256 = $Sha256
    } | ConvertTo-Json -Depth 5 -Compress
    $Validator = @'
const { validateStoreArtifact } = require(process.argv[1]);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(JSON.stringify(validateStoreArtifact(JSON.parse(input)))));
'@
    $Metadata = Invoke-NodeJson $Validator @((Join-Path $ScriptDir 'storeAppxRelease.js')) $ValidationInput

    $MetadataPath = "$($Artifact.FullName).json"
    [System.IO.File]::WriteAllText($MetadataPath, ($Metadata | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
    $ReleaseId = [guid]::NewGuid().ToString('N')
    $StagedAppx = "$StoreCdnStagingDir/.$($Artifact.Name).$ReleaseId.partial"
    $StagedMetadata = "$StoreCdnStagingDir/.$($Artifact.Name).json.$ReleaseId.partial"
    $PublicAppx = "$StoreCdnPublicDir/$($Artifact.Name)"
    $PublicMetadata = "$StoreCdnPublicDir/$($Artifact.Name).json"
    $PublicAppxPartial = "$PublicAppx.$ReleaseId.partial"
    $PublicMetadataPartial = "$PublicMetadata.$ReleaseId.partial"

    & scp -- $Artifact.FullName "${StoreCdnHost}:$StagedAppx"
    if ($LASTEXITCODE -ne 0) { throw 'scp failed while staging the Store AppX' }
    & scp -- $MetadataPath "${StoreCdnHost}:$StagedMetadata"
    if ($LASTEXITCODE -ne 0) { throw 'scp failed while staging Store metadata' }

    $RemoteCommand = @"
set -eu
sudo -n install -d -m 2775 -o martinstech-cdn -g martinstech-cdn '$StoreCdnPublicDir'
test ! -e '$PublicAppx' && test ! -e '$PublicMetadata'
test "`$(sha256sum '$StagedAppx' | awk '{print `$1}')" = '$Sha256'
sudo -n install -m 664 -o martinstech-cdn -g martinstech-cdn '$StagedAppx' '$PublicAppxPartial'
test "`$(sha256sum '$PublicAppxPartial' | awk '{print `$1}')" = '$Sha256'
sudo -n mv '$PublicAppxPartial' '$PublicAppx'
sudo -n install -m 664 -o martinstech-cdn -g martinstech-cdn '$StagedMetadata' '$PublicMetadataPartial'
sudo -n mv '$PublicMetadataPartial' '$PublicMetadata'
rm -f '$StagedAppx' '$StagedMetadata'
"@
    & ssh $StoreCdnHost $RemoteCommand
    if ($LASTEXITCODE -ne 0) { throw 'Remote Store AppX promotion failed' }

    Write-Host "Published Store AppX: $StoreCdnPublicBaseUrl/$($Artifact.Name)"
    Write-Host "Published metadata: $StoreCdnPublicBaseUrl/$($Artifact.Name).json"
    Write-Host "Version: $($Metadata.version)"
    Write-Host "SHA-256: $($Metadata.sha256)"
    Write-Host "Provenance SHA: $($Metadata.provenanceSha)"
} catch {
    if ($StagedAppx -or $StagedMetadata -or $PublicAppxPartial -or $PublicMetadataPartial) {
        $Cleanup = "rm -f '$StagedAppx' '$StagedMetadata'; sudo -n rm -f '$PublicAppxPartial' '$PublicMetadataPartial'"
        & ssh $StoreCdnHost $Cleanup 2>$null
    }
    throw
} finally {
    if (Test-Path -LiteralPath $TemporaryDirectory) { Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force }
}
