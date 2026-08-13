# CDN-Based Version Management & Windows Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub Releases as the Windows update source with a self-hosted CDN (`cdn.martinstech.net/maestro/*`, served from the `cloudinha` VPS) and a commit-count-derived version scheme (`1.{git rev-list --count HEAD}`), while leaving the existing Mac `electron-updater` code path untouched (Mac is not shipped today per `docs/RELEASE_RUNBOOK.md`, but the code stays for a possible future re-adoption).

**Architecture:** A new pure-logic module (`electron/cdnUpdater.js`) owns version-string parsing and "is this newer" decisions, unit-tested with zero Electron dependency. `electron/main.js`'s existing `setupAutoUpdater()` / `installDownloadedUpdate()` keep their current shape and safety logic (crash-watchdog lock, busy-agent guard, idle-install heartbeat) but the Windows (`isSquirrelUpdater`) branch swaps Squirrel's GitHub-hosted RELEASES feed for a `fetch` against the CDN manifest, and swaps `autoUpdater.quitAndInstall()` for spawning a self-downloaded, sha256-verified installer. The release script (`scripts/build-app-win.ps1`) computes the git-commit-count version, bakes it into the build via electron-builder's `extraMetadata`, and — on `-Publish` — scp's the signed installer to cloudinha instead of calling `gh release upload`.

**Tech Stack:** Electron main process (Node.js `https`/`crypto`/`child_process`), `node --test` for unit tests, PowerShell 7 (`pwsh`) for the release script, nginx + static files on the `cloudinha` VPS (set up separately, not part of this repo).

**Reference:** Design spec at `docs/superpowers/specs/2026-08-13-cdn-version-management-design.md`. Read it before starting — it explains the *why* behind the version format and the retention policy that this plan implements.

**Accepted tradeoff (confirmed with the user):** the current CI has a promotion gate (`verify-release.js`) and staged rollout (`stagingPercentage` in `latest.yml`, watched against boot-failure beacons) for Windows releases. This plan drops both — a published version reaches 100% of Windows installs on their next check, with no automated feed-integrity gate. This was a deliberate choice, not an oversight; do not silently re-add staged rollout while implementing this plan.

**Out of scope for this plan (explicitly deferred, do not touch):**
- Deleting `.github/workflows/release-windows.yml`, `promotion-gate.yml`, or the `v*` tag-protection ruleset. They simply won't trigger once releases stop using `v*` tags / `gh release upload`; leaving them in place costs nothing and deleting CI config is a separate decision.
- Setting up nginx/TLS/webroot on cloudinha — that's handled by a separate agent dispatched directly on that VPS, outside this repo.
- Any Mac-side change.

---

### Task 1: `cdnUpdater.js` — pure version-comparison logic

