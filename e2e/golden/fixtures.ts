// e2e/golden/fixtures.ts — DEV-layout launch for the golden smoke.
//
// The tests/ suite drives the PACKAGED artifact (helpers/launch.ts); golden has
// no build to point at, so it brings up the real app in dev mode:
//   - frontend: webpack dev server on :3000 (started by playwright webServer)
//   - backend:  backend/.venv running `python -m backend.main` on :8324
//   - electron: launched with ELECTRON_DEV=1 so main.js loads localhost:3000 and
//               resolves python from backend/.venv (see electron/main.js getPythonPath).
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_PORT = Number(process.env.OPENSWARM_PORT || 8324);
const IS_WIN = process.platform === 'win32';
const ELECTRON_BIN = path.join(
  REPO_ROOT, 'electron', 'node_modules', 'electron', 'dist',
  IS_WIN ? 'electron.exe' : 'electron',
);
const VENV_PY = IS_WIN
  ? path.join(REPO_ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
  : path.join(REPO_ROOT, 'backend', '.venv', 'bin', 'python3');

function httpStatus(url: string, timeoutMs = 1500): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(url, (r) => { r.resume(); resolve(r.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(0); });
  });
}
async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await httpStatus(url)) return true;               // any HTTP response (401 = up + auth-gated)
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export interface Launched { app: ElectronApplication; win: Page; cleanup: () => Promise<void>; }

// Bring up the backend (reuse if already listening) and launch Electron in dev.
export async function launchMaestro(): Promise<Launched> {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'maestro-golden-'));
  let backend: ChildProcess | null = null;

  if (!(await httpStatus(`http://localhost:${BACKEND_PORT}/`))) {
    backend = spawn(VENV_PY, ['-m', 'backend.main', '--port', String(BACKEND_PORT)], {
      cwd: REPO_ROOT,
      env: { ...process.env, OPENSWARM_DISABLE_PREFLIGHT: '1', DATA_ROOT: dataRoot },
      stdio: 'ignore',
    });
  }
  if (!(await waitForHttp(`http://localhost:${BACKEND_PORT}/`, 90_000))) {
    throw new Error(`backend never came up on :${BACKEND_PORT} (is backend/.venv provisioned?)`);
  }

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    cwd: path.join(REPO_ROOT, 'electron'),
    args: ['.'],
    env: { ...process.env, ELECTRON_DEV: '1', OPENSWARM_DISABLE_PREFLIGHT: '1', OPENSWARM_PORT: String(BACKEND_PORT) },
    timeout: 120_000,
  });

  const win = await waitForMainWindow(app);

  const cleanup = async () => {
    try { await app.close(); } catch { /* ignore */ }
    if (backend?.pid) {
      try {
        if (IS_WIN) execFileSync('taskkill', ['/F', '/T', '/PID', String(backend.pid)], { stdio: 'ignore' });
        else process.kill(backend.pid);
      } catch { /* already gone */ }
    }
  };
  return { app, win, cleanup };
}

// Poll every window until one exposes the window.openswarm bridge AND has a
// mounted React root — the same "booted + backend-wired" signal helpers/launch.ts uses.
export async function waitForMainWindow(app: ElectronApplication, timeoutMs = 120_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        const ready = await w.evaluate(() => {
          const bridge = typeof (window as any).openswarm?.getBackendPort === 'function'
            || typeof (window as any).openswarm?.getBackendPortLive === 'function';
          const root = document.getElementById('root');
          return bridge && !!root && root.childElementCount > 0;
        });
        if (ready) return w;
      } catch { /* window navigating/recreated; keep polling */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('main window with mounted React root never appeared');
}
