# Master build script for the Maestro Studio desktop app on Windows.
#
# Usage:
#   pwsh scripts\build-app-win.ps1                Local dev build (unsigned)
#   pwsh scripts\build-app-win.ps1 -Sign          Signed build (no publish)
#   pwsh scripts\build-app-win.ps1 -Publish       Production build: sign, then scp the installer
#                                                  to cloudinha:~/maestro-releases/incoming/ for
#                                                  the cdn.martinstech.net publish step (see
#                                                  docs/superpowers/specs/2026-08-13-cdn-version-management-design.md)
#
# Version is always "1.<git commit count>.0", computed fresh from git history -- see that spec
# for why nothing in the tree stores a version number, and for why the trailing ".0" (NuGet/
# Squirrel needs three dotted segments, and electron-builder's ${version} template + app.getVersion()
# both resolve to this exact string, so it's kept three-part everywhere rather than truncated).
#
# Reads .env.windows (gitignored) for Azure Trusted Signing if -Sign or -Publish. GH_TOKEN is no
# longer used by this script (Windows releases no longer publish to GitHub).

[CmdletBinding()]
param(
    [switch]$Sign,
    [switch]$DevSign,
    [switch]$Publish,
    # Fast CI gate path: build only the unpacked win-unpacked\ dir (no
    # installer, no LZMA compression of the ~1GB tree - the slowest packaging
    # phase). verify-all + Playwright drive the unpacked Maestro Studio.exe directly.
    [switch]$DirOnly,
    # electron/package.json's build.win.target is already squirrel (the Phase 7
    # A/B won; NSIS is retired), so this is now a no-op kept only so existing
    # -Squirrel callers (release-windows.yml) don't need editing.
    [switch]$Squirrel
)

$ErrorActionPreference = 'Stop'

# Some dev shells (Git-for-Windows shims prepended aggressively) drop
# C:\Windows\System32 from PATH entirely, so robocopy/taskkill/powershell all
# vanish and the build dies mid-step with "not recognized". Put the system dirs
# back for this process only — never edit the user's PATH from a build script.
foreach ($sysDir in @("$env:SystemRoot\System32", "$env:SystemRoot", "$env:SystemRoot\System32\WindowsPowerShell\v1.0")) {
    if ((Test-Path $sysDir) -and ($env:PATH -split ';' -notcontains $sysDir)) { $env:PATH = "$env:PATH;$sysDir" }
}
foreach ($tool in @('robocopy', 'taskkill')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found even after restoring System32 to PATH. Is this a stripped-down Windows image?" }
}

if ($Publish) { $Sign = $true }
# Override only the win target; everything else (signing hook, extraResources,
# publish config) merges from electron/package.json's build block unchanged.
$TargetOverride = if ($Squirrel) { @('--config.win.target=squirrel', '--config.squirrelWindows.iconUrl=https://raw.githubusercontent.com/gmartinstech/maestro-desktop/main/electron/build/icon.ico') } else { @() }

$ScriptDir   = Split-Path -Parent $PSCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir

# --- Build history log ---
# Append-only, gitignored, one line per invocation (success or failure) so
# build-time regressions/improvements are visible across runs instead of
# living only in a terminal scrollback nobody kept.
$BuildStartedAt = Get-Date
$BuildStopwatch = [Diagnostics.Stopwatch]::StartNew()
$BuildLogPath = Join-Path $ProjectRoot 'electron\build-times.log'
function Write-BuildLogEntry([string]$Outcome) {
    $Elapsed = $BuildStopwatch.Elapsed
    $ModeLabel = if ($Publish) { 'PUBLISH' } elseif ($Sign) { 'SIGN' } elseif ($DevSign) { 'DEVSIGN' } elseif ($DirOnly) { 'DIRONLY' } else { 'LOCAL' }
    $Sha = git -C $ProjectRoot rev-parse --short=12 HEAD 2>$null
    if (-not $Sha) { $Sha = 'unknown' }
    $Line = "{0:yyyy-MM-dd HH:mm:ss}  outcome={1,-7}  mode={2,-8}  elapsed={3:hh\:mm\:ss}  sha={4}" -f $BuildStartedAt, $Outcome, $ModeLabel, $Elapsed, $Sha
    Add-Content -Path $BuildLogPath -Value $Line
}
# Catches terminating errors (the whole script runs under ErrorActionPreference
# Stop, so every `throw` and every failed native call routed through the
# LASTEXITCODE checks lands here) without wrapping ~600 lines in try/finally.
# `break` re-raises after logging, so the original failure/exit-code behavior
# for callers (CI, other scripts) is unchanged.
trap {
    Write-BuildLogEntry 'FAILED'
    break
}

# --- Load .env.windows if present ---
$EnvFile = Join-Path $ProjectRoot '.env.windows'
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $idx = $line.IndexOf('=')
            $name  = $line.Substring(0, $idx).Trim()
            $value = $line.Substring($idx + 1).Trim()
            if ($value.StartsWith('"') -and $value.EndsWith('"')) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

Write-Host "========================================"
Write-Host "  Maestro Studio Desktop App Builder (Windows)"
if     ($Publish) { Write-Host "  Mode: PRODUCTION (sign + publish to cdn.martinstech.net via cloudinha)" }
elseif ($Sign)    { Write-Host "  Mode: SIGNED (sign, no publish)" }
elseif ($DevSign) { Write-Host "  Mode: DEV-SIGNED (self-signed, internal installs only)" }
else              { Write-Host "  Mode: LOCAL (unsigned)" }
Write-Host "========================================"
Write-Host ""

