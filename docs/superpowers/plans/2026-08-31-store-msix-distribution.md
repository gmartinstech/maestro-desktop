# Store MSIX Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Azure-free Microsoft Store AppX/MSIX submission build and Store-managed update behavior while retaining an Azure-signed-only CDN/Squirrel release channel.

**Architecture:** A small Node helper is the single source of truth for Windows release mode validation and electron-builder AppX overrides; PowerShell consumes its JSON output, so mode behavior has fast unit tests instead of untestable duplicated flag logic. A second pure Electron helper classifies Windows installs as Store or CDN. `main.js` uses that classification to prevent every CDN updater path for Store packages, exposes Store-managed state through IPC, and the renderer displays a Store action rather than download/install controls.

**Tech Stack:** PowerShell 7, Node `node:test`, Electron 42, electron-builder AppX target, React 18, TypeScript, Redux Toolkit, i18next, Playwright.

---

## Planned file structure

| File | Responsibility |
| --- | --- |
| `scripts/windowsBuildMode.js` | Pure mode/identity validation and electron-builder override construction shared by the PowerShell release command and Node tests. |
| `scripts/windowsBuildMode.test.js` | Unit tests for Store flag incompatibility, required identity inputs, no-Azure Store mode, and Azure-required CDN publishing. |
| `scripts/build-app-win.ps1` | Parse `-Store`, obtain the validated mode object, stamp channel provenance, select AppX or Squirrel target, print a Store handoff, and preserve CDN fail-closed behavior. |
| `.env.windows.example` | Non-secret Partner Center identity placeholders, distinct from Azure variables. |
| `electron/storeChannel.js` | Pure classification of Store/CDN/native update authority and Store-managed status. |
| `electron/storeChannel.test.js` | Unit tests proving only a positively Store-packaged Windows app uses the Store channel. |
| `electron/main.js` | Route update setup and every update IPC handler by update channel; never fetch/download/spawn CDN installers for Store packages. |
| `electron/preload.js` | Expose the narrow `openStoreUpdates` IPC method. |
| `frontend/src/types/electron.d.ts` | Type Store-managed status and the new preload API. |
| `frontend/src/shared/state/updateSlice.ts` | Represent `store-managed` state. |
| `frontend/src/shared/state/updateSlice.test.ts` | Assert Store-managed reducer state without affecting CDN states. |
| `frontend/src/app/Main.tsx` | Hydrate Store-managed cached status from Electron. |
| `frontend/src/app/pages/Settings/sections/general/SoftwareUpdateRow.tsx` | Render Store-managed explanatory copy and an Open Microsoft Store action in place of download/install actions. |
| `frontend/src/shared/i18n/en.json` / `frontend/src/shared/i18n/pt-BR.json` | Matching Store-managed update copy. |
| `docs/RELEASE_RUNBOOK.md` | Partner Center handoff, Store build steps, and explicit signed-CDN boundary. |

## Task 1: Make Windows release modes explicit and testable

**Files:**
- Create: `scripts/windowsBuildMode.js`
- Create: `scripts/windowsBuildMode.test.js`
- Modify: `scripts/build-app-win.ps1:19-50, 97-143, 630-713`
- Modify: `.env.windows.example:1-21`

- [ ] **Step 1: Write failing build-mode unit tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { AZURE_SIGNING_ENV, STORE_IDENTITY_ENV, resolveWindowsBuildMode } = require('./windowsBuildMode');

const storeEnv = Object.fromEntries(STORE_IDENTITY_ENV.map((name) => [name, `value-for-${name}`]));

test('Store mode uses AppX and never requires Azure signing', () => {
  const mode = resolveWindowsBuildMode({ store: true }, storeEnv);
  assert.equal(mode.channel, 'store');
  assert.equal(mode.requiresAzureSigning, false);
  assert.deepEqual(mode.targetArgs.slice(0, 2), ['--config.win.target=appx', '--config.appx.identityName=value-for-MAESTRO_STORE_IDENTITY_NAME']);
});

test('Store mode reports every missing Partner Center identity value', () => {
  assert.throws(() => resolveWindowsBuildMode({ store: true }, {}), /MAESTRO_STORE_IDENTITY_NAME.*MAESTRO_STORE_PUBLISHER.*MAESTRO_STORE_PUBLISHER_DISPLAY_NAME/s);
});

test('Store mode rejects every incompatible release flag', () => {
  for (const flag of ['publish', 'sign', 'devSign', 'dirOnly', 'squirrel']) {
    assert.throws(() => resolveWindowsBuildMode({ store: true, [flag]: true }, storeEnv), new RegExp(`-Store cannot be combined with -${flag === 'devSign' ? 'DevSign' : flag[0].toUpperCase() + flag.slice(1)}`));
  }
});

