// BRW-1: resolves and launches an external, CDP-controllable Chromium-based browser (Edge, then
// Chrome, then a lazily-downloaded Playwright Chromium as a last resort). Gated behind
// MAESTRO_BROWSER_ENGINE=cdp by whatever wires this in later (BRW-4/BRW-5) — this module itself
// has no consumers yet, so there is nothing here to gate. Originally standalone (no imports from
// elsewhere in engine/), so it worked even before the rest of the engine skeleton (ENG-1) landed;
// the one exception, added by ENG-7, is net/http.ts's engineFetch() below -- ENG-1 has since
// landed, and every outbound call in engine/src must route through the provider-egress
// allowlist, loopback CDP probes included (the allowlist always permits 127.0.0.1, so this is a
// mechanical swap with no behavior change).
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join as joinNative } from 'node:path';
import { engineFetch } from '../net/http';

export type BrowserSource = 'edge' | 'chrome' | 'playwright-chromium';

export interface ResolvedBrowser {
  executablePath: string;
  source: BrowserSource;
}

export interface LaunchedBrowser {
  cdpPort: number;
  source: BrowserSource;
  executablePath: string;
  pid: number | undefined;
  close: () => Promise<void>;
}

// Injected for unit testing: lets resolution-priority tests run with a fake filesystem/platform
// and a stubbed Playwright fallback, without touching a real disk or downloading anything.
export interface ResolveDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  existsSync: (path: string) => boolean;
  resolvePlaywrightChromium: () => Promise<string>;
}

// Deliberately forward-slash, not node:path's join() — join() emits backslashes on win32, which
// would make candidate paths depend on the host OS of whoever runs the unit tests rather than on
// the injected `platform`/`env`, and this repo's own convention (CLAUDE.md) is forward slashes for
// Windows paths in code regardless. Windows' filesystem APIs accept forward slashes fine.
function joinForwardSlash(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((p) => p.length > 0)
    .join('/');
}

