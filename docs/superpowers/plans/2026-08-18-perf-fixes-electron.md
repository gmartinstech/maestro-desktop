# Electron Startup Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two MEDIUM-impact Electron findings from the 2026-08-18 fluidity audit — sequential frontend-server-start/cache-clear and duplicated synchronous preload IPC round-trips — to shave time off the path to first paint.

**Architecture:** Both fixes are narrow, localized changes to `electron/main.js`/`electron/preload.js` with no architectural change to the (already well-designed, per the audit) startup sequence, process lifecycle, or IPC security model.

**Tech Stack:** Electron main process (Node.js), `electron/preload.js` (contextBridge), `electron/main.js`.

---

### Task 1: Parallelize frontend server startup with the stale-cache clear

**Files:**
- Modify: `electron/main.js:2078-2089`
- Test: manual verification (packaged-mode boot timing) — this path only runs when `!isDev`, so it cannot be exercised by the dev-mode workflow alone.

**Context:** `startFrontendServer()` (starts the embedded HTTP server that serves the packaged frontend) and `clearStaleFrontendCache()` (calls `session.defaultSession.clearCache()`, a Chromium session API unrelated to the frontend server) are two genuinely independent operations, both of which must complete before `createWindow()` loads the URL — the ordering constraint documented in the code (`clearStaleFrontendCache` "Must run before createWindow loads the URL, or the renderer fetches the stale bundle first") is about `createWindow()`, not about `startFrontendServer()`. They currently run sequentially for no reason.

- [ ] **Step 1: Re-read the exact current sequencing**

```
Read electron/main.js (lines 2060-2100)
```

Confirm the current shape matches:

```javascript
if (!isDev) {
  try {
    await startFrontendServer();
  } catch (err) {
    console.error('[boot] frontend server failed to start, falling back to file://:', err && err.message);
  }
}
emitSplashStatus(t('appShell.splash.almostReady'));
await clearStaleFrontendCache();
createWindow();
```

- [ ] **Step 2: Confirm `clearStaleFrontendCache()` has no dependency on `startFrontendServer()` having completed**

Read `clearStaleFrontendCache()`'s full body again to be certain (already confirmed above at `main.js:1578-1586`): it only calls `session.defaultSession.clearCache()`, a Chromium API with no relationship to whether the local HTTP server is listening. Also confirm `startFrontendServer()` doesn't depend on the cache being cleared first:

Run: `grep -n "async function startFrontendServer" electron/main.js`

```
Read electron/main.js (the function body found above, full length)
```

Confirm it doesn't call `clearCache()` or anything cache-related internally — if it does, STOP and do not parallelize (this would indicate a real dependency the audit missed); otherwise proceed.

- [ ] **Step 3: Replace the sequential calls with `Promise.all`, preserving the try/catch on `startFrontendServer`**

Replace lines 2078-2088:

```javascript
if (!isDev) {
  const frontendServerPromise = startFrontendServer().catch((err) => {
    console.error('[boot] frontend server failed to start, falling back to file://:', err && err.message);
  });
  emitSplashStatus(t('appShell.splash.almostReady'));
  await Promise.all([frontendServerPromise, clearStaleFrontendCache()]);
} else {
  emitSplashStatus(t('appShell.splash.almostReady'));
}
createWindow();
```