# --- Dev-signing validation ---
# Separate from -Sign on purpose: this path deliberately does NOT require the Azure
# credentials, and must not set VMP_REQUIRE_SIGN (Widevine VMP signing needs castlabs
# EVS credentials, and hard-failing on it would block every internal build).
if ($DevSign) {
    if ($Sign -or $Publish) { Write-Host "ERROR: -DevSign cannot be combined with -Sign or -Publish." -ForegroundColor Red; exit 1 }
    if (-not $env:WINDOWS_DEV_PFX) {
        Write-Host "ERROR: -DevSign needs WINDOWS_DEV_PFX (and usually WINDOWS_DEV_PFX_PASSWORD)." -ForegroundColor Red
        Write-Host "Create one with: pwsh scripts/make-dev-signing-cert.ps1 -Password '<pw>' -Trust"
        exit 1
    }
    if (-not (Test-Path $env:WINDOWS_DEV_PFX)) {
        Write-Host "ERROR: WINDOWS_DEV_PFX not found at $env:WINDOWS_DEV_PFX" -ForegroundColor Red; exit 1
    }
    Write-Host "  Dev cert: $env:WINDOWS_DEV_PFX" -ForegroundColor Yellow
    Write-Host "  NOTE: self-signed. Trusted only where the cert is in Trusted Root. Not for release." -ForegroundColor Yellow
    Write-Host ""
}

# --- Required env validation ---
if ($Sign) {
    $required = @(
        'AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET',
        'AZURE_SIGNING_ENDPOINT','AZURE_SIGNING_ACCOUNT','AZURE_SIGNING_CERT_PROFILE'
    )
    # -Publish no longer needs GH_TOKEN -- it scp's to cloudinha instead of `gh release upload`.
    $missing = $required | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
    if ($missing.Count -gt 0) {
        Write-Host "ERROR: Missing required environment variables:" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "  - $_" }
        Write-Host "Copy .env.windows.example to .env.windows and fill in values."
        exit 1
    }
    # A signed build is one users actually run, so its Widevine VMP signature is
    # mandatory: the afterPack hook hard-fails on a missing/failed signature rather
    # than ship an installer whose Spotify/Netflix audio is silently dead.
    $env:VMP_REQUIRE_SIGN = '1'
}