**Files:**
- Create: `electron/cdnUpdater.js`
- Test: `electron/cdnUpdater.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// electron/cdnUpdater.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CDN_MANIFEST_URL, commitCountFromVersion, pickUpdate } = require('./cdnUpdater');

test('CDN_MANIFEST_URL points at the maestro CDN path', () => {
  assert.equal(CDN_MANIFEST_URL, 'https://cdn.martinstech.net/maestro/version.json');
});

test('commitCountFromVersion parses "1.N" into N', () => {
  assert.equal(commitCountFromVersion('1.482'), 482);
  assert.equal(commitCountFromVersion('1.0'), 0);
});

test('commitCountFromVersion returns null for anything else', () => {
  assert.equal(commitCountFromVersion(''), null);
  assert.equal(commitCountFromVersion(null), null);
  assert.equal(commitCountFromVersion(undefined), null);
  assert.equal(commitCountFromVersion('482'), null);
  assert.equal(commitCountFromVersion('2.482'), null);
  assert.equal(commitCountFromVersion('1.482.0'), null);
  assert.equal(commitCountFromVersion('1.abc'), null);
});

test('pickUpdate returns the latest release when it is newer', () => {
  const manifest = {
    latest: {
      version: '1.482',
      commitCount: 482,
      file: 'MaestroStudio-Setup-1.482-x64.exe',
      url: 'https://cdn.martinstech.net/maestro/MaestroStudio-Setup-1.482-x64.exe',
      sha256: 'abc123',
      releasedAt: '2026-08-13T18:00:00Z',
    },
    history: ['1.482', '1.479', '1.475'],
  };
  assert.deepEqual(pickUpdate(manifest, '1.475'), manifest.latest);
});

test('pickUpdate returns null when already on the latest or newer version', () => {
  const manifest = { latest: { version: '1.482', url: 'u', sha256: 's' }, history: [] };
  assert.equal(pickUpdate(manifest, '1.482'), null);
  assert.equal(pickUpdate(manifest, '1.500'), null);
});

test('pickUpdate returns null for a manifest with no release yet', () => {
  assert.equal(pickUpdate({ latest: null, history: [] }, '1.1'), null);
  assert.equal(pickUpdate(null, '1.1'), null);
});

test('pickUpdate returns null when latest is missing url or sha256 (malformed manifest)', () => {
  assert.equal(pickUpdate({ latest: { version: '1.482' }, history: [] }, '1.1'), null);
  assert.equal(pickUpdate({ latest: { version: '1.482', url: 'u' }, history: [] }, '1.1'), null);
});

test('pickUpdate returns null when either version string fails to parse', () => {
  const manifest = { latest: { version: 'not-a-version', url: 'u', sha256: 's' }, history: [] };
  assert.equal(pickUpdate(manifest, '1.1'), null);
  assert.equal(pickUpdate({ latest: { version: '1.482', url: 'u', sha256: 's' }, history: [] }, 'not-a-version'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd electron && node --test cdnUpdater.test.js`
Expected: FAIL — `Cannot find module './cdnUpdater'`

- [ ] **Step 3: Write `electron/cdnUpdater.js`**

```js
// electron/cdnUpdater.js
// Version-comparison logic for the Windows CDN updater. Kept separate from main.js, and free of
// any Electron/network/filesystem dependency, so "is this newer?" and "is this manifest usable?"
// are unit-testable without spinning up Electron or a real HTTP call. main.js owns the fetch,
// the download, the sha256 verification of the downloaded bytes, and the install/spawn step —
// this module only ever sees already-parsed JSON and version strings.

const CDN_MANIFEST_URL = 'https://cdn.martinstech.net/maestro/version.json';

// Every version is "1.<commitCount>" (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md).
// Extracting the count lets two versions compare as integers -- "1.9" vs "1.10" would come out
// backwards under plain string/semver comparison, and the commit count is the only part that
// ever changes.
function commitCountFromVersion(version) {
  const match = /^1\.(\d+)$/.exec(String(version == null ? '' : version).trim());
  return match ? Number(match[1]) : null;
}

// Returns the manifest's `latest` release object if it's newer than `currentVersion`, else null.
// Null covers every "don't update" case on purpose (no release yet, already current, malformed
// manifest) so main.js has exactly one branch to handle instead of separately guarding each cause
// -- a bad or half-written manifest on the CDN must never crash the app or loop an update prompt.
function pickUpdate(manifest, currentVersion) {
  const latest = manifest && manifest.latest;
  if (!latest || !latest.version || !latest.url || !latest.sha256) return null;
  const latestCount = commitCountFromVersion(latest.version);
  const currentCount = commitCountFromVersion(currentVersion);
  if (latestCount === null || currentCount === null) return null;
  if (latestCount <= currentCount) return null;
  return latest;
}

module.exports = { CDN_MANIFEST_URL, commitCountFromVersion, pickUpdate };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd electron && node --test cdnUpdater.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/cdnUpdater.js electron/cdnUpdater.test.js
git commit -m "feat(updater): add pure version-comparison logic for the CDN updater"
```

---

### Task 2: Bake the git-commit-count version into the artifact name

