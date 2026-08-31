# Deterministic Packaged E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal packaged Electron E2E tests self-contained, authenticated, locale-deterministic, and independently runnable without real credentials or a developer profile.

**Architecture:** Keep the packaged app as the system under test, but introduce a Playwright fixture that owns disposable backend/state/Chromium roots and a local authenticated API helper. Gate React mount on the preload token, then split the serial combinatorial journey into independent boot, dashboard, settings, toolbar, and resilience scenarios. Golden and real-provider paths remain separate.

**Tech Stack:** Electron, React/TypeScript, FastAPI, Playwright, Node filesystem/process APIs, npm.

---

## File map

| File | Responsibility |
|---|---|
| `electron/backendPaths.js` | Resolve `auth.token` and `backend.log` from `MAESTRO_DATA_ROOT` when it is set. |
| `electron/backendPaths.test.js` | Unit-test override and native-profile auth path resolution. |
| `electron/main.js` | Consume the shared backend-path resolver. |
| `frontend/src/index.tsx` | Do not mount React until the Electron token bridge has yielded a usable token; preserve browser-dev timeout behavior. |
| `frontend/src/shared/bootstrapAuth.test.ts` | Unit-test the token-gated bootstrap decision without mounting Electron. |
| `frontend/src/shared/bootstrapAuth.ts` | Small pure, testable helper that distinguishes packaged token readiness from browser-dev fallback. |
| `e2e/fixtures/packagedApp.ts` | Disposable launch roots, generic mock-only environment, authenticated API helper, per-test teardown, and root-aware crash/log helpers. |
| `e2e/fixtures/packagedApp.test.ts` | Node-level tests for seed isolation and PID-tree process ownership. |
| `e2e/tests/boot-auth.spec.ts` | Clean-package token, authorization, locale, and first-dashboard regression coverage. |
| `e2e/tests/dashboard.spec.ts` | Independent dashboard creation and switching coverage. |
| `e2e/tests/settings.spec.ts` | Independent settings modal, tabs, theme, and toggle coverage. |
| `e2e/tests/toolbar.spec.ts` | Independent mock-only dashboard toolbar coverage. |
| `e2e/tests/resilience.spec.ts` | Short repeated open/close flow with crash and console assertions. |
| `e2e/tests/combinatorial-flows.spec.ts` | Delete after its assertions have moved to the independent specs. |
| `e2e/helpers/visibility.ts` | Accept a caller-provided backend log path instead of reading the host profile. |
| `e2e/golden/fixtures.ts` and `e2e/tests/real-agent-roundtrip.spec.ts` | Continue using their specialized launch flows; only update call sites if the visibility API changes. |
| `e2e/playwright.config.ts` | Preserve one packaged process at a time; enable retained-on-failure artifacts for the independent specs. |

## Task 1: Reset the abandoned partial harness change

**Files:**
- Modify: `e2e/helpers/launch.ts`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `frontend/src/shared/i18n/i18n.ts`

- [ ] **Step 1: Confirm only the known abandoned files are modified**

Run:
```bash
cd .worktrees/integrate-open-prs
git status --short
```

Expected: only `e2e/helpers/launch.ts`, `electron/main.js`, `electron/preload.js`, and `frontend/src/shared/i18n/i18n.ts` are modified outside the committed design and plan.

- [ ] **Step 2: Restore the partial attempt before introducing the replacement fixture**

Run:
```bash
git restore e2e/helpers/launch.ts electron/main.js electron/preload.js frontend/src/shared/i18n/i18n.ts
git status --short
```

Expected: no source changes remain. Do not retain the partial locale switch, environment scrubbing, or generic `launchApp()` isolation; the fixture in Task 3 replaces them cohesively.

- [ ] **Step 3: Commit the clean handoff only if the restoration changes were previously staged**

Run:
```bash
git diff --exit-code
```

Expected: exit 0. No commit is needed when restoring uncommitted work.

## Task 2: Resolve the isolated backend token before mounting React

**Files:**
- Create: `electron/backendPaths.js`
- Create: `electron/backendPaths.test.js`
- Modify: `electron/main.js`
- Create: `frontend/src/shared/bootstrapAuth.ts`
- Create: `frontend/src/shared/bootstrapAuth.test.ts`
- Modify: `frontend/src/index.tsx`

- [ ] **Step 1: Write the failing Electron-path tests**