# --- Step 0: Bundled uv + uvx for Windows ---
# IMPORTANT: uvx.exe is a tiny shim that requires sibling uv.exe at runtime.
# Without uv.exe, MCPs that use `command: uvx` (e.g. Google Workspace) fail
# with "Could not find the `uv` binary". A prior revision shipped only uvx
# to save ~30MB; that broke first-launch MCP discovery on fresh Macs and
# Windows machines without a system uv install. Ship both.
$UvBinDir = Join-Path $ProjectRoot 'backend\uv-bin'
New-Item -ItemType Directory -Force -Path $UvBinDir | Out-Null
$NeedUv = -not (Test-Path (Join-Path $UvBinDir 'uv.exe')) -or `
          -not (Test-Path (Join-Path $UvBinDir 'uvx.exe'))
if ($NeedUv) {
    # Pinned uv version. "latest" used to mean a fresh uv could appear in any
    # build with zero warning, breaking reproducibility (pillar 3). Override
    # with $env:UV_VERSION when deliberately bumping. 0.11.16 is what "latest"
    # resolved to when this was pinned.
    $UvVersion = if ($env:UV_VERSION) { $env:UV_VERSION } else { '0.11.16' }
    Write-Host "[0] Downloading uv + uvx $UvVersion for Windows..."
    $UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
    $TmpZip = Join-Path $env:TEMP "uv-win-$([guid]::NewGuid()).zip"
    $TmpExtract = Join-Path $env:TEMP "uv-win-extract-$([guid]::NewGuid())"
    try {
        Invoke-WebRequest -Uri $UvUrl -OutFile $TmpZip -UseBasicParsing
        Expand-Archive -Path $TmpZip -DestinationPath $TmpExtract -Force
        Get-ChildItem -Path $TmpExtract -Recurse -Filter 'uv.exe'  | Select-Object -First 1 | ForEach-Object { Copy-Item $_.FullName (Join-Path $UvBinDir 'uv.exe')  -Force }
        Get-ChildItem -Path $TmpExtract -Recurse -Filter 'uvx.exe' | Select-Object -First 1 | ForEach-Object { Copy-Item $_.FullName (Join-Path $UvBinDir 'uvx.exe') -Force }
        Write-Host "uv.exe + uvx.exe downloaded and bundled."
    } finally {
        Remove-Item -Force $TmpZip -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $TmpExtract -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[0] uv.exe + uvx.exe already present."
}
Write-Host ""

# --- Step 0a: Sync the splash icon ---
# electron-builder excludes `build/` from the shipped asar (it's the icon-
# source directory used to generate .ico). The splash window needs to read
# the icon at runtime, so we keep a copy at electron\splash\icon.png which
# IS shipped. See electron/main.js comment at iconPngPath for context.
Copy-Item -Force `
    (Join-Path $ProjectRoot 'electron\build\icon.png') `
    (Join-Path $ProjectRoot 'electron\splash\icon.png')

# --- Step 0b: Bundle npm MCP servers via esbuild ---
# Each bundle compiles down to a single ~5-15 MB CommonJS file under
# backend\mcp-bundles\, runs on Electron's bundled Node at runtime
# (ELECTRON_RUN_AS_NODE=1), and is preferred by tools_lib.py:521 over
# any pre-installed node_modules tree. Bundling instead of shipping
# node_modules cuts the installer file count from ~28k -> ~9k, which
# is the dominant lever on NSIS install time + Defender scan cost.
$McpBundleDir = Join-Path $ProjectRoot 'backend\mcp-bundles'
New-Item -ItemType Directory -Force -Path $McpBundleDir | Out-Null

# Single-file CJS bundle. Output path: mcp-bundles\<output>.js. Use for
# packages that don't read sibling files at runtime. The import.meta.url
# polyfill is applied uniformly because nearly every modern ESM package
# uses createRequire(import.meta.url) somewhere -- without the polyfill,
# esbuild's ESM->CJS transform leaves import.meta.url as undefined and
# the bundle crashes at module load.
function Build-McpBundleSingle($PackageName, $EntrySubpath, $OutputName) {
    $OutFile = Join-Path $McpBundleDir $OutputName
    if ((Test-Path $OutFile) -and -not $env:MAESTRO_REBUILD_BUNDLES) {
        Write-Host "[0b] $PackageName bundle already present (set `$env:MAESTRO_REBUILD_BUNDLES='1' to force rebuild)."
        return
    }
    Write-Host "[0b] Bundling $PackageName -> $OutputName ..."
    $TmpDir = Join-Path $env:TEMP "maestro-mcp-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
    Push-Location $TmpDir
    try {
        & npm install $PackageName --silent 2>$null
        if ($LASTEXITCODE -ne 0) { throw "$PackageName install failed" }
        $EntryPath = Join-Path (Join-Path $TmpDir 'node_modules') $EntrySubpath
        if (-not (Test-Path $EntryPath)) { throw "$PackageName entry not found at $EntryPath" }
        $banner = 'const __MAESTRO_IMPORT_META_URL__ = require("url").pathToFileURL(__filename).href;'
        & npx esbuild $EntryPath --bundle --platform=node --format=cjs --target=node22 --legal-comments=none `
            --define:import.meta.url=__MAESTRO_IMPORT_META_URL__ `
            "--banner:js=$banner" `
            "--outfile=$OutFile"
        if ($LASTEXITCODE -ne 0) { throw "esbuild failed for $PackageName" }
        Write-Host "$PackageName bundled."
    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    }
}

# Multi-file bundle. Output is a directory mcp-bundles\<dir>\ that mirrors the
# upstream SDK's "package_root\dist\index.js + ..\package.json" layout. Use this
# for packages whose source reads __dirname\..\package.json (for --version) or
# other sibling data files (e.g. @softeria\ms-365-mcp-server reads endpoints.json).
function Build-McpBundleDir($PackageName, $EntrySubpath, $OutDirName, $Extras, $External) {
    $OutDir = Join-Path $McpBundleDir $OutDirName
    $OutBundle = Join-Path (Join-Path $OutDir 'dist') 'index.js'
    if ((Test-Path $OutBundle) -and -not $env:MAESTRO_REBUILD_BUNDLES) {
        Write-Host "[0b] $PackageName bundle dir already present."
        return
    }
    Write-Host "[0b] Bundling $PackageName -> $OutDirName\ ..."
    $TmpDir = Join-Path $env:TEMP "maestro-mcp-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
    if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
    New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'dist') | Out-Null
    Push-Location $TmpDir
    try {
        & npm install $PackageName --silent 2>$null
        if ($LASTEXITCODE -ne 0) { throw "$PackageName install failed" }
        $EntryPath = Join-Path (Join-Path $TmpDir 'node_modules') $EntrySubpath
        if (-not (Test-Path $EntryPath)) { throw "$PackageName entry not found at $EntryPath" }

        # Stripped sibling package.json (omits "type":"module" so Node treats the CJS bundle correctly)
        $SdkPkgPath = Join-Path (Join-Path $TmpDir 'node_modules') (Join-Path $PackageName 'package.json')
        $SdkPkgJson = Get-Content -Raw $SdkPkgPath | ConvertFrom-Json
        $SdkVersion = $SdkPkgJson.version
        $StrippedPkg = "{`"name`":`"$PackageName`",`"version`":`"$SdkVersion`"}"
        Set-Content -Path (Join-Path $OutDir 'package.json') -Value $StrippedPkg -NoNewline

        # Copy sibling data files
        if ($Extras) {
            foreach ($pair in $Extras) {
                $src, $dst = $pair -split '='
                $srcAbs = Join-Path (Join-Path $TmpDir 'node_modules') $src
                $dstAbs = Join-Path $OutDir $dst
                New-Item -ItemType Directory -Force -Path (Split-Path $dstAbs -Parent) | Out-Null
                Copy-Item -Force $srcAbs $dstAbs
            }
        }

        $banner = 'const __MAESTRO_IMPORT_META_URL__ = require("url").pathToFileURL(__filename).href;'
        $esbuildArgs = @(
            $EntryPath, '--bundle', '--platform=node', '--format=cjs',
            '--target=node22', '--legal-comments=none',
            '--define:import.meta.url=__MAESTRO_IMPORT_META_URL__',
            "--banner:js=$banner",
            "--outfile=$OutBundle"
        )
        if ($External) {
            foreach ($ext in $External) { $esbuildArgs += "--external:$ext" }
        }
        & npx esbuild @esbuildArgs
        if ($LASTEXITCODE -ne 0) { throw "esbuild failed for $PackageName" }
        Write-Host "$PackageName bundled."
    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    }
}