test('CDN publish remains Azure-gated', () => {
  const mode = resolveWindowsBuildMode({ publish: true }, {});
  assert.equal(mode.channel, 'stable');
  assert.equal(mode.requiresAzureSigning, true);
  assert.deepEqual(mode.missingAzureEnv, AZURE_SIGNING_ENV);
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node --test scripts/windowsBuildMode.test.js`
Expected: FAIL with `Cannot find module './windowsBuildMode'`.

- [ ] **Step 3: Implement the pure release-mode resolver**

Create `scripts/windowsBuildMode.js` with the following interface. The helper must never read files, execute a build, or upload an artifact.

```js
const AZURE_SIGNING_ENV = [
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
  'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_CERT_PROFILE',
];
const STORE_IDENTITY_ENV = [
  'MAESTRO_STORE_IDENTITY_NAME',
  'MAESTRO_STORE_PUBLISHER',
  'MAESTRO_STORE_PUBLISHER_DISPLAY_NAME',
];

function resolveWindowsBuildMode(flags, env = process.env) {
  const normalized = { publish: false, sign: false, devSign: false, store: false, dirOnly: false, squirrel: false, ...flags };
  if (normalized.store) {
    const conflicts = [['publish', 'Publish'], ['sign', 'Sign'], ['devSign', 'DevSign'], ['dirOnly', 'DirOnly'], ['squirrel', 'Squirrel']]
      .filter(([key]) => normalized[key]).map(([, label]) => `-${label}`);
    if (conflicts.length) throw new Error(`-Store cannot be combined with ${conflicts.join(', ')}`);
    const missingStoreEnv = STORE_IDENTITY_ENV.filter((name) => !String(env[name] || '').trim());
    if (missingStoreEnv.length) throw new Error(`-Store requires Partner Center identity values: ${missingStoreEnv.join(', ')}`);
    return {
      channel: 'store', requiresAzureSigning: false, missingAzureEnv: [],
      targetArgs: [
        '--config.win.target=appx',
        `--config.appx.identityName=${env.MAESTRO_STORE_IDENTITY_NAME}`,
        `--config.appx.publisher=${env.MAESTRO_STORE_PUBLISHER}`,
        `--config.appx.publisherDisplayName=${env.MAESTRO_STORE_PUBLISHER_DISPLAY_NAME}`,
        '--config.appx.artifactName=MaestroStudio-Store-${version}-${arch}.${ext}',
      ],
    };
  }
  const requiresAzureSigning = normalized.publish || normalized.sign;
  return {
    channel: 'stable', requiresAzureSigning,
    missingAzureEnv: requiresAzureSigning ? AZURE_SIGNING_ENV.filter((name) => !String(env[name] || '').trim()) : [],
    targetArgs: normalized.squirrel ? ['--config.win.target=squirrel', '--config.squirrelWindows.iconUrl=https://raw.githubusercontent.com/gmartinstech/maestro-desktop/main/electron/build/icon.ico'] : [],
  };
}

module.exports = { AZURE_SIGNING_ENV, STORE_IDENTITY_ENV, resolveWindowsBuildMode };
```

- [ ] **Step 4: Run the mode tests**

Run: `node --test scripts/windowsBuildMode.test.js`
Expected: four passing tests.

- [ ] **Step 5: Make PowerShell consume the tested resolver**

In `scripts/build-app-win.ps1`:

1. Add `[switch]$Store` to the `param` block.
2. After `.env.windows` loading, invoke `node scripts\windowsBuildMode.js` through a small CLI wrapper added to the same file:

```js
if (require.main === module) {
  const flags = Object.fromEntries(process.argv.slice(2).map((arg) => [arg.slice(2), true]));
  try { process.stdout.write(JSON.stringify(resolveWindowsBuildMode(flags))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
```

3. In PowerShell, pass only active switches (`--store`, `--publish`, `--sign`, `--devSign`, `--dirOnly`, `--squirrel`), require a zero exit code, and deserialize JSON with `ConvertFrom-Json`.
4. Replace `$Publish` forcing `$Sign` and the hand-written Azure required-env list with the resolver's `requiresAzureSigning` and `missingAzureEnv`. If the returned missing list is non-empty, print each name and exit before staging or packaging.
5. Set `$TargetOverride` from `mode.targetArgs`, `$BuildChannel` from `mode.channel`, and keep `CSC_IDENTITY_AUTO_DISCOVERY=false` for Store/local builds. Only Azure-required modes set `VMP_REQUIRE_SIGN=1`.
6. Keep the current `if ($Publish) { scp ... }` block unchanged. Add an `elseif ($Store)` block that finds exactly `MaestroStudio-Store-$BuildVersion-x64.appx`, calculates SHA-256, and prints `Partner Center upload:`, `Version:`, `SHA-256:`, and `Provenance SHA:`. It must not invoke `scp`, alter `version.json`, or upload anything.

- [ ] **Step 6: Document Store identity inputs without secrets**

Add these comments and blank variables to `.env.windows.example` after the Azure section:

```dotenv
# Microsoft Store AppX submission identity — non-secret values from Partner Center.
# Required only by: pwsh scripts/build-app-win.ps1 -Store
MAESTRO_STORE_IDENTITY_NAME=
MAESTRO_STORE_PUBLISHER=
MAESTRO_STORE_PUBLISHER_DISPLAY_NAME=
```

Remove the stale GitHub Releases `GH_TOKEN` comment and variable because the release script already states it is unused.

- [ ] **Step 7: Run build-mode regression tests and script syntax validation**

Run:

```powershell
node --test scripts/windowsBuildMode.test.js
pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content scripts/build-app-win.ps1 -Raw)); 'PowerShell parse OK'"
pwsh scripts/build-app-win.ps1 -Store -Publish
```

Expected: Node tests pass; parser prints `PowerShell parse OK`; final command exits before build with `-Store cannot be combined with -Publish`.

- [ ] **Step 8: Commit the release-mode boundary**

```bash
git add scripts/windowsBuildMode.js scripts/windowsBuildMode.test.js scripts/build-app-win.ps1 .env.windows.example
git commit -m "feat(release): add Azure-free Store AppX build mode"
```

## Task 2: Classify Store packages before any Windows CDN updater path

**Files:**
- Create: `electron/storeChannel.js`
- Create: `electron/storeChannel.test.js`
- Modify: `electron/main.js:41-55, 1642-1778, 3073-3179`

- [ ] **Step 1: Write failing Store-channel unit tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUpdateChannel, storeManagedStatus } = require('./storeChannel');

test('only a positively Store-packaged Windows app selects Store updates', () => {
  assert.equal(resolveUpdateChannel({ platform: 'win32', windowsStore: true }), 'store');
  assert.equal(resolveUpdateChannel({ platform: 'win32', windowsStore: false }), 'cdn');
  assert.equal(resolveUpdateChannel({ platform: 'linux', windowsStore: true }), 'native');
});

test('Store status explains that Microsoft Store owns updates', () => {
  assert.deepEqual(storeManagedStatus(), { status: 'store-managed', info: { source: 'microsoft-store' }, error: null });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `cd electron && node --test storeChannel.test.js`
Expected: FAIL with `Cannot find module './storeChannel'`.

- [ ] **Step 3: Implement the isolated channel helper**

```js
function resolveUpdateChannel({ platform = process.platform, windowsStore = process.windowsStore === true } = {}) {
  if (platform !== 'win32') return 'native';
  return windowsStore === true ? 'store' : 'cdn';
}

function storeManagedStatus() {
  return { status: 'store-managed', info: { source: 'microsoft-store' }, error: null };
}

module.exports = { resolveUpdateChannel, storeManagedStatus };
```

- [ ] **Step 4: Run the channel unit tests**

Run: `cd electron && node --test storeChannel.test.js`
Expected: two passing tests.

- [ ] **Step 5: Route main-process update behavior through the helper**

In `electron/main.js`:

1. Import `resolveUpdateChannel` and `storeManagedStatus` beside `cdnUpdater`.
2. Set `const windowsUpdateChannel = resolveUpdateChannel();` before updater initialization.
3. On Windows, only require Electron's `autoUpdater` when `windowsUpdateChannel === 'cdn'`. A Store package must leave `autoUpdater` unset.
4. At the start of `setupAutoUpdater()`, before its current `if (!autoUpdater) return` guard, if `windowsUpdateChannel === 'store'`, set `cachedUpdateStatus = storeManagedStatus()`, log `[updater] managed by Microsoft Store`, and return before calling `checkCdnForUpdate`, scheduling the four-hour interval, or scheduling idle installation.
5. In `check-for-updates`, return `{ success: true, channel: 'store', managed: true }` for Store before the `!autoUpdater` guard. Do not emit a CDN update event and do not fetch the manifest.
6. In `download-update` and `install-update`, return `{ success: false, channel: 'store', error: 'Updates are managed by Microsoft Store.' }` before accessing `autoUpdater`, `cdnDownloadedInstallerPath`, or `spawn`.
7. Add `ipcMain.handle('open-store-updates', async () => { ... })`. It must return `{ success: false, error: 'Microsoft Store is unavailable for this install.' }` outside Store packages. For Store packages it must call `shell.openExternal('ms-windows-store://home')` and return `{ success: true }`; failures return `{ success: false, error: err.message || String(err) }`.

- [ ] **Step 6: Run Electron unit tests**

Run: `cd electron && node --test storeChannel.test.js cdnUpdater.test.js backendPaths.test.js`
Expected: all named test files pass; CDN manifest behavior remains covered by `cdnUpdater.test.js`.

- [ ] **Step 7: Commit Store/CDN runtime separation**

```bash
git add electron/storeChannel.js electron/storeChannel.test.js electron/main.js
git commit -m "feat(updater): route Store packages away from CDN"
```

## Task 3: Surface Store-managed updates in the renderer

**Files:**
- Modify: `electron/preload.js:76-109`
- Modify: `frontend/src/types/electron.d.ts:24-55`
- Modify: `frontend/src/shared/state/updateSlice.ts:3-85`
- Create: `frontend/src/shared/state/updateSlice.test.ts`
- Modify: `frontend/src/app/Main.tsx:16-23, 439-466`
- Modify: `frontend/src/app/pages/Settings/sections/general/SoftwareUpdateRow.tsx:16-135`
- Modify: `frontend/src/shared/i18n/en.json:269-283`
- Modify: `frontend/src/shared/i18n/pt-BR.json:556-570`

- [ ] **Step 1: Write the failing reducer test**

```ts
import { describe, expect, it } from 'vitest';
import reducer, { setStoreManaged } from './updateSlice';

describe('updateSlice Store status', () => {
  it('marks Store as the update authority without an installable version', () => {
    const state = reducer(undefined, setStoreManaged());
    expect(state.status).toBe('store-managed');
    expect(state.availableVersion).toBeNull();
    expect(state.installing).toBe(false);
  });
});
```

- [ ] **Step 2: Run the reducer test and confirm it fails**

Run: `cd frontend && npx vitest run src/shared/state/updateSlice.test.ts`
Expected: FAIL because `setStoreManaged` does not exist.

- [ ] **Step 3: Extend the typed Electron bridge and Redux state**

1. Add `store-managed` to `UpdateStatus` and a `setStoreManaged` reducer that sets the status, clears `availableVersion`, clears errors, and sets `installing` false.
2. Expose `openStoreUpdates: () => ipcRenderer.invoke('open-store-updates')` in `electron/preload.js`.
3. Add this to `MaestroAPI`:

```ts
openStoreUpdates: () => Promise<{ success: boolean; error?: string }>;
```

4. Declare a `MaestroCachedUpdateStatus` union in `frontend/src/types/electron.d.ts` (`'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'store-managed'`) and use it in `getUpdateStatus` with `info: { source?: 'microsoft-store'; version?: string; percent?: number } | null` rather than `any`.

- [ ] **Step 4: Hydrate and render Store-managed state**

1. In `frontend/src/app/Main.tsx`, import `setStoreManaged` and dispatch it when `getUpdateStatus()` returns `status === 'store-managed'`.
2. In `SoftwareUpdateRow.tsx`, add `handleOpenMicrosoftStore`, which calls `window.maestro.openStoreUpdates()` and dispatches `setUpdateError(result.error)` only if `success` is false.
3. When `updateStatus === 'store-managed'`, render `t('settings.general.softwareUpdate.storeManaged')`, a normal outlined button labeled `storeButton`, and no download/install/restart control. Do not dispatch `setChecking` for that button.
4. Add locale-parity keys:

```json
// en.json
"storeManaged": "Updates are managed by Microsoft Store.",
"storeButton": "Open Microsoft Store"

// pt-BR.json
"storeManaged": "As atualizações são gerenciadas pela Microsoft Store.",
"storeButton": "Abrir Microsoft Store"
```

- [ ] **Step 5: Run renderer tests, typecheck, and locale parity**

Run:

```bash
cd frontend && npx vitest run src/shared/state/updateSlice.test.ts
cd frontend && npx tsc --noEmit
node scripts/check-i18n-parity.mjs
```

Expected: reducer test passes, TypeScript reports no errors, and i18n parity reports equal key counts.

- [ ] **Step 6: Commit the Store update UI**

```bash
git add electron/preload.js frontend/src/types/electron.d.ts frontend/src/shared/state/updateSlice.ts frontend/src/shared/state/updateSlice.test.ts frontend/src/app/Main.tsx frontend/src/app/pages/Settings/sections/general/SoftwareUpdateRow.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(updater): show Store-managed update state"
```

## Task 4: Prove artifact boundaries and document release handoff

**Files:**
- Modify: `docs/RELEASE_RUNBOOK.md:1-155`
- Modify: `docs/superpowers/specs/2026-08-31-store-msix-distribution-design.md` only if implementation reveals a verified configuration correction
- Modify: `scripts/windowsBuildMode.test.js` if a discovered build flag needs a regression case

- [ ] **Step 1: Add the failing artifact-name assertion**

Add this test to `scripts/windowsBuildMode.test.js`:

```js
test('Store artifact naming cannot be confused with CDN Squirrel naming', () => {
  const mode = resolveWindowsBuildMode({ store: true }, storeEnv);
  assert.ok(mode.targetArgs.includes('--config.appx.artifactName=MaestroStudio-Store-${version}-${arch}.${ext}'));
  assert.ok(!mode.targetArgs.some((arg) => arg.includes('squirrelWindows')));
});
```

- [ ] **Step 2: Run the assertion and confirm it passes with the resolver**

Run: `node --test scripts/windowsBuildMode.test.js`
Expected: five passing tests.

- [ ] **Step 3: Add concise Store instructions to the release runbook**

Add a `## Microsoft Store release (manual Partner Center handoff)` section before CDN release instructions with these explicit requirements:

```markdown
1. Reserve the Maestro Studio identity in Partner Center and copy its Identity name, Publisher, and Publisher display name into the ignored `.env.windows` file.
2. Run `pwsh scripts/build-app-win.ps1 -Store` on the exact `main` commit. It does not need Azure credentials and does not upload anything.
3. Record the emitted AppX path, version, SHA-256, and provenance SHA; upload that artifact manually in Partner Center.
4. After certification, install through Microsoft Store and confirm Settings → About reports the source SHA and `store` channel. Check Software update: it must say Microsoft Store manages updates and must not download a CDN installer.
5. The existing `-Publish` command is only for direct CDN/Squirrel delivery. It still requires Azure Trusted Signing; do not upload an unsigned or self-signed installer to cloudinha.
```

Also change the existing build table so `-Store` is listed separately from unsigned local, Azure-signed, and Azure-signed CDN publish modes.

- [ ] **Step 4: Execute safe automated validation**

Run:

```bash
node --test scripts/windowsBuildMode.test.js
cd electron && node --test storeChannel.test.js cdnUpdater.test.js backendPaths.test.js
cd frontend && npx vitest run src/shared/state/updateSlice.test.ts
cd frontend && npx tsc --noEmit
node scripts/check-i18n-parity.mjs
pwsh scripts/build-app-win.ps1 -Store -Publish
pwsh scripts/build-app-win.ps1 -Publish
```

Expected: all tests pass; the combined-mode command fails before staging with an incompatibility error; `-Publish` fails before staging with the missing Azure variable list when credentials are absent. Neither command uploads a CDN artifact.

- [ ] **Step 5: Perform manual Partner Center validation when identity values are available**

Run:

```powershell
pwsh scripts/build-app-win.ps1 -Store
Get-FileHash electron\dist\MaestroStudio-Store-*-x64.appx -Algorithm SHA256
```

Expected: an AppX artifact named with the computed version, `build-info.json` contains `"channel":"store"`, and the emitted SHA matches `Get-FileHash`. Upload that artifact in Partner Center, complete certification, then run the Store install checks documented in `docs/RELEASE_RUNBOOK.md`.

- [ ] **Step 6: Run the full repository gate after a Store artifact is available**

Run: `npm run verify`
Expected: `VERIFY GREEN`. If golden refuses a stale package, rebuild the packaged artifact first with `pwsh scripts/build-app-win.ps1` and rerun the gate; do not alter release mode to bypass the freshness check.

- [ ] **Step 7: Commit verification documentation**

```bash
git add docs/RELEASE_RUNBOOK.md docs/superpowers/specs/2026-08-31-store-msix-distribution-design.md scripts/windowsBuildMode.test.js
git commit -m "docs(release): document Store and CDN handoff"
```

## Coverage checklist

- Store AppX mode is Azure-free: Tasks 1 and 4.
- Store identity preflight and incompatible flags: Task 1.
- Version/provenance and Store artifact handoff: Tasks 1 and 4.
- Store-installed runtime never reaches CDN download/update logic: Task 2.
- Store-managed update UI and open-Store action: Task 3.
- CDN publishing still requires Azure and rejects unsigned/self-signed modes: Tasks 1 and 4.
- Partner Center upload, Store update, and CDN regression checks: Task 4.