Create `electron/backendPaths.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { authTokenPath } = require('./backendPaths');

test('MAESTRO_DATA_ROOT owns packaged auth.token', () => {
  assert.equal(authTokenPath({ isPackaged: true, env: { MAESTRO_DATA_ROOT: 'C:/tmp/e2e-data' }, platform: 'win32', home: 'C:/Users/test' }), 'C:/tmp/e2e-data/auth.token');
});

test('packaged Windows without an override uses AppData', () => {
  assert.equal(authTokenPath({ isPackaged: true, env: { APPDATA: 'C:/Users/test/AppData/Roaming' }, platform: 'win32', home: 'C:/Users/test' }), 'C:/Users/test/AppData/Roaming/Maestro Studio/data/auth.token');
});
```

- [ ] **Step 2: Run the path test to verify it fails**

Run:
```bash
node --test electron/backendPaths.test.js
```

Expected: FAIL because `./backendPaths` does not exist.

- [ ] **Step 3: Add and consume the shared path resolver**

Create `electron/backendPaths.js`:
```js
const path = require('path');
function authTokenPath({ isPackaged, env, platform, home, dirname }) {
  const override = (env.MAESTRO_DATA_ROOT || '').trim();
  if (override) return path.join(path.resolve(override), 'auth.token');
  if (!isPackaged) return path.join(dirname, '..', 'backend', 'data', 'auth.token');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Maestro Studio', 'data', 'auth.token');
  if (platform === 'win32') return path.join(env.APPDATA || home, 'Maestro Studio', 'data', 'auth.token');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Maestro Studio', 'data', 'auth.token');
}
module.exports = { authTokenPath };
```

In `electron/main.js`, import it and make `getAuthTokenFilePath()` return:
```js
return authTokenPath({ isPackaged, env: process.env, platform: process.platform, home: os.homedir(), dirname: __dirname });
```

`getBackendLogPath()` then automatically follows the same override root.

- [ ] **Step 4: Run the path test**

Run:
```bash
node --test electron/backendPaths.test.js
```

Expected: 2 passed.

- [ ] **Step 5: Write the failing pure frontend helper tests**

Create `frontend/src/shared/bootstrapAuth.test.ts`:
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldMountAfterAuth } from './bootstrapAuth';

test('packaged Electron refuses to mount without its local bearer', () => {
  assert.equal(shouldMountAfterAuth({ packaged: true, token: '' }), false);
});

test('packaged Electron mounts after its local bearer arrives', () => {
  assert.equal(shouldMountAfterAuth({ packaged: true, token: 'local-test-token' }), true);
});