// %ProgramFiles%/%ProgramFiles(x86)%/%LocalAppData% are the three places a Windows Edge/Chrome
// install can land (per-machine 64-bit, per-machine 32-bit-on-64-bit, or per-user). Non-Windows
// candidates are included too — the plan doc (BRW-1) targets macOS Chrome resolution as well, and
// keeping this cross-platform costs nothing since existsSync() just returns false for paths that
// don't apply on the current OS.
function edgeCandidates(deps: Pick<ResolveDeps, 'platform' | 'env'>): string[] {
  const { platform, env } = deps;
  if (platform === 'win32') {
    return [
      joinForwardSlash(env.PROGRAMFILES ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
      joinForwardSlash(env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      joinForwardSlash(env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe'),
    ];
  }
  if (platform === 'darwin') return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge'];
}

function chromeCandidates(deps: Pick<ResolveDeps, 'platform' | 'env'>): string[] {
  const { platform, env } = deps;
  if (platform === 'win32') {
    return [
      joinForwardSlash(env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      joinForwardSlash(env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      joinForwardSlash(env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    ];
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
}

// Priority order per BRW-1: system Edge, then system Chrome, then the Playwright Chromium
// fallback. Pure and side-effect-free apart from the injected existsSync/resolvePlaywrightChromium
// calls, so the priority logic itself is unit-testable without a real filesystem or a real
// download.
export async function resolveBrowserExecutable(deps: ResolveDeps): Promise<ResolvedBrowser> {
  const edgePath = edgeCandidates(deps).find(deps.existsSync);
  if (edgePath) return { executablePath: edgePath, source: 'edge' };

  const chromePath = chromeCandidates(deps).find(deps.existsSync);
  if (chromePath) return { executablePath: chromePath, source: 'chrome' };

  const chromiumPath = await deps.resolvePlaywrightChromium();
  return { executablePath: chromiumPath, source: 'playwright-chromium' };
}

// Deliberately reuses this repo's existing Playwright install (root node_modules/playwright-core,
// already downloaded for e2e/) instead of adding a second download mechanism — playwright-core is
// intentionally NOT listed in engine/package.json's dependencies; Node's module resolution walks
// up from engine/ to the repo root and finds it there. If it isn't downloaded on this machine yet
// (a fresh checkout with e2e deps never installed), this shells out to playwright-core's own
// `install chromium` CLI to fetch it lazily, on first use only — never bundled.
async function resolvePlaywrightChromiumDefault(): Promise<string> {
  const { chromium } = await import('playwright-core');
  const existing = chromium.executablePath();
  if (existsSync(existing)) return existing;

  const cliPath = require.resolve('playwright-core/cli.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`playwright-core install chromium exited with code ${code}`))));
  });

  const afterInstall = chromium.executablePath();
  if (!existsSync(afterInstall)) throw new Error(`Playwright Chromium install did not produce an executable at ${afterInstall}`);
  return afterInstall;
}

function defaultResolveDeps(): ResolveDeps {
  return {
    platform: process.platform,
    env: process.env,
    existsSync,
    resolvePlaywrightChromium: resolvePlaywrightChromiumDefault,
  };
}

// Port 0 asks the OS for any free ephemeral port; opening then immediately closing a listener is
// the standard Node trick to learn which one it picked without a race against another process.
async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

// Polls the CDP HTTP endpoint until it answers or the timeout elapses — the browser process
// exists as soon as spawn() returns, but remote-debugging's HTTP server takes a beat to come up.
async function waitForCdpReady(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await engineFetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`CDP port ${port} did not become ready in time: ${String(lastError)}`);
}

function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    if (process.platform === 'win32' && child.pid !== undefined) {
      // Chrome/Edge/Chromium fork helper processes; a plain kill() on Windows only signals the
      // immediate process and leaves the render/GPU helpers orphaned. taskkill /T kills the tree.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL');
    }
  });
}

export interface LaunchOptions {
  // Runs the browser headless (--headless=new, no real OS window). Additive and OFF by default --
  // every existing caller (BRW-6's interactive login explicitly wants a real, user-visible
  // window) keeps today's headed behavior unchanged. BRW-4's canvas/screencast consumer
  // (engine/src/browser/screencastServer.ts) is the one caller that wants this: that feature's
  // whole point is the user watches through a <canvas>, never the real window, and a real headed
  // window can go fully invisible to Page.startScreencast the instant it's occluded, minimized,
  // or the desktop session has no visible surface at all -- Chrome correctly stops producing
  // compositor frames for a hidden page (confirmed live, via document.visibilityState, during
  // BRW-4's own real-integration gate: screencast:started fired, Input.dispatchMouseEvent still
  // worked, but zero screencast frames arrived because the launched window was invisible to the
  // OS compositor). That failure mode is just as real on an end user's desktop (another window
  // covering it, the app minimized) as it was in the gate's environment, so headless is a genuine
  // correctness fix for this feature, not merely a workaround for one sandboxed test run.
  headless?: boolean;
}

// Launches a resolved browser as an isolated, controllable instance: its own temp --user-data-dir
// (never a real user's profile) and remote debugging on a dynamically chosen free port. Returns
// the port plus a close() that kills the whole process tree and removes the temp profile.
export async function launchBrowser(deps: ResolveDeps = defaultResolveDeps(), options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const resolved = await resolveBrowserExecutable(deps);
  const cdpPort = await pickFreePort();
  const userDataDir = await mkdtemp(joinNative(tmpdir(), 'maestro-cdp-browser-'));

  const child = spawn(
    resolved.executablePath,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-fre',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-popup-blocking',
      ...(options.headless ? ['--headless=new'] : []),
    ],
    { stdio: 'ignore', detached: false },
  );

  const spawnFailure = new Promise<never>((resolve, reject) => {
    child.once('error', reject);
  });

  try {
    await Promise.race([waitForCdpReady(cdpPort), spawnFailure]);
  } catch (err) {
    await killProcessTree(child);
    await rm(userDataDir, { recursive: true, force: true });
    throw err;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await killProcessTree(child);
    await rm(userDataDir, { recursive: true, force: true });
  };

  return { cdpPort, source: resolved.source, executablePath: resolved.executablePath, pid: child.pid, close };
}