Build-McpBundleSingle 'reddit-mcp-buddy'              'reddit-mcp-buddy/dist/index.js'             'reddit-mcp-buddy.js'
Build-McpBundleDir    '@notionhq/notion-mcp-server'   '@notionhq/notion-mcp-server/bin/cli.mjs'    `
                      'notionhq-notion-mcp-server' `
                      @('@notionhq/notion-mcp-server/scripts/notion-openapi.json=scripts/notion-openapi.json') `
                      @()
Build-McpBundleDir    '@softeria/ms-365-mcp-server'   '@softeria/ms-365-mcp-server/dist/index.js' `
                      'softeria-ms-365-mcp-server' `
                      @('@softeria/ms-365-mcp-server/dist/endpoints.json=dist/endpoints.json') `
                      @('keytar')

# Wipe legacy single-file Notion bundle if the dir-style bundle now supersedes it.
$LegacyNotionFile = Join-Path $McpBundleDir 'notionhq-notion-mcp-server.js'
$NotionDir = Join-Path $McpBundleDir 'notionhq-notion-mcp-server'
if ((Test-Path $LegacyNotionFile) -and (Test-Path $NotionDir)) {
    Remove-Item -Force $LegacyNotionFile
}

# Defensively wipe any legacy npm-servers/ tree from prior builds so it
# doesn't ride along into the installer (would re-introduce the ~19k
# files we just removed by switching to bundling).
$LegacyNpmServers = Join-Path $ProjectRoot 'backend\npm-servers'
if (Test-Path $LegacyNpmServers) {
    Write-Host "[0b] Removing legacy backend\npm-servers\ (now superseded by mcp-bundles)..."
    Remove-Item -Recurse -Force $LegacyNpmServers
}
Write-Host ""

# npm ci (not install): installs exactly what package-lock.json pins, never
# silently mutates the lock, fails loudly on drift. Reproducible builds
# (pillar 3) depend on the lock being boss. But re-running it unconditionally
# on every local rebuild reinstalls an unchanged node_modules\ from scratch
# every time; skip it when package-lock.json's hash matches the last install
# recorded in node_modules\.package-lock-hash (deleted whenever npm ci does
# run, so a failed/partial install can never look like a hit).
function Invoke-NpmCiIfNeeded($Dir, $Label) {
    $Lock = Join-Path $Dir 'package-lock.json'
    $Marker = Join-Path $Dir 'node_modules\.package-lock-hash'
    $Hash = (Get-FileHash -Algorithm SHA256 $Lock).Hash
    if ((Test-Path $Marker) -and ((Get-Content -Raw $Marker).Trim() -eq $Hash) -and -not $env:MAESTRO_REBUILD_NODE_MODULES) {
        Write-Host "npm ci ($Label) skipped - package-lock.json unchanged (set `$env:MAESTRO_REBUILD_NODE_MODULES='1' to force)."
        return
    }
    Push-Location $Dir
    try {
        Remove-Item -Force $Marker -ErrorAction SilentlyContinue
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci ($Label) failed" }
        Set-Content -Path $Marker -Value $Hash -NoNewline
    } finally { Pop-Location }
}

# --- Step 1: Frontend build ---
Write-Host "[1/5] Building frontend..."
Invoke-NpmCiIfNeeded (Join-Path $ProjectRoot 'frontend') 'frontend'
Push-Location (Join-Path $ProjectRoot 'frontend')
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $ProjectRoot 'frontend\dist\index.html'))) {
    throw "Frontend build failed - dist\index.html not found"
}
Write-Host "Frontend build complete."
Write-Host ""

# --- Step 2: Python env ---
$PythonEnv = Join-Path $ProjectRoot 'electron\python-env'
$PythonExe = Join-Path $PythonEnv 'python.exe'
# Gated on requirements.lock's hash (the file build-python-env-win.ps1 actually installs from),
# not mere presence: a bare Test-Path reused a stale env
# after a dependency was added, shipping an installer whose backend died on import and never
# served, which reads as "app boots to a blank window". Marker is deleted before the rebuild
# so a failed/partial install can never look like a hit (same stance as Invoke-NpmCiIfNeeded).
$Requirements = Join-Path $ProjectRoot 'backend\requirements.lock'
$PythonMarker = Join-Path $PythonEnv '.requirements-hash'
$RequirementsHash = (Get-FileHash -Algorithm SHA256 $Requirements).Hash
if ((Test-Path $PythonExe) -and (Test-Path $PythonMarker) -and ((Get-Content -Raw $PythonMarker).Trim() -eq $RequirementsHash) -and -not $env:MAESTRO_REBUILD_PYTHON) {
    Write-Host "[2/5] Python environment already present at $PythonEnv (set `$env:MAESTRO_REBUILD_PYTHON='1' to force rebuild)."
} else {
    Write-Host "[2/5] Building Python environment..."
    Remove-Item -Force $PythonMarker -ErrorAction SilentlyContinue
    & (Join-Path $ScriptDir 'build-python-env-win.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Python env build failed" }
    Set-Content -Path $PythonMarker -Value $RequirementsHash -NoNewline
}
if (-not (Test-Path (Join-Path $ProjectRoot 'electron\python-env'))) {
    throw "Python environment not found at electron\python-env\"
}
Write-Host "Python environment ready."
Write-Host ""
# NOTE: #9 items 1+3 (zip stdlib + pyc-only site-packages) were measured to give
# NO cold-start benefit (cold is native-binary-scan-bound, not file-count-bound),
# so they are NOT wired in. scripts/zip-python-stdlib.ps1 + strip-py-to-pyc.ps1
# remain as drafts. The cold lever is the opt-in Defender exclusion (item 5).

# --- Step 3: Fetch Router from npm ---
# The 9router Next.js server is published as an npm package with a pre-built
# standalone output. Stage it directly from npm instead of vendoring + rebuilding.
Write-Host "[3/5] Fetching Router from npm..."
$Staging = Join-Path $ProjectRoot 'electron\build-staging'
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

# Re-invoke through THIS host rather than a bare `powershell`: System32's
# WindowsPowerShell dir is not always on PATH (it is absent under pwsh 7 here),
# which failed the build at step 3. Same fix as bsdtar in bdc077e6.
$PSExe = (Get-Process -Id $PID).Path
& $PSExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'scripts\fetch-router.ps1') -Dest (Join-Path $Staging 'router')
if ($LASTEXITCODE -ne 0) { throw "fetch-router.ps1 failed" }

