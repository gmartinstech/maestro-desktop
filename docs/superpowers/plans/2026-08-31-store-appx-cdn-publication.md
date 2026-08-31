# Store AppX CDN Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an already-built Store AppX as a verified immutable static CDN download while leaving the Azure-signed Squirrel channel untouched.

**Architecture:** A small Node module validates the filename, manifest identity, Store build provenance, public OAuth base URL, and metadata shape. A PowerShell publisher extracts package facts, uses that module, stages files on `cloudinha`, verifies the remote hash, and atomically promotes an AppX followed by its sidecar under `/maestro/downloads/`. Documentation and a project-local skill prescribe the two separate release paths.

**Tech Stack:** Node.js built-in test runner, PowerShell 7, `System.IO.Compression`, `@electron/asar`, OpenSSH `scp`/`ssh`.

---

### Task 1: Add testable Store artifact validation and metadata rendering

**Files:**
- Create: `scripts/storeAppxRelease.js`
- Create: `scripts/storeAppxRelease.test.js`

- [ ] **Step 1: Write the failing Node tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStoreArtifact, STORE_CDN } = require('./storeAppxRelease');

const valid = {
  fileName: 'MaestroStudio-Store-1.1879.0-x64.appx',
  identityName: 'MaestroStudio',
  publisher: 'CN=MartinsTech',
  expectedIdentityName: 'MaestroStudio',
  expectedPublisher: 'CN=MartinsTech',
  buildInfo: { channel: 'store', version: '1.1879.0', sha: 'bc8db86f347eb9fc450a0f07c87644425d501c4c' },
  oauthBaseUrl: 'https://llm.martinstech.net/v1',
  sha256: 'ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71',
};

test('creates immutable Store CDN metadata from a validated Store package', () => {
  assert.deepEqual(validateStoreArtifact(valid), {
    schema: 1, channel: 'store-static-download', file: valid.fileName, version: '1.1879.0',
    sha256: valid.sha256, provenanceSha: valid.buildInfo.sha,
  });
});

test('rejects a Squirrel filename, non-Store provenance, identity mismatch, and credentialed OAuth URL', () => {
  for (const patch of [
    { fileName: 'MaestroStudio-Setup-1.1879.0-x64.exe' },
    { buildInfo: { ...valid.buildInfo, channel: 'stable' } },
    { identityName: 'other' },
    { oauthBaseUrl: 'https://token@example.test/v1' },
  ]) assert.throws(() => validateStoreArtifact({ ...valid, ...patch }));
});

