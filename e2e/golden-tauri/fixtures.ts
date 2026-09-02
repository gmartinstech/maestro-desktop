// e2e/golden-tauri/fixtures.ts
//
// TAU-6: mirrors e2e/golden/fixtures.ts's isolation + opaque-token seeding, but launches the
// Tauri (Windows/WebView2) shell instead of Electron and attaches over CDP rather than driving
// the process via Playwright's own `_electron` API (Tauri has no Playwright-native launcher).
//
// Path decision (see the plan's TAU-6 entry, docs/plans/2026-08-31-txm-tauri-typescript-migration.md):
// CDP DOES attach to WebView2 via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port,
// confirmed live against a real cargo-built binary -- so this stays on
// chromium.connectOverCDP() rather than falling back to tauri-driver/WebdriverIO. Record for
// MAC-5/MOB-5: MAC-5 cannot reuse this (WKWebView has no CDP at all, per the plan's D3 finding),
// so it needs the tauri-driver/WDIO path; MOB-5 drives a browser at a mobile viewport, not a
// native shell, so this decision doesn't apply there either.
import { chromium, Browser, Page } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

// Repo root is two levels up from this file (e2e/golden-tauri/), same anchor
// e2e/helpers/launch.ts's packagedAppPath() uses.
const REPO_ROOT = resolve(__dirname, '..', '..');

// Resolves the built Tauri binary. Override with E2E_TAURI_APP_PATH (mirrors E2E_APP_PATH for
// the Electron fixture, e2e/helpers/launch.ts). Phase TAU targets Windows only (per
// docs/plans/txm-status.md), so the only default candidate is the win32 debug build --
// `cargo build` / `cargo tauri dev` output at tauri/target/debug/app.exe (Cargo.toml's
// `[package] name = "app"`, not the branded "Maestro Studio" name -- that only applies to the
// bundled installer output, a separate ticket's concern).
function packagedAppPath(): string {
  if (process.env.E2E_TAURI_APP_PATH) return process.env.E2E_TAURI_APP_PATH;
  const candidate = join(REPO_ROOT, 'tauri', 'target', 'debug', 'app.exe');
  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch { /* fall through to the error below */ }
  throw new Error(`Tauri app not found at ${candidate}. Build it first (cd tauri && cargo build) or set E2E_TAURI_APP_PATH.`);
}