if (-not (Test-Path (Join-Path $Staging 'router\server.js'))) {
    throw "Router fetch failed - server.js not found in staging"
}
Write-Host "Router staged."
Write-Host ""

# --- Step 3b: Bundle a real Node.js binary so 9Router and MCP servers
# don't fall back to ELECTRON_RUN_AS_NODE on user machines without system
# node. Wins: (1) avoids the bouncing "exec" Dock icon (irrelevant on
# Windows but matches the macOS build for consistency); (2) shrinks
# 9Router cold-start from ~10s (Electron-as-Node) to ~1-2s (real node),
# which directly shrinks the splash window the user sees during boot.
# Pinned to Node 20 LTS, NODE_MODULE_VERSION 115. 9router 0.3.60 has
# no native bindings (sql.js, not better-sqlite3) so any Node 18+ works.
Write-Host "[3b/5] Bundling Node.js runtime..."
$NodeVersion = 'v20.18.1'
$NodeStageDir = Join-Path $Staging 'node\x64'
New-Item -ItemType Directory -Force -Path $NodeStageDir | Out-Null
# Persistent cache keyed by version, outside build-staging\ (wiped every build)
# so a pinned version only downloads once across all builds, same pattern as
# backend\uv-bin\ above. Bump NodeVersion -> new cache dir -> one more download.
$NodeCacheDir = Join-Path $ProjectRoot "electron\node-bin\$NodeVersion\x64"
$NodeCacheReady = (Test-Path (Join-Path $NodeCacheDir 'node.exe')) -and `
                  (Test-Path (Join-Path $NodeCacheDir 'npm.cmd')) -and `
                  (Test-Path (Join-Path $NodeCacheDir 'node_modules'))
if ($NodeCacheReady -and -not $env:MAESTRO_REBUILD_NODE) {
    Write-Host "[3b] Node $NodeVersion (x64) already cached (set `$env:MAESTRO_REBUILD_NODE='1' to force re-download)."
    Copy-Item -Recurse -Force (Join-Path $NodeCacheDir '*') $NodeStageDir
} else {
    $NodeZip = Join-Path $env:TEMP "node-win-$([guid]::NewGuid()).zip"
    $NodeExtract = Join-Path $env:TEMP "node-win-extract-$([guid]::NewGuid())"
    try {
        $NodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
        Write-Host "[3b] Downloading $NodeUrl..."
        Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
        Expand-Archive -Path $NodeZip -DestinationPath $NodeExtract -Force
        $SrcRoot = Join-Path $NodeExtract "node-$NodeVersion-win-x64"
        $SrcNode = Join-Path $SrcRoot 'node.exe'
        if (-not (Test-Path $SrcNode)) { throw "node.exe not found at $SrcNode after extract" }
        if (Test-Path $NodeCacheDir) { Remove-Item -Recurse -Force $NodeCacheDir }
        New-Item -ItemType Directory -Force -Path $NodeCacheDir | Out-Null
        Copy-Item -Force $SrcNode (Join-Path $NodeCacheDir 'node.exe')
        # Bundle npm too so packaged apps with custom deps can `npm install` them. npm.cmd + node_modules\npm sit next to node.exe in the win dist; p_resolve_npm finds node_dir\npm.cmd.
        Copy-Item -Force (Join-Path $SrcRoot 'npm.cmd') (Join-Path $NodeCacheDir 'npm.cmd')
        Copy-Item -Recurse -Force (Join-Path $SrcRoot 'node_modules') (Join-Path $NodeCacheDir 'node_modules')
        Copy-Item -Recurse -Force (Join-Path $NodeCacheDir '*') $NodeStageDir
    } finally {
        if (Test-Path $NodeZip) { Remove-Item -Force $NodeZip }
        if (Test-Path $NodeExtract) { Remove-Item -Recurse -Force $NodeExtract }
    }
}
$Size = (Get-Item (Join-Path $NodeStageDir 'node.exe')).Length / 1MB
Write-Host ("[3b] Node {0} (x64) staged ({1:N1} MB)" -f $NodeVersion, $Size)
Write-Host ""

# --- Step 4: Snapshot source dirs into electron\build-staging\ ---
# (Router was already staged in step 3; do not wipe or re-copy it here.)
Write-Host "[4/5] Snapshotting source directories..."

