// engine/src/pythonBackend.ts -- spawns backend/main.py's FastAPI app under uvicorn as an
// internal, loopback-only child process for server.ts to proxy 'proxy'-mode routes to.
//
// Mirrors the exact boot pattern e2e/contract/fixtures.ts and scripts/run-contract-tests.mjs use
// for the same binary (see those files' headers): same venv path resolution, same
// /api/health/check readiness probe, same Windows taskkill-tree teardown. Deliberately does NOT
// set MAESTRO_DATA_ROOT / MAESTRO_STATE_HOME / MAESTRO_MOCK_AGENT itself -- this spawn spreads
// `...process.env` and lets those (and everything else) flow through unchanged from whatever
// launched the engine, the same choice tauri/src/sidecar.rs documents for its own backend spawn
// (it doesn't `.env_clear()` either; see docs/plans/txm-status.md's TAU-3 note).

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { engineFetch } from './net/http';

// engine/src -> engine -> repo root, same two-levels-up anchor e2e/contract/fixtures.ts uses from
// e2e/contract -> e2e -> repo root. Holds whether this runs from src/ (via tsx) or dist/ (built) --
// both sit exactly one level under engine/.
const P_REPO_ROOT = resolve(__dirname, '..', '..');

function pythonPath(): string {
  const bin = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python3');
  return join(P_REPO_ROOT, 'backend', '.venv', bin);
}

// SUB-5: exported so apps/outputs/runtime.ts can hand a legacy old-mode workspace's `backend.py`
// the EXACT interpreter this engine spawns the real backend with -- the same "the running
// backend's own python, not a bare `python3` that may not exist on PATH" reasoning runtime.py's
// own `sys.executable` gave the Python original (see that file's p_spawn_env_base doc). Kept a
// getter (not a constant) so a test can still see a fresh P_REPO_ROOT-relative path.
export function resolveBackendPythonPath(): string {
  return pythonPath();
}

// Port 0 + immediate close: a free ephemeral port with a tiny (unavoidable) race window before
// uvicorn binds it, same tradeoff e2e/contract/fixtures.ts's freePort() accepts.
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(pid), '/t', '/f']); } catch { /* already exited */ }
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
  }
}

async function waitForHealth(port: number, child: ChildProcess, output: { text: string }): Promise<void> {
  // Generous: a cold cache dir can trigger one-time setup well past a minute, same budget
  // e2e/contract/fixtures.ts's waitForHealth gives the same command.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`python backend exited prematurely (code ${child.exitCode})\n--- backend output ---\n${output.text}`);
    }
    try {
      const res = await engineFetch(`http://127.0.0.1:${port}/api/health/check`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`python backend did not become healthy within 180s\n--- backend output ---\n${output.text}`);
}

export interface PythonBackend {
  /** 127.0.0.1 port the backend is listening on -- internal only, never exposed to callers. */
  port: number;
  child: ChildProcess;
  /** Kills the process (tree, on Windows). Safe to call more than once. */
  close: () => void;
}

/** Spawns `backend.main:app` under uvicorn on a free loopback port and waits for it to answer
 * `/api/health/check`. Throws (after best-effort cleanup) if it never comes up healthy. */
export async function spawnPythonBackend(): Promise<PythonBackend> {
  const port = await freePort();
  const output = { text: '' };
  const child = spawn(
    pythonPath(),
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: P_REPO_ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (d: Buffer) => { output.text += d; });
  child.stderr?.on('data', (d: Buffer) => { output.text += d; });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    killTree(child.pid);
  };

  try {
    await waitForHealth(port, child, output);
    return { port, child, close };
  } catch (e) {
    close();
    throw e;
  }
}