**Files:**
- Modify: `electron/package.json:65` (`build.win.artifactName`)
- Modify: `electron/package.json:76-85` (`build.nsis`, same artifactName pattern for consistency, and drop the now-dead `publish` block)

- [ ] **Step 1: Update `build.win.artifactName`**

In `electron/package.json`, change:

```json
      "artifactName": "MaestroStudio-Setup-${arch}.${ext}",
```

(the one inside `"win": { ... }`, right before `"signtoolOptions"`) to:

```json
      "artifactName": "MaestroStudio-Setup-${version}-${arch}.${ext}",
```

- [ ] **Step 2: Update `build.nsis.artifactName` the same way**

Change:

```json
      "artifactName": "MaestroStudio-Setup-${arch}.${ext}",
```

(the one inside `"nsis": { ... }`) to:

```json
      "artifactName": "MaestroStudio-Setup-${version}-${arch}.${ext}",
```

(NSIS isn't the shipped target — Squirrel is — but keeping both templates in sync avoids a surprise if `-Squirrel` is ever turned off.)

- [ ] **Step 3: Remove the GitHub `publish` block**

Delete this whole block from `electron/package.json` (it sits right after the `nsis` block's closing brace, before `extraResources`):

```json
    "publish": {
      "provider": "github",
      "owner": "gmartinstech",
      "repo": "maestro-desktop"
    },
```

This repo no longer publishes to GitHub Releases for Windows, so leaving GH publish config in place is dead weight that could accidentally fire again if some future `--publish always` flag creeps back in.

- [ ] **Step 4: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('electron/package.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add electron/package.json
git commit -m "build: version the Windows installer filename, drop GitHub publish config"
```

---

### Task 3: Release script — git-commit-count version, scp to cloudinha instead of `gh release upload`

**Files:**
- Modify: `scripts/build-app-win.ps1:511-524` (provenance stamp / `$BuildVersion`)
- Modify: `scripts/build-app-win.ps1:526-554` (electron-builder invocation — add `extraMetadata.version`, always `--publish never`)
- Modify: `scripts/build-app-win.ps1:563-584` (replace the GitHub alias-upload step with scp + sha256)
- Modify: `scripts/build-app-win.ps1:1-24` (param block: add `-CdnHost`, drop nothing required, `-Publish`'s doc comment)

- [ ] **Step 1: Compute the git-commit-count version before the provenance stamp**

Replace lines 507-524 (the `# --- Provenance stamp ---` block) with:

```powershell
# --- Provenance stamp ---
# Version = "1.<commit count>" (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md).
# Computed fresh every build from git history -- nothing in the tree stores a version number, so
# there is nothing to bump and nothing two branches could ever disagree on. electron\build-info.json
# ships inside the asar; main.js reads it for the startup [provenance] log line and the About panel.
# Gitignored + regenerated each build.
$BuildSha = (git -C $ProjectRoot rev-parse HEAD 2>$null)
if (-not $BuildSha) { $BuildSha = 'unknown' }
$CommitCount = (git -C $ProjectRoot rev-list --count HEAD 2>$null)
if (-not $CommitCount) { throw "git rev-list --count HEAD failed -- is $ProjectRoot a git checkout?" }
$BuildVersion = "1.$($CommitCount.Trim())"
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
```

(This drops the old `-` suffix / `experimental` channel logic — that was for reading a pre-release
suffix out of `electron/package.json`'s version field, which no longer drives the real version.)

- [ ] **Step 2: Bake `$BuildVersion` into the electron-builder invocation and always skip GitHub publish**

Replace lines 526-554 (the `# --- Step 5: Package with electron-builder ---` block) with:

```powershell
# --- Step 5: Package with electron-builder ---
Write-Host "[5/5] Packaging with electron-builder..."
# extraMetadata.version overrides electron/package.json's tracked version for THIS build only --
# nothing on disk changes, so nothing needs reverting after. NuGet/Squirrel needs three dotted
# segments internally; the two-segment "1.<count>" form is what ships in the manifest/filename/UI.
$ExtraMetadataArg = "--config.extraMetadata.version=$BuildVersion.0"
Push-Location (Join-Path $ProjectRoot 'electron')
try {
    # npm ci: lockfile-exact, no drift. See frontend note above.
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci (electron) failed" }

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
```

- [ ] **Step 3: Replace the GitHub alias-upload step with scp + sha256**

Replace lines 563-584 (the `# --- Step 5b ---` block through its closing `}`) with:

```powershell
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
```

- [ ] **Step 4: Update the usage comment and `-Publish` doc line at the top of the file**

Replace lines 1-8 with:

```powershell
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
# Version is always "1.<git commit count>", computed fresh from git history -- see that spec for
# why nothing in the tree stores a version number.
#
# Reads .env.windows (gitignored) for Azure Trusted Signing if -Sign or -Publish. GH_TOKEN is no
# longer used by this script (Windows releases no longer publish to GitHub).
```

- [ ] **Step 5: Verify the script still parses**

Run: `pwsh -NoProfile -Command "$null = Get-Content -Raw scripts/build-app-win.ps1 | Out-Null; [System.Management.Automation.Language.Parser]::ParseFile('scripts/build-app-win.ps1', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_ }; exit 1 }; Write-Host 'ok'"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add scripts/build-app-win.ps1
git commit -m "build(release): compute version from git commit count, publish to cloudinha instead of GitHub"
```

---

### Task 4: `main.js` — CDN check, download, and install for Windows

**Files:**
- Modify: `electron/main.js:52-58` (add `https`/`crypto` requires)
- Modify: `electron/main.js:40-51` (require `./cdnUpdater`)
- Modify: `electron/main.js:1585-1671` (`setupAutoUpdater` Windows branch + `_runUpdateCheck`)
- Modify: `electron/main.js:2977-3010` (`check-for-updates` / `download-update` IPC handlers)
- Modify: `electron/main.js:3033-3046` (`installDownloadedUpdate` Windows branch)

This task changes only the `isSquirrelUpdater` (Windows) branches. Every `else` branch (Mac / `electron-updater`) is untouched — leave its code, comments, and behavior exactly as they are.

- [ ] **Step 1: Add the new requires**

Near the top of `electron/main.js`, right after the existing platform-split updater block (after line 51's closing `}` of the `try`/`catch` around `autoUpdater = ...`), add:

```js
const https = require('https');
const crypto = require('crypto');
const { CDN_MANIFEST_URL, pickUpdate } = require('./cdnUpdater');
```

- [ ] **Step 2: Add the CDN fetch/download helpers, right before `function setupAutoUpdater() {`**

Insert this new block immediately before line 1585 (`function setupAutoUpdater() {`):

```js
// Windows-only: fetches https://cdn.martinstech.net/maestro/version.json over HTTPS and parses
// it as JSON. Rejects on any network/parse error so the caller's catch handles it the same way
// as a Squirrel feed failure -- a CDN hiccup must look like "check failed," never crash anything.
function fetchCdnManifest() {
  return new Promise((resolve, reject) => {
    const req = https.get(CDN_MANIFEST_URL, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`CDN manifest fetch failed: HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('CDN manifest fetch timed out')); });
  });
}