This preserves the exact original error-swallowing behavior for `startFrontendServer()` (its failure doesn't block boot, it just falls back to `file://` per the original comment) while running the cache clear concurrently instead of after. `clearStaleFrontendCache()` already early-returns in dev mode (`if (isDev) return;` at line 1579), but since the codebase's original structure gated the frontend-server-start block behind `!isDev` too, moving `emitSplashStatus` into both branches keeps the splash status update timing unchanged for dev mode.

- [ ] **Step 4: Verify `emitSplashStatus` call ordering is preserved for dev mode**

Re-read the surrounding dev-mode branch (`main.js:2062-2069`) to confirm dev mode already calls `emitSplashStatus(t('appShell.splash.connectingBackend'))` earlier in its own branch — the `almostReady` status after it in both branches should fire at the same relative point as before this change, just potentially a bit earlier in packaged mode since the two async calls now overlap.

- [ ] **Step 5: Lint/syntax check**

Run: `node --check electron/main.js`
Expected: no syntax errors.

If this project has an eslint config covering `electron/`:
Run: `npx eslint electron/main.js`
Expected: no new errors introduced by this change.

- [ ] **Step 6: Build a packaged version and time the boot**

Run: `npm run build:win` (or whatever this project's packaging script is — check `package.json` scripts first if this doesn't match)

Run: `grep -n "\"scripts\"" -A 30 package.json`

Use whichever packaging script produces a runnable local build without a full release (check for a `build:dir` or `pack` script that skips code-signing/publishing, since this is just for local timing verification, not a release).

- [ ] **Step 7: Manually launch the packaged app and confirm no regression**

Launch the built app and confirm:
1. The splash screen appears and progresses through its status messages normally.
2. The main window appears and loads the current frontend bundle (not a stale cached one) — check the app version/build marker if visible, or check DevTools Network tab shows a fresh (not `(from disk cache)`) response for the main bundle.
3. No new errors appear in the Electron main process console output (check via `openBackendLog()`'s log file or the terminal running the packaged app if launched from one).

- [ ] **Step 8: Commit**

```bash
git add electron/main.js
git commit -m "perf(electron): parallelize frontend server start with stale-cache clear

Both operations are independent and only need to complete before
createWindow() loads the URL; running them sequentially added their
combined duration to the pre-first-paint critical path for no reason."
```

---

### Task 2: Coalesce the two synchronous preload IPC calls into one

**Files:**
- Modify: `electron/preload.js:15-25` (read exact range first — see Step 1)
- Modify: `electron/main.js` (the `ipcMain.on('get-backend-port-sync', ...)` and `ipcMain.on('get-webview-preload-path-sync', ...)` handlers)
- Test: manual verification — preload IPC handlers can't easily be unit-tested in isolation in this codebase (no existing preload test harness found in the audit); verification is a running-app check.

**Context:** `preload.js:18-19` makes two separate blocking `ipcRenderer.sendSync` calls on every window/tab preload, before any paint. Both are deliberate (a comment explains they replace a worse async race), but two round-trips cost more than one. Coalescing them into a single handler returning both values removes one blocking round-trip per preload without changing the sync-at-preload-time guarantee both existing calls rely on.

- [ ] **Step 1: Read the exact current preload code and its comment**

```
Read electron/preload.js (lines 1-40)
```

Confirm the exact variable names (`port`, `webviewPreloadPath`) and how each is subsequently used later in the same file — both must still resolve to the same values after coalescing.

- [ ] **Step 2: Find the corresponding main-process handlers**

Run: `grep -n "get-backend-port-sync\|get-webview-preload-path-sync" electron/main.js`

```
Read electron/main.js (each handler's full body, using the line numbers from the grep above)
```

Note exactly what each handler computes/returns — one likely reads a module-level `backendPort` variable, the other likely resolves a path via `path.join(__dirname, ...)` or similar. Copy both computations verbatim into the new combined handler in Step 3 — do not paraphrase or "simplify" them, since any behavioral drift here would break every window's preload.

- [ ] **Step 3: Add a combined synchronous IPC handler in `main.js`**

Add a new handler near the two existing ones (keep them physically close in the file for readability, per the existing code organization), using the exact computations found in Step 2:

```javascript
ipcMain.on('get-preload-bootstrap-sync', (event) => {
  event.returnValue = {
    port: backendPort, // exact source expression copied from the get-backend-port-sync handler read in Step 2
    webviewPreloadPath: /* exact source expression copied from the get-webview-preload-path-sync handler read in Step 2 */,
  };
});
```

Replace the placeholder comments with the ACTUAL expressions found in Step 2 before considering this step done — this plan cannot know the exact variable/expression without that read.

- [ ] **Step 4: Update `preload.js` to make one call instead of two**

Replace `preload.js:18-19`:

```javascript
const port = ipcRenderer.sendSync('get-backend-port-sync');
const webviewPreloadPath = ipcRenderer.sendSync('get-webview-preload-path-sync');
```

with:

```javascript
const { port, webviewPreloadPath } = ipcRenderer.sendSync('get-preload-bootstrap-sync');
```

- [ ] **Step 5: Decide whether to remove the two old handlers or keep them as a fallback**

Check whether `get-backend-port-sync` or `get-webview-preload-path-sync` are called from anywhere else in the codebase besides `preload.js` (e.g. a devtools console, another preload script, a test):

Run: `grep -rn "get-backend-port-sync\|get-webview-preload-path-sync" electron/ frontend/`

If no other call sites exist, remove both old handlers from `main.js` entirely (dead code, per the root `CLAUDE.md`'s general preference against leaving unused code around) — DELETE their `ipcMain.on(...)` registrations. If other call sites exist, leave the old handlers in place unmodified and only add the new combined one, noting in a one-line comment why both exist:

```javascript
// get-preload-bootstrap-sync coalesces this and get-webview-preload-path-sync into one round-trip
// for preload.js; both individual handlers stay for <other call site found above>.
```

- [ ] **Step 6: Check for other preload scripts using the same two-call pattern**

The audit noted this pattern might exist in more than one preload script (e.g. a webview-specific preload). Search:

Run: `find electron -iname "*preload*"`

For each file found besides the main `preload.js` already fixed, check if it also calls `get-backend-port-sync`/`get-webview-preload-path-sync`:

Run: `grep -l "get-backend-port-sync\|get-webview-preload-path-sync" electron/*.js`

Apply the same Step 4 change to any additional file found.

- [ ] **Step 7: Lint/syntax check**

Run: `node --check electron/main.js && node --check electron/preload.js`
Expected: no syntax errors.

- [ ] **Step 8: Manually verify preload still resolves both values correctly**

Run the app in dev mode (or a local packaged build):

Run: `npm run dev` (or this project's documented dev command — check `package.json` if this doesn't match)

In the running app:
1. Open DevTools on the main window, check the console for any preload errors.
2. Confirm the app connects to the backend normally (the port value is correct) — e.g. confirm a dashboard loads sessions/data, which requires a working backend connection.
3. Open (or resume) a browser card / webview-based feature, confirming its preload path resolved correctly (no "preload script failed to load" errors in the main process log).
4. Test `recreateMainWindow()`'s crash-recovery path if there's a way to trigger it in dev (check for a debug menu item or IPC trigger) — otherwise, at minimum, reload the renderer (Ctrl+R) and confirm preload re-runs successfully.

- [ ] **Step 9: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "perf(electron): coalesce two synchronous preload IPC calls into one

get-backend-port-sync and get-webview-preload-path-sync each blocked the
renderer with a separate round-trip on every window/tab preload. Combined
into a single get-preload-bootstrap-sync call returning both values."
```

---

## Self-Review Notes

- **Spec coverage:** Both MEDIUM-impact Electron findings from the audit are covered (sequential startup calls, duplicated sync IPC). The LOW-impact findings (browser-capsule-take's third sync channel, unbuffered console-tee log writes, missing `backgroundThrottling: false` on the main window) are explicitly not included — the audit itself flagged the first as "architecturally-justified, not urging an immediate fix" and the latter two as informational/likely-nil-impact, so they don't warrant a fix task in this plan.
- **Placeholder scan:** Task 2 Step 3 contains one intentional placeholder comment that the plan explicitly calls out as "must be replaced before considering this step done" — this is flagged as a required action within the step, not a silent gap, because the exact source expression can only be known by reading the live file at execution time (which this plan instructs the executor to do in Step 2, immediately prior).
- **Type consistency:** `port` and `webviewPreloadPath` destructured names in Task 2 Step 4 match the original variable names read in Step 1, preserving every downstream usage in `preload.js` without further changes.