// Same static opaque credential e2e/golden/fixtures.ts seeds -- see that file's header comment
// for why this authenticates the boot without driving any UI and without opening a real browser.
function seedOpaqueMaestroToken(dataRoot: string): void {
  const settingsDir = join(dataRoot, 'settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ provedor_ia_token: 'mtok_e2e_fake_opaque_token' }, null, 2));
}

// A dev box can already have something else bound to the conventional 9222 (confirmed live: a
// stray Chrome process was squatting on it here, and WebView2 silently fell back to binding only
// its IPv6 loopback address, so 127.0.0.1:9222 connected to the WRONG process and returned a bare
// 404). Picking a free port ourselves -- same probe-then-release tradeoff as
// tauri/src/sidecar.rs's pick_backend_port() -- avoids the whole class of collision instead of
// hoping 9222 is free.
async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// tauri-plugin-single-instance (TAU-5) means a second launch of the same app identifier doesn't
// open a new window at all -- it forwards argv to the already-running instance and exits, so a
// leftover process from a previous (crashed or interrupted) run would silently swallow this run's
// launch and this fixture would hang waiting on a debug port that never opens. Best-effort clears
// any prior instance of THIS exact binary first; scoped by exact executable path (not a bare
// image-name kill) so it can't reach for an unrelated app.exe elsewhere on the machine.
function killAnyRunningInstance(exePath: string): void {
  try {
    // WQL string literals treat backslash as an escape character, same as the string itself --
    // an unescaped Windows path (join()'s native separator) breaks the filter with "invalid
    // query". Escape both backslash and single-quote, in that order.
    const escaped = exePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
    const raw = execFileSync(
      'pwsh',
      ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ExecutablePath='${escaped}'" | Select-Object -ExpandProperty ProcessId`],
      { encoding: 'utf8' },
    ).trim();
    for (const line of raw.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (Number.isFinite(pid) && pid > 0) {
        try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
      }
    }
  } catch {
    /* best effort: no matching process, or pwsh unavailable -- launch proceeds either way */
  }
}

// Same whole-tree kill sidecar.rs's own kill_tree() uses for the backend, applied here to the
// Tauri process itself: /T walks descendants (msedgewebview2.exe, the python.exe sidecar, the
// 9Router node process underneath that), so one taskkill reaps the whole tree in one shot --
// unlike the Electron fixture, there is no separate "outlives the app" reaping pass needed.
function killTree(pid: number): void {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
}

export interface LaunchedTauriApp {
  child: ChildProcess;
  browser: Browser;
  win: Page;
  cdpPort: number;
  dataRoot: string;
  stateHome: string;
  close: () => Promise<void>;
}

// Mirrors backend/main.py's CORSMiddleware allow_origin_regex EXACTLY (that file is out of scope
// for this ticket -- read/boot only, see CLAUDE.md's GLOBAL CONSTRAINTS) -- an origin outside
// this set can never reach the backend from inside the webview, no matter how long this fixture
// waits. WebView2's production origin on Windows is `http://tauri.localhost` (Tauri's documented
// default for this platform); backend/main.py's CORS allow_origin_regex was fixed to include it
// (previously did not, which blocked every /api/* fetch from inside the real app -- see git
// history / docs/plans/txm-status.md's TAU-6 note for the writeup of that bug). This regex mirrors
// the backend's allowlist as a fixture-side fail-fast check; keep the two in sync.
const BACKEND_ALLOWED_ORIGIN = /^(file:.*|http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+|http:\/\/tauri\.localhost)$/;

export async function launchMaestroTauri(): Promise<LaunchedTauriApp> {
  const exePath = packagedAppPath();
  killAnyRunningInstance(exePath);

  // Same three isolated roots e2e/golden/fixtures.ts redirects, plus a fourth: WebView2's own
  // user-data folder (its equivalent of Electron's --user-data-dir), so this run never touches a
  // developer's real WebView2 profile either.
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-tauri-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-e2e-tauri-home-'));
  const webviewData = mkdtempSync(join(tmpdir(), 'maestro-e2e-tauri-webview-'));
  seedOpaqueMaestroToken(dataRoot);

  const cdpPort = await pickFreePort();

  // sidecar.rs's Command doesn't call .env_clear(), so MAESTRO_DATA_ROOT/MAESTRO_STATE_HOME set
  // here reach the backend sidecar it spawns unchanged -- see that file's backend_env() doc
  // comment. MAESTRO_MOCK_AGENT/MAESTRO_DISABLE_PREFLIGHT mean the same thing here they do for the
  // Electron golden smoke (see CLAUDE.md): this is the packaged/e2e path, never the backend suite.
  const child = spawn(exePath, [], {
    env: {
      ...process.env,
      MAESTRO_MOCK_AGENT: '1',
      MAESTRO_DISABLE_PREFLIGHT: '1',
      MAESTRO_DATA_ROOT: dataRoot,
      MAESTRO_STATE_HOME: stateHome,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Rolling tail of the app's own log (tauri-plugin-log + this build's `[app_lib::sidecar]`
  // backend-forwarding, see tauri/src/sidecar.rs's pipe_to_log) -- surfaced on failure so a
  // timeout reads as "here's what the app was doing", not just Playwright's generic
  // "Target ... closed".
  const logLines: string[] = [];
  const captureLog = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line) logLines.push(line);
    }
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
  };
  child.stdout?.on('data', captureLog);
  child.stderr?.on('data', captureLog);
  let exitInfo: string | null = null;
  child.once('exit', (code, signal) => { exitInfo = `code=${code} signal=${signal}`; });
  const logTail = () => logLines.slice(-40).join('\n');

  const closeAll = async (browser?: Browser) => {
    try { await browser?.close(); } catch { /* already disconnected */ }
    if (typeof child.pid === 'number') killTree(child.pid);
  };

  // WebView2 doesn't open its debug port the instant the process starts (backend spawn + splash
  // creation happen first) -- poll rather than assume it's up immediately.
  const connectDeadline = Date.now() + 60_000;
  let browser: Browser | null = null;
  let lastErr: unknown = null;
  while (Date.now() < connectDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`Tauri process exited (${exitInfo}) before a CDP connection was made:\n${logTail()}`);
    }
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) {
    await closeAll();
    throw new Error(`never attached over CDP on port ${cdpPort}: ${String(lastErr)}\n${logTail()}`);
  }

  // TAU-5's splash window is ALSO titled "Maestro Studio" and (like Electron's own splash, see
  // e2e/golden/fixtures.ts's mainWindow() comment) its content is indistinguishable from the real
  // app by title alone -- discriminate by URL instead. Splash is a self-contained `data:` URL
  // (tauri/src/splash.rs); the real page starts at `about:blank` and navigates to
  // `http://tauri.localhost/...` once Tauri's custom-protocol asset host resolves. Matching on
  // "neither blank nor data:" rather than a literal `tauri.localhost` string is still the more
  // robust choice -- it degrades gracefully if a future ticket changes the asset-serving strategy
  // (see BACKEND_ALLOWED_ORIGIN's doc comment on the CORS gap this origin currently hits).
  const pageDeadline = Date.now() + 60_000;
  let win: Page | null = null;
  while (Date.now() < pageDeadline && !win) {
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        const url = page.url();
        if (url && url !== 'about:blank' && !url.startsWith('data:')) {
          win = page;
          break;
        }
      }
      if (win) break;
    }
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) {
    await closeAll(browser);
    throw new Error(`main window never navigated past about:blank/splash within 60s\n${logTail()}`);
  }

  // See BACKEND_ALLOWED_ORIGIN's doc comment: an origin outside the backend's CORS allow-list
  // means every subsequent /api/* call is doomed. Fail fast and legibly here rather than let the
  // caller discover it 120s later as an opaque "#root never mounted" or "Failed to fetch" --
  // #root mounts FINE either way (the frontend renders an empty state instead of blocking on the
  // API), so neither of those later waits would catch this on their own.
  const origin = new URL(win.url()).origin;
  if (!BACKEND_ALLOWED_ORIGIN.test(origin)) {
    await closeAll(browser);
    throw new Error(`webview origin '${origin}' is outside backend/main.py's CORS allow-list; every /api/* fetch would fail`);
  }

  // Same signal e2e/golden/fixtures.ts waits on: #root has children once React has actually
  // mounted, not just once the shell HTML arrived.
  try {
    await win.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, undefined, { timeout: 120_000 });
  } catch (err) {
    await closeAll(browser);
    throw new Error(`#root never mounted (exit ${exitInfo}): ${String(err)}\n${logTail()}`);
  }

  return {
    child,
    browser,
    win,
    cdpPort,
    dataRoot,
    stateHome,
    close: () => closeAll(browser!),
  };
}