test('plain-browser development retains its unauthenticated fallback', () => {
  assert.equal(shouldMountAfterAuth({ packaged: false, token: '' }), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend
npx tsx --test src/shared/bootstrapAuth.test.ts
```

Expected: FAIL because `./bootstrapAuth` does not exist.

- [ ] **Step 3: Add the pure decision helper**

Create `frontend/src/shared/bootstrapAuth.ts`:
```ts
export function shouldMountAfterAuth({ packaged, token }: { packaged: boolean; token: string }): boolean {
  return !packaged || token.trim().length > 0;
}
```

- [ ] **Step 4: Gate `bootstrap()` on the decision**

In `frontend/src/index.tsx`, replace the bare timeout race with this flow:
```ts
import { shouldMountAfterAuth } from './shared/bootstrapAuth';

const token = await Promise.race([
  ensureAuthToken(),
  new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
]);
const packaged = typeof window !== 'undefined' && typeof (window as any).maestro?.getAuthToken === 'function';
if (!shouldMountAfterAuth({ packaged, token })) {
  throw new Error('Electron backend authorization token was not ready before React bootstrap');
}
```

Keep `createRoot(...).render(...)` immediately after this guard. Do not replace the token middleware or add an unauthenticated backend path.

- [ ] **Step 5: Verify unit test and typecheck**

Run:
```bash
cd frontend
npx tsx --test src/shared/bootstrapAuth.test.ts
npx tsc --noEmit
```

Expected: all three helper tests pass; TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add electron/backendPaths.js electron/backendPaths.test.js electron/main.js frontend/src/index.tsx frontend/src/shared/bootstrapAuth.ts frontend/src/shared/bootstrapAuth.test.ts
git commit -m "fix(boot): resolve isolated backend authorization"
```

## Task 3: Create the disposable packaged-app fixture

**Files:**
- Create: `e2e/fixtures/packagedApp.ts`
- Create: `e2e/fixtures/packagedApp.test.ts`
- Modify: `e2e/helpers/visibility.ts`
- Modify: `e2e/playwright.config.ts`

- [ ] **Step 1: Write the fixture utility tests**

Create `e2e/fixtures/packagedApp.test.ts` with tests for these exported helpers:
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { descendantPids, seededSettings } from './packagedApp';

test('generic settings seed contains no provider credential', () => {
  assert.deepEqual(seededSettings(), { user_id: 'e2e-fake-user', user_email: 'e2e@maestro.test', language: 'en' });
});

test('process ownership follows the Electron process tree', () => {
  const processes = [
    { pid: 10, parentPid: 1 },
    { pid: 11, parentPid: 10 },
    { pid: 12, parentPid: 11 },
    { pid: 20, parentPid: 1 },
  ];
  assert.deepEqual(descendantPids(10, processes), [10, 11, 12]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx tsx --test e2e/fixtures/packagedApp.test.ts
```

Expected: FAIL because `./packagedApp` does not exist.

- [ ] **Step 3: Implement the fixture with exact ownership boundaries**

Create `e2e/fixtures/packagedApp.ts` exporting:

```ts
export const seededSettings = () => ({ user_id: 'e2e-fake-user', user_email: 'e2e@maestro.test', language: 'en' });
export const isOwnedChild = (commandLine: string, dataRoot: string) => commandLine.includes(dataRoot);
```

Then define `test = base.extend<{ maestro: PackagedApp }>({...})`, where `PackagedApp` contains `app`, `page`, `dataRoot`, `stateHome`, `userData`, `api`, `backendLogPath`, `crashCount`, and `assertNoUnexpectedErrors`.

The fixture must:

```ts
const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-data-'));
const stateHome = mkdtempSync(join(tmpdir(), 'maestro-e2e-home-'));
const userData = mkdtempSync(join(tmpdir(), 'maestro-e2e-userdata-'));
writeFileSync(join(dataRoot, 'settings', 'settings.json'), JSON.stringify(seededSettings()));
```

Launch the packaged binary with only:

```ts
MAESTRO_E2E: '1',
MAESTRO_MOCK_AGENT: '1',
MAESTRO_DISABLE_PREFLIGHT: '1',
MAESTRO_DATA_ROOT: dataRoot,
MAESTRO_STATE_HOME: stateHome,
```

Do not forward provider credentials into the settings seed. After the page has mounted, call `window.maestro.getAuthToken()` from Playwright, require a nonempty result, and construct `api(method, path, body?)` with `Authorization: Bearer ${token}`. Require `GET /api/dashboards/list` to return 200 before yielding the fixture.

Capture `app.process().pid` at launch. In teardown, enumerate only descendants of that PID, close Electron, wait briefly for normal shutdown, then terminate surviving captured descendants by PID. This reaches the backend and its 9Router child even when their command lines do not include `dataRoot`; it must never kill by image name.

- [ ] **Step 4: Make visibility root-aware**

Change `startVisibility` to accept an additional `backendLogPath: string` argument. Replace all internal calls to its host-derived `backendLogPath()` with that argument. Delete the helper's host-profile path function.

- [ ] **Step 5: Enable failure artifacts without restoring serial coupling**

Add to `e2e/playwright.config.ts`:
```ts
use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
```

Keep `workers: 1` and `fullyParallel: false` because the packaged app retains a single-instance lock.

- [ ] **Step 6: Verify utility tests and existing typecheck**

Run:
```bash
npx tsx --test e2e/fixtures/packagedApp.test.ts
cd frontend && npx tsc --noEmit
```

Expected: fixture utility tests pass; frontend typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add e2e/fixtures/packagedApp.ts e2e/fixtures/packagedApp.test.ts e2e/helpers/visibility.ts e2e/playwright.config.ts
git commit -m "test(e2e): add deterministic packaged app fixture"
```

## Task 4: Cover clean boot, auth, locale, and dashboard selection

**Files:**
- Create: `e2e/tests/boot-auth.spec.ts`
- Modify: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Write the clean-package regression spec**

Create `e2e/tests/boot-auth.spec.ts` using `test` and `expect` from `../fixtures/packagedApp`:
```ts
test('clean packaged boot has a local bearer and no protected-request failure', async ({ maestro }) => {
  await expect(maestro.page.locator('#root')).toBeVisible();
  const list = await maestro.api('GET', '/api/dashboards/list');
  expect(list.status()).toBe(200);
  const created = await maestro.api('POST', '/api/dashboards/create', { name: 'E2E Dashboard' });
  expect(created.status()).toBe(200);
  const dashboard = await created.json();
  expect(dashboard.id).toMatch(/^[a-f0-9]+$/);
  await maestro.page.goto(`http://127.0.0.1:4173/index.html#/dashboard/${dashboard.id}`);
  await expect(maestro.page).not.toHaveURL(/dashboard\/undefined/);
  maestro.assertNoUnexpectedErrors();
});

test('clean packaged boot applies its explicit English test locale', async ({ maestro }) => {
  await expect(maestro.page.getByRole('heading', { name: 'Dashboards' })).toBeVisible();
});
```

- [ ] **Step 2: Build and run to verify the new regression fails before the fixture and boot gate are complete**

Run:
```bash
pwsh -NoProfile -File scripts/build-app-win.ps1 -DirOnly
npx playwright test e2e/tests/boot-auth.spec.ts --workers=1
```

Expected: FAIL before Tasks 2 and 3 are complete; the observed failure must be a missing token, 401, locale mismatch, or undefined dashboard ID—not a silent skip.

- [ ] **Step 3: Move the packaged home-mount assertion from `smoke.spec.ts` into the fixture-backed boot test**

Remove only the overlapping home/boot assertion from `e2e/tests/smoke.spec.ts`. Retain smoke-specific packaged binary assertions that do not duplicate `boot-auth.spec.ts`.

- [ ] **Step 4: Run the new spec after the fixture and boot gate work**

Run:
```bash
npx playwright test e2e/tests/boot-auth.spec.ts --workers=1
```

Expected: 2 passed, no 401 response recorded, no route containing `undefined`.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/boot-auth.spec.ts e2e/tests/smoke.spec.ts
git commit -m "test(e2e): cover clean packaged boot authorization"
```

## Task 5: Split the combinatorial dashboard and settings coverage

**Files:**
- Create: `e2e/tests/dashboard.spec.ts`
- Create: `e2e/tests/settings.spec.ts`
- Delete: `e2e/tests/combinatorial-flows.spec.ts`

- [ ] **Step 1: Write dashboard spec against fixture-created state**

Create `dashboard.spec.ts`. Its `beforeEach` must create `Dashboard One` using `maestro.api`, navigate directly to its returned ID, and assert the dashboard toolbar is visible. Test creation/switching using stable hooks:
```ts
await maestro.page.locator('[data-testid="dashboard-header-toggle"]').click();
await maestro.page.locator('[data-testid="dashboard-header-new-dashboard"]').click();
await expect.poll(() => maestro.page.url()).not.toBe(firstUrl);
await maestro.page.locator('[data-testid="dashboard-header-toggle"]').click();
await maestro.page.locator(`[data-dashboard-id="${firstId}"]`).click();
await expect(maestro.page).toHaveURL(firstUrl);
```

Add a second test that starts from the fixture's empty profile, visits `#/`, and asserts the dashboard-selection first-run path creates a valid non-undefined dashboard route.

- [ ] **Step 2: Run the dashboard spec before deleting the old journey**

Run:
```bash
npx playwright test e2e/tests/dashboard.spec.ts --workers=1
```

Expected: all dashboard cases pass independently.

- [ ] **Step 3: Write settings spec with semantic locators**

Create `settings.spec.ts`. Each test gets a fixture-created dashboard. Cover modal open/close, all six tabs (`General`, `Models`, `Skills`, `Tools`, `Commands`, `Usage`), theme save/revert, and one General switch flip/revert. Use role/name locators for translated controls because Task 4 pins English; retain data IDs only for the icon-only header settings and close controls.

- [ ] **Step 4: Run settings spec**

Run:
```bash
npx playwright test e2e/tests/settings.spec.ts --workers=1
```

Expected: all settings cases pass without ordering dependency.

- [ ] **Step 5: Delete the migrated monolith and prove no command references it**

Run:
```bash
rm e2e/tests/combinatorial-flows.spec.ts
rg -n "combinatorial-flows" package.json scripts .github e2e
```

Expected: no runnable command or workflow references the deleted spec. Update any discovered direct reference to run `boot-auth.spec.ts`, `dashboard.spec.ts`, and `settings.spec.ts` instead.

- [ ] **Step 6: Commit**

```bash
git add e2e/tests/dashboard.spec.ts e2e/tests/settings.spec.ts e2e/tests/combinatorial-flows.spec.ts package.json scripts .github
git commit -m "test(e2e): split dashboard and settings scenarios"
```

## Task 6: Add isolated toolbar and resilience scenarios

**Files:**
- Create: `e2e/tests/toolbar.spec.ts`
- Create: `e2e/tests/resilience.spec.ts`

- [ ] **Step 1: Write toolbar scenarios that need no provider**

In `toolbar.spec.ts`, create a dashboard through `maestro.api` in `beforeEach`. Assert Add Note, Add App, and History mount their observable surfaces. Use `MAESTRO_MOCK_AGENT=1` for New Agent composition; type text but do not send a live-provider request. Keep Browser/webview assertions under the existing `MAESTRO_E2E_HEAVY === '1'` gate.

- [ ] **Step 2: Run toolbar spec**

Run:
```bash
npx playwright test e2e/tests/toolbar.spec.ts --workers=1
```

Expected: normal toolbar cases pass offline; webview test reports an explicit skip unless the heavy flag is set.

- [ ] **Step 3: Write the short resilience scenario**

In `resilience.spec.ts`, repeat only three settings open/close cycles, then call `maestro.assertNoUnexpectedErrors()` and compare `maestro.crashCount()` to its fixture baseline. Do not depend on mutations from another test.

- [ ] **Step 4: Run resilience spec**

Run:
```bash
npx playwright test e2e/tests/resilience.spec.ts --workers=1
```

Expected: passed with no unexpected console errors, 401s, or renderer crashes.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/toolbar.spec.ts e2e/tests/resilience.spec.ts
git commit -m "test(e2e): isolate toolbar and resilience coverage"
```

## Task 7: Preserve specialized paths and verify the release gate

**Files:**
- Modify only as required by TypeScript call sites: `e2e/golden/fixtures.ts`, `e2e/tests/real-agent-roundtrip.spec.ts`, `e2e/tests/deep-coverage.spec.ts`, `e2e/tests/multi-window-stress.spec.ts`, `e2e/tests/settings-pairwise.spec.ts`

- [ ] **Step 1: Update every `startVisibility` caller to pass its own log path**

For isolated callers, derive the log path as `join(dataRoot, 'backend.log')` only if main process writes it there; otherwise expose the actual resolved log path from the fixture and pass it unchanged. For legacy specialized callers not yet root-isolated, preserve their current profile path explicitly. Do not silently point any test at another run's log.

- [ ] **Step 2: Run specialized E2E checks**

Run:
```bash
npx playwright test e2e/golden/golden-path.spec.ts --workers=1
npx playwright test e2e/tests/smoke.spec.ts e2e/tests/deep-coverage.spec.ts --workers=1
```

Expected: golden passes with `MAESTRO_MOCK_AGENT=1`; normal smoke/deep coverage pass without a provider key. Run `real-agent-roundtrip.spec.ts` only with its explicit provider-key and seed gate.

- [ ] **Step 3: Verify a completed E2E run does not block a new package build**

Run:
```bash
pwsh -NoProfile -File scripts/build-app-win.ps1 -DirOnly
npx playwright test e2e/tests/boot-auth.spec.ts --workers=1
pwsh -NoProfile -File scripts/build-app-win.ps1 -DirOnly
```

Expected: both builds succeed. If a child remains, add its exact data-root ownership signal to fixture teardown and repeat; never use image-name-wide termination.

- [ ] **Step 4: Run final verification**

Run:
```bash
npm run verify
```

Expected: green under the project’s stated verify policy.

- [ ] **Step 5: Commit**

```bash
git add e2e/golden/fixtures.ts e2e/tests/real-agent-roundtrip.spec.ts e2e/tests/deep-coverage.spec.ts e2e/tests/multi-window-stress.spec.ts e2e/tests/settings-pairwise.spec.ts
git commit -m "test(e2e): keep specialized runs root-aware"
```