// Downloads `release.url` to a fresh temp file and verifies its sha256 against `release.sha256`
// before returning the path. Deletes the partial/mismatched file on any failure so a half-written
// or tampered download is never left around to be spawned later.
function downloadCdnRelease(release) {
  return new Promise((resolve, reject) => {
    const dest = path.join(os.tmpdir(), release.file || `maestro-update-${Date.now()}.exe`);
    const file = fs.createWriteStream(dest);
    const hash = crypto.createHash('sha256');
    const cleanupAndReject = (err) => {
      file.close(() => { try { fs.unlinkSync(dest); } catch (_) {} });
      reject(err);
    };
    const req = https.get(release.url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        cleanupAndReject(new Error(`CDN download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.on('data', (chunk) => hash.update(chunk));
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const digest = hash.digest('hex');
          if (digest !== release.sha256) {
            cleanupAndReject(new Error(`CDN download sha256 mismatch: got ${digest}, expected ${release.sha256}`));
            return;
          }
          resolve(dest);
        });
      });
    });
    req.on('error', cleanupAndReject);
    req.on('timeout', () => { req.destroy(new Error('CDN download timed out')); });
  });
}

// Path to the last successfully downloaded + sha256-verified installer, set by
// checkCdnForUpdate() and consumed by installDownloadedUpdate(). Windows-only equivalent of what
// electron-updater tracks internally for Mac.
let cdnDownloadedInstallerPath = null;

// Windows equivalent of autoUpdater.checkForUpdates() + its autoDownload=true behavior on Mac:
// fetch the manifest, and if it names a newer release, download and verify it immediately so the
// UI can go straight from "available" to "downloaded" without a separate user-triggered fetch.
async function checkCdnForUpdate() {
  const manifest = await fetchCdnManifest();
  const release = pickUpdate(manifest, app.getVersion());
  if (!release) {
    console.log('App is up to date');
    cachedUpdateStatus = { status: 'not-available', info: {}, error: null };
    sendToRenderer('update-not-available', {});
    return;
  }
  console.log(`Update available: ${release.version}`);
  cachedUpdateStatus = { status: 'available', info: { version: release.version }, error: null };
  sendToRenderer('update-available', { version: release.version });
  try {
    cdnDownloadedInstallerPath = await downloadCdnRelease(release);
    console.log(`Update downloaded: ${release.version}`);
    cachedUpdateStatus = { status: 'downloaded', info: { version: release.version }, error: null };
    sendToRenderer('update-downloaded', { version: release.version });
  } catch (err) {
    console.error('CDN update download failed:', err);
    cachedUpdateStatus = { status: 'error', info: null, error: t('appShell.update.networkError') };
    sendToRenderer('update-error', t('appShell.update.networkError'));
  }
}
```

- [ ] **Step 3: Replace the Squirrel feed setup inside `setupAutoUpdater()`**

Replace this block (currently lines 1587-1595):

```js
  if (isSquirrelUpdater) {
    // Squirrel.Windows fetches its RELEASES feed from GH /latest/download/. The
    // built-in autoUpdater has no autoDownload/allowPrerelease/allowDowngrade knobs.
    try {
      autoUpdater.setFeedURL({ url: 'https://github.com/gmartinstech/maestro-desktop/releases/latest/download/' });
    } catch (err) {
      console.warn('[updater] Squirrel setFeedURL failed:', err && err.message);
      return;
    }
  } else {
```

with:

```js
  if (isSquirrelUpdater) {
    // Windows updates come from cdn.martinstech.net/maestro/version.json instead of a Squirrel
    // RELEASES feed on GitHub (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md).
    // Nothing to configure here -- checkCdnForUpdate() does its own fetch, no feed URL to set.
  } else {
```

- [ ] **Step 4: Route the event listeners and the periodic check away from the built-in `autoUpdater` object on Windows**

The block from `autoUpdater.on('update-available', ...)` (line 1612) through the `autoUpdater.on('error', ...)` handler (ending line 1654) only applies to Mac now — those events never fire on Windows because nothing calls `autoUpdater.checkForUpdates()` for Squirrel anymore. Wrap that whole listener block (lines 1608-1654, i.e. everything from the comment `// electron-updater (Mac) passes an info object...` through the closing `});` of the `error` handler) in `if (!isSquirrelUpdater) { ... }`:

```js
  if (!isSquirrelUpdater) {
    // electron-updater (Mac) passes an info object ({version,...}); the built-in
    // Windows autoUpdater (Squirrel) fires update-available/-not-available with NO
    // args and update-downloaded with positional (event, releaseNotes, releaseName,
    // releaseDate, updateURL). Normalize so these handlers work for both.
    autoUpdater.on('update-available', (info) => {
      const norm = info && info.version ? info : { version: '' };
      console.log(`Update available: ${norm.version || '(version not reported by Squirrel)'}`);
      cachedUpdateStatus = { status: 'available', info: norm, error: null };
      sendToRenderer('update-available', norm);
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('App is up to date');
      cachedUpdateStatus = { status: 'not-available', info: info || {}, error: null };
      sendToRenderer('update-not-available', info || {});
    });

    autoUpdater.on('download-progress', (progress) => {
      cachedUpdateStatus = { status: 'downloading', info: progress, error: null };
      sendToRenderer('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info, releaseNotes, releaseName) => {
      const version = (info && info.version) || releaseName || '';
      console.log(`Update downloaded: ${version || '(ready to install)'}`);
      const norm = info && info.version ? info : { version };
      cachedUpdateStatus = { status: 'downloaded', info: norm, error: null };
      sendToRenderer('update-downloaded', norm);
    });

    autoUpdater.on('error', (err) => {
      // Squirrel throws "AutoUpdater process ... is already running" when a check or
      // download is already in flight (e.g. the user clicked Check twice). Benign.
      if (/already running/i.test((err && err.message) || '')) {
        console.log('[updater] check already in progress; ignoring duplicate trigger');
        return;
      }
      // Raw electron-updater errors are verbose (full URL, HTTP status, stack,
      // sometimes an HTML body). Keep the raw text in the log for debugging, but
      // never show it to the user. The common case is "Experimental updates is on
      // but no pre-release exists": the GitHub provider 404s hunting a pre-release
      // feed, which is not a real failure, just "nothing newer to install".
      console.error('Auto-update error:', err);
      const friendly = friendlyUpdateError(err);
      cachedUpdateStatus = { status: 'error', info: null, error: friendly };
      sendToRenderer('update-error', friendly);
    });
  }
```

- [ ] **Step 5: Route `_runUpdateCheck` to the CDN checker on Windows**

Replace this block (currently lines 1659-1666):

```js
  const _runUpdateCheck = (label) => {
    try {
      const p = autoUpdater.checkForUpdates();
      if (p && typeof p.catch === 'function') p.catch((err) => console.log(`${label}:`, err && err.message));
    } catch (err) {
      console.log(`${label} threw:`, err && err.message);
    }
  };
```

with:

```js
  const _runUpdateCheck = (label) => {
    if (isSquirrelUpdater) {
      checkCdnForUpdate().catch((err) => console.log(`${label}:`, err && err.message));
      return;
    }
    try {
      const p = autoUpdater.checkForUpdates();
      if (p && typeof p.catch === 'function') p.catch((err) => console.log(`${label}:`, err && err.message));
    } catch (err) {
      console.log(`${label} threw:`, err && err.message);
    }
  };
```

- [ ] **Step 6: Update the `check-for-updates` IPC handler**

Replace (currently lines 2985-2988):

```js
    if (isSquirrelUpdater) {
      autoUpdater.checkForUpdates();
      return { success: true };
    }
```

with:

```js
    if (isSquirrelUpdater) {
      checkCdnForUpdate().catch((err) => console.log('Update check failed:', err && err.message));
      return { success: true };
    }
```

- [ ] **Step 7: Leave `download-update`'s Windows branch as-is**

No change needed to lines 3000-3003 — `checkCdnForUpdate()` already downloads automatically once it finds a newer release (mirroring Mac's `autoDownload = true`), so `if (isSquirrelUpdater) return { success: true };` is still correct: there's nothing left to trigger.

- [ ] **Step 8: Replace the Windows install step in `installDownloadedUpdate()`**

Replace this line (currently line 3045):

```js
  if (isSquirrelUpdater) { autoUpdater.quitAndInstall(); return; }
```

with:

```js
  if (isSquirrelUpdater) {
    if (!cdnDownloadedInstallerPath) {
      console.warn('[updater] installDownloadedUpdate called with no downloaded installer path');
      isInstallingUpdate = false;
      return;
    }
    try {
      // Squirrel's Setup.exe installs unattended (no flags needed) and relaunches the app itself
      // once done -- same UX as when Squirrel fetched it from its own feed. detached + unref so
      // it survives this process quitting, since the install can't proceed while our own files
      // are still open.
      spawn(cdnDownloadedInstallerPath, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (err) {
      console.error('[updater] failed to spawn downloaded installer:', err);
      isInstallingUpdate = false;
      return;
    }
    app.quit();
    return;
  }
```

- [ ] **Step 9: Run the electron test suite**

Run: `cd electron && node --test *.test.js`
Expected: all existing tests plus the new `cdnUpdater.test.js` tests pass (baseline unaffected — this task touches no files any existing test imports).

- [ ] **Step 10: Commit**

```bash
git add electron/main.js
git commit -m "feat(updater): replace Squirrel GitHub feed with CDN check/download/install on Windows"
```

---

### Task 5: Update the release runbook

**Files:**
- Modify: `docs/RELEASE_RUNBOOK.md`

- [ ] **Step 1: Replace the whole document**

The current runbook describes a GitHub-Releases-based flow (staged rollout, promotion gate, tag
protection) that no longer matches reality for Windows once Tasks 1-4 land. Replace the entire
contents of `docs/RELEASE_RUNBOOK.md` with:

```markdown
# Release Runbook

How a Maestro Studio desktop release is built, verified, and promoted. The guiding
rule: **a release is reproducible and provenanced** — anyone can tell exactly
what commit produced a given EXE, and rebuilding that commit yields the same
bits. Distribution is self-hosted: `cdn.martinstech.net/maestro/*`, served from
the `cloudinha` VPS (see `docs/superpowers/specs/2026-08-13-cdn-version-management-design.md`
for the full design).

## Versioning

Version is always `1.{git rev-list --count HEAD}` (e.g. `1.482`) — computed fresh
at build time by `scripts/build-app-win.ps1`, never stored or committed anywhere.
There is nothing to bump: the commit count only grows, so two branches can never
disagree on a version number. `electron/package.json`'s own `version` field is
just a placeholder overridden per-build via electron-builder's `extraMetadata`.

## What is pinned (reproducibility)

| Thing | Pin | Where |
|-------|-----|-------|
| uv | `0.11.16` | `scripts/build-app-win.ps1` (override `UV_VERSION`) |
| Node (bundled runtime + CI toolchain) | `20.18.1` | build scripts, `.nvmrc`, `.github/workflows/*` |
| 9router | `0.3.60` | `scripts/fetch-router.{sh,ps1}` (override `ROUTER_VERSION`) |
| Python | `3.13.2` standalone | `scripts/build-python-env-win.ps1` |
| Python deps | fully hash-locked | `backend/requirements.lock` |
| npm deps | lockfile-exact via `npm ci` | `frontend/package-lock.json`, `electron/package-lock.json` |
| electron-builder + deps | exact (no `^`) | `electron/package.json` |

Both `package-lock.json` files are **committed** — `npm ci` refuses to run
without them. Do not re-add them to `.gitignore`.

### Regenerating the Python lock

After editing `backend/requirements.txt`:

```
uv pip compile backend/requirements.txt --python-version 3.13 \
    --generate-hashes --output-file backend/requirements.lock
```

Commit both files together. Verify with a clean 3.13 env: install from the lock,
`uv pip check`, and import anthropic / pydantic / httpx / trafilatura /
claude_agent_sdk / uvicorn.

## Provenance

Every build writes `electron/build-info.json` (gitignored, regenerated) with the
`git rev-parse HEAD` sha, build time, channel, and the git-commit-count version.
It ships in the asar and surfaces in two places:

- Startup log line in `backend.log`: `[provenance] Maestro <ver> sha=<short> channel=<...>`
- Settings → General → Advanced → About → **Build**

To confirm an artifact's provenance: launch it, open Settings, and compare the
Build sha to `git rev-parse HEAD` of the commit you released, and the version to
`git rev-list --count HEAD` of that same commit (as `1.<count>`).

## Build (local)

Windows is the only shipped target. macOS was dropped and its build/release
pipeline (`scripts/build-app.sh`, `publish.sh`, `release-macos.yml`, notarization,
entitlements) was deleted — do not resurrect it without a decision to re-adopt it.

- `pwsh scripts/build-app-win.ps1` — local dev build, unsigned.
- `pwsh scripts/build-app-win.ps1 -Sign` — signed build (Azure Trusted Signing), not published.
- `pwsh scripts/build-app-win.ps1 -Publish` — signed build, then scp's the installer to
  `cloudinha:~/maestro-releases/incoming/` and prints the version + sha256 to paste into the
  cloudinha publish step below.

## Release (manual, two machines)

1. On your build machine: `pwsh scripts/build-app-win.ps1 -Publish`. Note the printed version
   and sha256.
2. On `cloudinha` (the box `cdn.martinstech.net` resolves to): paste the cloudinha publish
   prompt (kept outside this repo — ask whoever ran the CDN setup for it) with that version and
   sha256 filled in. It moves the installer into the CDN webroot, rewrites `version.json`, and
   prunes anything past the 3 most recently published builds.
3. Confirm: `curl -sI https://cdn.martinstech.net/maestro/version.json` returns 200, and its
   `latest.version` matches what you just published.

## Update verification (before telling anyone it's live)

Windows apps check `cdn.martinstech.net/maestro/version.json` on launch and every 4h, download
in the background on detect, and install on quit (or after a sustained idle period with no
active agent). To verify a release actually lands:

1. Install the previous stable build.
2. Launch it, wait for (or trigger via Settings → Check for Updates) the update-available /
   update-downloaded flow.
3. Restart & Update (or quit and relaunch) — confirm it comes back up on the new version
   (Settings → About → Build sha flips to the new commit).

**No staged rollout.** Unlike the old GitHub-Releases flow, a published version is immediately
live for every Windows install that checks — there is no `stagingPercentage` gate and no
automated feed-integrity check before it goes out. This is a deliberate simplification (see the
CDN design spec's "accepted tradeoff"); if the install base grows enough that a bad build reaching
everyone at once becomes a real risk, re-introduce staged rollout in `version.json` (a stable
per-install hash bucketed against a percentage field) rather than reverting to GitHub Releases.

## Rolling back a bad release

Re-run the cloudinha publish step against an older build still in
`~/maestro-releases/incoming/` (or re-scp it there) with a version number attribute matching
what you want `version.json`'s `latest` to point to. There's no dedicated rollback tooling
beyond "publish an older build again" — the update check only compares against whatever
`version.json` currently says is latest.
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE_RUNBOOK.md
git commit -m "docs: rewrite release runbook for the CDN-based Windows update flow"
```

---

## Self-review notes (already applied above)

- **Spec coverage:** §1 versioning → Tasks 2-3; §2 artifact naming → Task 2; §3 release flow →
  Task 3; §4 CDN layout/manifest → consumed by Task 4's `cdnUpdater.js` (manifest shape matches
  the spec's `version.json` exactly); §5 cloudinha publish step → out of scope (separate agent on
  that VPS, not this repo) but referenced from the runbook; §6 app-side check/install → Task 4.
- **Type consistency:** `pickUpdate(manifest, currentVersion)` returns the same shape
  (`{version, commitCount, file, url, sha256, releasedAt}`) that Task 4's `checkCdnForUpdate()`
  and `downloadCdnRelease()` consume (`release.url`, `release.sha256`, `release.file`,
  `release.version`) — no field-name drift between the two files.
- **No placeholders:** every step above has literal, complete code — nothing marked TBD.