function Copy-Excluded($Source, $Dest, $Exclude) {
    # robocopy: built-in, fast, handles long paths.
    $args = @($Source, $Dest, '/E', '/NJH', '/NJS', '/NDL', '/NFL', '/NP', '/MT:8')
    foreach ($d in $Exclude.Dirs)  { $args += '/XD'; $args += $d }
    foreach ($f in $Exclude.Files) { $args += '/XF'; $args += $f }
    & robocopy @args | Out-Null
    # robocopy exit codes 0-7 are success
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($Source -> $Dest, exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

Copy-Excluded `
    (Join-Path $ProjectRoot 'backend') (Join-Path $Staging 'backend') `
    @{ Dirs = @('__pycache__','.venv','data','uv-bin','tests'); Files = @('*.pyc','.env','.env.*') }
# The '.env.*' exclude above is recursive, so it also strips the vendored
# webapp_template/.env.example that seed_workspace copies into each new app's
# .env (BACKEND_PORT=NONE). The mac build anchors its exclude to avoid this;
# here we restore the one file. Without it, Windows-built apps seed with no
# .env, run.sh takes the backend branch, and the app dies on a missing backend.
# (seed_workspace also now writes a default .env when this is absent, but
# shipping it keeps the template snapshot complete and matches mac.)
$EnvExampleSrc = Join-Path $ProjectRoot 'backend\apps\outputs\webapp_template\.env.example'
$EnvExampleDst = Join-Path $Staging 'backend\apps\outputs\webapp_template\.env.example'
if (Test-Path $EnvExampleSrc) {
    New-Item -ItemType Directory -Force -Path (Split-Path $EnvExampleDst -Parent) | Out-Null
    Copy-Item -Force $EnvExampleSrc $EnvExampleDst
    Write-Host "Restored webapp_template/.env.example (stripped by the .env.* exclude)"
}

# --- Step 4b: Pre-build the webapp-template node_modules archive (.tar.gz).
# The Windows build never shipped any node_modules, and the bundled node has no
# npm, so the App Builder frontend had no way to get its deps; the preview died
# with the misleading "backend exited with code 1". We ship a single compressed
# archive (mirrors the Mac build's step 3c); the runtime's _try_extract_bundled_archive
# unpacks it into the warm cache (kicked off in the background by
# warm_cache_in_background at startup, so it is off the first-app create path).
# NOTE: we deliberately do NOT ship node_modules pre-extracted into resources --
# that adds ~30k tiny files which made electron-builder/Squirrel LZMA compression
# blow the build past 50 min and bloats the installer. One .tar.gz (~26 MB) keeps
# the build fast and the installer small. Built natively so the esbuild/rollup
# win32 binaries are correct. Non-fatal: a failure warns but does not break the
# build. Digest == _warm_cache_digest() (sha256 of frontend/package.json, 12 hex).
Write-Host "[4b] Pre-building webapp-template node_modules archive (.tar.gz)..."
try {
    $TmplFrontend = Join-Path $Staging 'backend\apps\outputs\webapp_template\frontend'
    $PkgJson = Join-Path $TmplFrontend 'package.json'
    if (-not (Test-Path $PkgJson)) { throw "template package.json not found at $PkgJson" }
    $Digest = (Get-FileHash -Algorithm SHA256 $PkgJson).Hash.ToLower().Substring(0, 12)
    $CacheDir = Join-Path $Staging 'backend\apps\outputs\webapp_template_cache'
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    $OutArchive = Join-Path $CacheDir "node_modules.$Digest.tar.gz"
    # Persistent cache keyed by the same digest, outside build-staging\ (wiped
    # every build), so an unchanged template package.json skips npm install +
    # tar entirely on repeat builds instead of just renaming the same work.
    $PersistCacheDir = Join-Path $ProjectRoot 'electron\webapp-template-archive-cache'
    $PersistArchive = Join-Path $PersistCacheDir "node_modules.$Digest.tar.gz"
    if ((Test-Path $PersistArchive) -and -not $env:MAESTRO_REBUILD_BUNDLES) {
        Copy-Item -Force $PersistArchive $OutArchive
        $ArchMB = (Get-Item $OutArchive).Length / 1MB
        Write-Host ("[4b] webapp-template archive already cached: node_modules.$Digest.tar.gz ({0:N1} MB)" -f $ArchMB)
    } else {
        $WorkDir = Join-Path $env:TEMP "os-tmpl-nm-$([guid]::NewGuid())"
        New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
        try {
            Copy-Item -Force $PkgJson (Join-Path $WorkDir 'package.json')
            $Lock = Join-Path $TmplFrontend 'package-lock.json'
            Push-Location $WorkDir
            if (Test-Path $Lock) {
                Copy-Item -Force $Lock (Join-Path $WorkDir 'package-lock.json')
                & npm ci --prefer-offline --no-audit --no-fund --loglevel=error
            } else {
                & npm install --prefer-offline --no-audit --no-fund --loglevel=error
            }
            if ($LASTEXITCODE -ne 0) { throw "npm install/ci failed ($LASTEXITCODE)" }
            if (-not (Test-Path (Join-Path $WorkDir 'node_modules'))) { throw "no node_modules produced" }
            # tar.exe (bsdtar) ships with Windows 10+; archive root is node_modules/.
            & tar -czf $OutArchive -C $WorkDir node_modules
            if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
            Pop-Location
            New-Item -ItemType Directory -Force -Path $PersistCacheDir | Out-Null
            Get-ChildItem -Path $PersistCacheDir -Filter 'node_modules.*.tar.gz' -ErrorAction SilentlyContinue | Remove-Item -Force
            Copy-Item -Force $OutArchive $PersistArchive
            $ArchMB = (Get-Item $OutArchive).Length / 1MB
            Write-Host ("[4b] webapp-template archive staged: node_modules.$Digest.tar.gz ({0:N1} MB)" -f $ArchMB)
        } finally {
            if ((Get-Location).Path -eq $WorkDir) { Pop-Location }
            if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
        }
    }
} catch {
    Write-Warning "[4b] webapp-template archive build FAILED: $_  (App Builder first-app falls back to live npm; non-fatal)"
}
# data: backend/config/paths.py points DATA_ROOT at %APPDATA%/Maestro Studio/data in
# packaged mode and no code seeds from the bundle, so the entire shipped
# backend/data/ tree was dead weight (and was leaking the dev machine's
# auth.token + install_id + dev session artifacts).
# uv-bin: source dir holds the binary so dev works; staged separately below
# so extraResources can substitute ${arch} (matches the mac build).

# Production .env: OAuth helper base URL + Google credentials. See
# Google client_id/secret are no longer shipped: nothing reads them at runtime,
# so we don't bake a secret into the .env.
$ShipOauthBaseUrl = if ($env:MAESTRO_OAUTH_BASE_URL_OVERRIDE) {
    $env:MAESTRO_OAUTH_BASE_URL_OVERRIDE
} else {
    'https://llm.martinstech.net/v1'
}
$ShipEnvPath = Join-Path $Staging 'backend\.env'
New-Item -ItemType Directory -Force -Path (Split-Path $ShipEnvPath -Parent) | Out-Null
@(
    "# OAuth helper base URL.",
    "MAESTRO_OAUTH_BASE_URL=$ShipOauthBaseUrl"
) | Set-Content -Path $ShipEnvPath
Write-Host "Staged production .env"

# Stage uv-bin into per-arch staging so package.json extraResources can
# substitute ${arch} and ship only the matching slice. Windows is x64-only
# today; matches the mac build's per-arch staging shape.
$UvStageX64 = Join-Path $Staging 'uv-bin\x64'
New-Item -ItemType Directory -Force -Path $UvStageX64 | Out-Null
Copy-Item -Force (Join-Path $UvBinDir 'uv.exe')  (Join-Path $UvStageX64 'uv.exe')
Copy-Item -Force (Join-Path $UvBinDir 'uvx.exe') (Join-Path $UvStageX64 'uvx.exe')

Copy-Excluded `
    (Join-Path $ProjectRoot 'debugger') (Join-Path $Staging 'debugger') `
    @{ Dirs = @('__pycache__','.venv','node_modules'); Files = @('*.pyc') }

Copy-Item -Recurse -Force (Join-Path $ProjectRoot 'frontend\dist\*') (New-Item -ItemType Directory -Force -Path (Join-Path $Staging 'frontend')).FullName

Write-Host ""
Write-Host "========================================" -BackgroundColor Green -ForegroundColor White
Write-Host "  SOURCE SNAPSHOT COMPLETE              " -BackgroundColor Green -ForegroundColor White
Write-Host "  Safe to modify your codebase now.     " -BackgroundColor Green -ForegroundColor White
Write-Host "========================================" -BackgroundColor Green -ForegroundColor White
Write-Host ""

# --- Provenance stamp ---
# Version = "1.<commit count>.0" (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md).
# Computed fresh every build from git history, then floored against what is already published.
# electron\build-info.json ships inside the asar; main.js reads it for the startup [provenance] log
# line and the About panel. Gitignored + regenerated each build.
#
# The commit count alone is NOT monotonic across a squash-merge: squashing a 1756-commit branch onto
# main collapses it to one commit, so main's count came back as 1747 while the CDN was already
# serving 1.1756.0. A lower version is not just cosmetic -- Squirrel refuses to install it over a
# newer one (it drops an `app-<ver>\.dead` marker and keeps running the old build) and no install
# already on the higher version ever updates. So the published version is a floor: never go
# backwards, whatever git history says. Set MAESTRO_VERSION_FLOOR to skip the network lookup.
$BuildSha = (git -C $ProjectRoot rev-parse HEAD 2>$null)
if (-not $BuildSha) { $BuildSha = 'unknown' }
$CommitCount = (git -C $ProjectRoot rev-list --count HEAD 2>$null)
if (-not $CommitCount) { throw "git rev-list --count HEAD failed -- is $ProjectRoot a git checkout?" }
$CommitCount = [int]$CommitCount.Trim()
$VersionFloor = 0
if ($env:MAESTRO_VERSION_FLOOR) {
    $VersionFloor = [int]$env:MAESTRO_VERSION_FLOOR
    Write-Host "Version floor $VersionFloor taken from MAESTRO_VERSION_FLOOR."
} else {
    try {
        $Published = Invoke-RestMethod -Uri 'https://cdn.martinstech.net/maestro/version.json' -TimeoutSec 15
        if ($Published.latest.commitCount) { $VersionFloor = [int]$Published.latest.commitCount + 1 }
        Write-Host "Published latest is $($Published.latest.version); floor is $VersionFloor."
    } catch {
        # Offline/dev builds must still work; only a -Publish build actually needs the floor to be right.
        Write-Host "WARNING: could not read the published version.json, so the version is unfloored. Set MAESTRO_VERSION_FLOOR if this build is going to the CDN."
    }
}
$EffectiveCount = [Math]::Max($CommitCount, $VersionFloor)
if ($EffectiveCount -ne $CommitCount) {
    Write-Host "Version floored: commit count $CommitCount -> $EffectiveCount (already-published version is higher)."
}
$BuildVersion = "1.$EffectiveCount.0"
$BuildChannel = 'stable'
$BuildShortSha = if ($BuildSha.Length -ge 12) { $BuildSha.Substring(0, 12) } else { $BuildSha }
$BuildInfo = [ordered]@{
    sha      = $BuildSha
    shortSha = $BuildShortSha
    builtAt  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    channel  = $BuildChannel
    version  = $BuildVersion
}
$BuildInfo | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $ProjectRoot 'electron\build-info.json') -Encoding utf8
Write-Host "Stamped build-info.json: version=$BuildVersion sha=$BuildShortSha"

# --- Step 5: Package with electron-builder ---
Write-Host "[5/5] Packaging with electron-builder..."
# extraMetadata.version overrides electron/package.json's tracked version for THIS build only --
# nothing on disk changes, so nothing needs reverting after. $BuildVersion is already three-part
# ("1.<count>.0") -- electron-builder's ${version} artifactName token and app.getVersion() both
# resolve to this exact string, so there is exactly one version format used everywhere.
$ExtraMetadataArg = "--config.extraMetadata.version=$BuildVersion"
Push-Location (Join-Path $ProjectRoot 'electron')
try {
    # npm ci: lockfile-exact, no drift. See Invoke-NpmCiIfNeeded above.
    Invoke-NpmCiIfNeeded (Join-Path $ProjectRoot 'electron') 'electron'

    if (-not $Sign) {
        $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    }

    # --publish never unconditionally: this script no longer publishes to GitHub Releases for
    # Windows (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md). -Publish
    # below still means "produce a release-ready signed installer," just delivered via scp to the
    # CDN host instead of `gh release upload`.
    if ($DirOnly) {
        # Unpacked-only build for the fast CI gate. afterPack (router node_modules)
        # and locale-pak filtering still run during the pack phase, so the produced
        # win-unpacked\Maestro Studio.exe is fully functional; only the NSIS installer +
        # update feed are skipped (verify-update-feed skips cleanly when absent).
        & npx electron-builder --win --x64 --dir $TargetOverride $ExtraMetadataArg --publish never
    } else {
        & npx electron-builder --win --x64 $TargetOverride $ExtraMetadataArg --publish never
    }
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally { Pop-Location }

# NOTE: the bundled 9Router's node_modules (which electron-builder 26 drops from
# extraResources) is restored by the build/after-pack.js afterPack hook, which
# runs inside electron-builder BEFORE code-signing so the copied files are sealed
# by the signature. See that file for the why.

Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue

# --- Step 5b: Publish to the CDN (cloudinha) ---
# Ships the signed installer to cdn.martinstech.net/maestro/* instead of GitHub Releases.
# cloudinha-side placement + version.json rotation happens in a separate step (see
# docs/superpowers/specs/2026-08-13-cdn-version-management-design.md section 5) -- this only
# gets the file onto the box and tells the operator what to paste into that step.
if ($Publish) {
    Write-Host "[5b/5] Publishing $BuildVersion to cdn.martinstech.net via cloudinha..."
    $DistDir  = Join-Path $ProjectRoot 'electron\dist'
    $SetupExe = Get-ChildItem -Path $DistDir -Recurse -Filter '*Setup*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $SetupExe) { throw "No Squirrel Setup .exe found under $DistDir to publish" }
    $ExpectedName = "MaestroStudio-Setup-$BuildVersion-x64.exe"
    if ($SetupExe.Name -ne $ExpectedName) {
        throw "Built installer is named '$($SetupExe.Name)', expected '$ExpectedName' -- artifactName / version mismatch, refusing to publish"
    }
    if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
        throw "scp not found; cannot publish $ExpectedName to cloudinha (install an OpenSSH client or publish manually)"
    }
    $Sha256 = (Get-FileHash -Path $SetupExe.FullName -Algorithm SHA256).Hash.ToLower()
    & scp $SetupExe.FullName "cloudinha:~/maestro-releases/incoming/$ExpectedName"
    if ($LASTEXITCODE -ne 0) { throw "scp of $ExpectedName to cloudinha failed" }
    Write-Host ""
    Write-Host "Uploaded $ExpectedName to cloudinha:~/maestro-releases/incoming/."
    Write-Host "Paste these into the cloudinha publish prompt:"
    Write-Host "  Version: $BuildVersion"
    Write-Host "  Expected sha256: $Sha256"
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Build Complete!"
Write-Host "========================================"
Write-Host ""
Write-Host "Output files:"
Get-ChildItem -Path (Join-Path $ProjectRoot 'electron\dist') -Filter '*.exe' -ErrorAction SilentlyContinue | Format-Table Name, Length, LastWriteTime
Get-ChildItem -Path (Join-Path $ProjectRoot 'electron\dist') -Filter '*.zip' -ErrorAction SilentlyContinue | Format-Table Name, Length, LastWriteTime

Write-BuildLogEntry 'SUCCESS'
Write-Host "Elapsed: $($BuildStopwatch.Elapsed.ToString('hh\:mm\:ss'))  (logged to $BuildLogPath)"