test('uses the fixed Store-download path and never a Squirrel manifest', () => {
  assert.equal(STORE_CDN.host, 'cloudinha');
  assert.equal(STORE_CDN.publicBaseUrl, 'https://cdn.martinstech.net/maestro/downloads');
  assert.match(STORE_CDN.publicDir, /\/maestro\/downloads$/);
  assert.match(STORE_CDN.stagingDir, /\/maestro-releases\/incoming$/);
  assert.equal(JSON.stringify(STORE_CDN).includes('version.json'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/storeAppxRelease.test.js`

Expected: fail with `Cannot find module './storeAppxRelease'`.

- [ ] **Step 3: Implement the minimal validation module**

```js
const STORE_CDN = Object.freeze({
  host: 'cloudinha',
  stagingDir: '/home/ubuntu/maestro-releases/incoming',
  publicDir: '/home/martinstech-cdn/htdocs/cdn.martinstech.net/maestro/downloads',
  publicBaseUrl: 'https://cdn.martinstech.net/maestro/downloads',
});
const NAME = /^MaestroStudio-Store-(\d+\.\d+\.\d+)-x64\.appx$/;
const SHA = /^[a-f0-9]{40}$/i;
const HASH = /^[a-f0-9]{64}$/i;

function validateStoreArtifact(input) {
  const match = NAME.exec(input.fileName || '');
  if (!match) throw new Error('Expected MaestroStudio-Store-<version>-x64.appx');
  if (!input.identityName || input.identityName !== input.expectedIdentityName) throw new Error('AppX identity does not match Partner Center identity');
  if (!input.publisher || input.publisher !== input.expectedPublisher) throw new Error('AppX publisher does not match Partner Center publisher');
  if (!input.buildInfo || input.buildInfo.channel !== 'store' || input.buildInfo.version !== match[1] || !SHA.test(input.buildInfo.sha || '')) throw new Error('AppX Store provenance is invalid');
  if (!HASH.test(input.sha256 || '')) throw new Error('AppX SHA-256 is invalid');
  const url = new URL(input.oauthBaseUrl || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname !== 'llm.martinstech.net' || url.pathname.replace(/\/$/, '') !== '/v1') throw new Error('Bundled OAuth URL is not the expected public gateway');
  return { schema: 1, channel: 'store-static-download', file: input.fileName, version: match[1], sha256: input.sha256.toLowerCase(), provenanceSha: input.buildInfo.sha.toLowerCase() };
}
module.exports = { STORE_CDN, validateStoreArtifact };
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test scripts/storeAppxRelease.test.js`

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/storeAppxRelease.js scripts/storeAppxRelease.test.js
git commit -m "feat(release): validate Store AppX CDN artifacts"
```

### Task 2: Add a non-rebuilding, atomic AppX publisher

**Files:**
- Create: `scripts/publish-store-appx.ps1`
- Modify: `.env.windows.example`
- Test: `scripts/storeAppxRelease.test.js`

- [ ] **Step 1: Write the failing publisher-boundary test**

Add `const fs = require('node:fs');` and this test:

```js
test('publisher accepts an existing artifact and cannot rebuild or touch Squirrel metadata', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, 'publish-store-appx.ps1'), 'utf8');
  assert.match(source, /\[Parameter\(Mandatory\)\]\[ValidateNotNullOrEmpty\(\)\]\[string\]\$ArtifactPath/);
  assert.match(source, /MaestroStudio-Store/);
  assert.match(source, /\.partial/);
  assert.doesNotMatch(source, /electron-builder|build-app-win\.ps1|version\.json/);
});
```

Run: `node --test scripts/storeAppxRelease.test.js`

Expected: fail with `ENOENT` because `publish-store-appx.ps1` does not exist.

- [ ] **Step 2: Implement `scripts/publish-store-appx.ps1`**

The script must declare:

```powershell
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ArtifactPath)
$ErrorActionPreference = 'Stop'
$StoreCdnHost = 'cloudinha'
$StoreCdnStagingDir = '/home/ubuntu/maestro-releases/incoming'
$StoreCdnPublicDir = '/home/martinstech-cdn/htdocs/cdn.martinstech.net/maestro/downloads'
$StoreCdnPublicBaseUrl = 'https://cdn.martinstech.net/maestro/downloads'
```

It must load the ignored `.env.windows` using the existing build script’s `NAME=VALUE` rules, call `resolveWindowsBuildMode({ store: true })` after loading it to require the Partner Center identity values, and refuse a missing `scp`, `ssh`, or artifact.

Use `System.IO.Compression.ZipFile` to read `AppxManifest.xml`, `app/resources/backend/.env`, and extract `app/resources/app.asar` to a unique temp directory. Run a Node one-liner from the project `electron` directory using `@electron/asar` to print the `build-info.json` JSON. Send these extracted facts plus `Get-FileHash -Algorithm SHA256` to `validateStoreArtifact` and serialize its returned metadata to `<ArtifactPath>.json`.

Upload the AppX and JSON to distinct GUID-suffixed `.partial` names in `$StoreCdnStagingDir`. Before promotion, remote-check that neither final filename exists. In one remote shell command:

```sh
set -eu
install -d -m 2775 -o martinstech-cdn -g martinstech-cdn "$public_dir"
test ! -e "$final_appx" && test ! -e "$final_json"
test "$(sha256sum "$staged_appx" | awk '{print $1}')" = "$expected_sha256"
install -m 664 -o martinstech-cdn -g martinstech-cdn "$staged_appx" "$final_appx.partial"
test "$(sha256sum "$final_appx.partial" | awk '{print $1}')" = "$expected_sha256"
mv "$final_appx.partial" "$final_appx"
install -m 664 -o martinstech-cdn -g martinstech-cdn "$staged_json" "$final_json.partial"
mv "$final_json.partial" "$final_json"
```

Run that command through `sudo -n`; quote only validation-produced filenames and GUIDs. On failure, remove staged and public `.partial` names, never final immutable names. Print the CDN AppX URL, sidecar URL, version, SHA-256, and provenance SHA only after successful promotion. Do not mention or reference `version.json`.

- [ ] **Step 3: Document tool requirements without secrets**

Append to `.env.windows.example`:

```text
# Store AppX CDN publication uses the existing `cloudinha` SSH host and no additional
# environment variables. It requires the Partner Center identity fields above, scp/ssh,
# and noninteractive sudo permissions configured on cloudinha. Do not add credentials here.
```

- [ ] **Step 4: Run focused tests and a non-publishing syntax check**

Run: `node --test scripts/storeAppxRelease.test.js`

Expected: 4 passing tests, including the publisher-boundary test.

Run: `pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content scripts/publish-store-appx.ps1 -Raw)); 'syntax OK'"`

Expected: `syntax OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish-store-appx.ps1 scripts/storeAppxRelease.js scripts/storeAppxRelease.test.js .env.windows.example
git commit -m "feat(release): publish Store AppX to static CDN"
```

### Task 3: Document the two release channels and add the project skill

**Files:**
- Modify: `docs/RELEASE_RUNBOOK.md`
- Create: `.agents/skills/publishing-maestro-windows-releases/SKILL.md`
- Test: `scripts/storeAppxRelease.test.js`

- [ ] **Step 1: Add a failing documentation-boundary test**

Add this test:

```js
test('Store artifact metadata never names the Squirrel updater manifest', () => {
  const metadata = validateStoreArtifact(valid);
  assert.equal(JSON.stringify(metadata).includes('version.json'), false);
  assert.equal(metadata.channel, 'store-static-download');
});
```

Run: `node --test scripts/storeAppxRelease.test.js`

Expected: pass only after Task 1’s metadata contract exists; if it already passes, retain it as the regression test.

- [ ] **Step 2: Update `docs/RELEASE_RUNBOOK.md`**

Replace the Store handoff’s “never uploads to the CDN” language with the exact command:

```powershell
pwsh scripts/publish-store-appx.ps1 -ArtifactPath electron/dist/MaestroStudio-Store-1.1879.0-x64.appx
```

Document the immutable AppX and `.json` URLs under `/maestro/downloads/`, exact SHA/provenance verification, manual Partner Center upload, and the rule that only `build-app-win.ps1 -Publish` changes the Azure-signed Squirrel pipeline. Preserve the existing Store-managed updater verification.

- [ ] **Step 3: Create the project-local skill**

Create `.agents/skills/publishing-maestro-windows-releases/SKILL.md` with valid Agent Skills frontmatter:

```yaml
---
name: publishing-maestro-windows-releases
description: Use when building, verifying, or publishing Maestro Studio Windows releases to the Microsoft Store static-download path or the Azure-signed Squirrel CDN channel.
---
```

The skill must require checking the artifact filename, SHA-256, provenance, and channel before upload; identify the verified `1.1879.0` AppX as a worked record; prescribe `publish-store-appx.ps1` for Store files; prescribe `build-app-win.ps1 -Publish` only for Azure-signed Squirrel files; and explicitly reject AppX use in `version.json`, unsigned/self-signed Squirrel release uploads, and Store-install CDN updates.

- [ ] **Step 4: Run the focused test suite**

Run: `node --test scripts/storeAppxRelease.test.js scripts/windowsBuildMode.test.js electron/storeChannel.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/RELEASE_RUNBOOK.md .agents/skills/publishing-maestro-windows-releases/SKILL.md scripts/storeAppxRelease.test.js
git commit -m "docs(release): document dual-channel Windows publication"
```

### Task 4: Publish and verify the existing artifact

**Files:**
- No tracked source changes.

- [ ] **Step 1: Run the full project gate**

Run: `npm run verify`

Expected: `VERIFY GREEN`.

- [ ] **Step 2: Publish the verified candidate without rebuilding**

Run from the checkout containing the artifact:

```powershell
pwsh scripts/publish-store-appx.ps1 -ArtifactPath C:\Users\gmartinssi\maestro-desktop\electron\dist\MaestroStudio-Store-1.1879.0-x64.appx
```

Expected: public AppX and sidecar URLs under `https://cdn.martinstech.net/maestro/downloads/` and the recorded SHA-256/provenance output.

- [ ] **Step 3: Verify public bytes and Squirrel isolation**

```powershell
(Get-FileHash electron/dist/MaestroStudio-Store-1.1879.0-x64.appx -Algorithm SHA256).Hash.ToLower()
(Invoke-WebRequest https://cdn.martinstech.net/maestro/downloads/MaestroStudio-Store-1.1879.0-x64.appx -OutFile $env:TEMP\MaestroStudio-Store-1.1879.0-x64.appx).StatusCode
(Get-FileHash $env:TEMP\MaestroStudio-Store-1.1879.0-x64.appx -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod https://cdn.martinstech.net/maestro/version.json
```

Expected: local and downloaded SHA-256 equal `ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71`; sidecar reports channel `store-static-download`; `version.json` has no AppX entry and remains a Squirrel-only manifest.

- [ ] **Step 4: Commit any final release documentation only**

```bash
git status --short
git add docs/RELEASE_RUNBOOK.md .agents/skills/publishing-maestro-windows-releases/SKILL.md
git commit -m "docs(release): record verified Store AppX publication"
```
