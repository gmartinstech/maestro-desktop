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
import { existsSync } from 'node:fs';
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

// PKG-2: a packaged build ships no `backend/` at all (CUT deletes it), so the dev-tree venv this
// resolves to is never real there -- guarded explicitly rather than left to existsSync() falling
// through by accident, so "not the primary path in a packaged build" is a deliberate contract, not
// a side effect. Same MAESTRO_PACKAGED convention router/process.ts and toolsLib/mcpConfig.ts use.
function pIsPackaged(): boolean {
  return process.env.MAESTRO_PACKAGED === '1';
}

// SUB-5: exported so apps/outputs/runtime.ts can hand a legacy old-mode workspace's `backend.py`
// the EXACT interpreter this engine spawns the real backend with -- the same "the running
// backend's own python, not a bare `python3` that may not exist on PATH" reasoning runtime.py's
// own `sys.executable` gave the Python original (see that file's p_spawn_env_base doc). Kept a
// getter (not a constant) so a test can still see a fresh P_REPO_ROOT-relative path.
// PKG-2: only ever the dev-tree venv, and only outside a packaged build -- see pIsPackaged(). Used
// by spawnPythonBackend() (Maestro's OWN backend, dev/opt-out-of-MAESTRO_ENGINE_SKIP_BACKEND path
// only). App-Builder callers (runtime.ts, executor.ts) use resolveAppBuilderPython() below instead,
// which never assumes a bundled interpreter exists.
export function resolveBackendPythonPath(): string {
  return pIsPackaged() ? '' : pythonPath();
}

export interface ResolvedPython {
  path: string;
  /** e.g. "3.11.4", parsed from the interpreter's own reported version. */
  version: string;
}

/** Thrown (never from resolveAppBuilderPython() itself, which returns null instead) by callers
 * that want a typed, catchable signal distinct from "the interpreter ran and failed" -- see
 * runtime.ts/executor.ts for where this becomes the user-facing message. */
export class PythonNotFoundError extends Error {
  constructor(detail = '') {
    super(`No usable Python 3 interpreter found${detail ? `: ${detail}` : ''}`);
    this.name = 'PythonNotFoundError';
  }
}

// Windows: `python` before `python3` -- python3.x aliases usually don't exist there, matching
// webapp_template/backend/run.sh's own CANDIDATES ordering (see that file, read-only reference).
const P_SYSTEM_PYTHON_CANDIDATES = process.platform === 'win32'
  ? ['python', 'python3']
  : ['python3', 'python'];

// Actually RUNS the candidate (short timeout) rather than trusting existsSync/PATH-presence alone
// -- existsSync can't tell a real interpreter from the Windows Store's `python.exe` alias stub
// (present as a file, does nothing useful when invoked non-interactively), and a bare command name
// isn't a path existsSync can check at all. A hang there would surface to the user as this whole
// feature silently freezing, which is exactly the failure mode this ticket rules out.
function pProbePython(candidate: string): ResolvedPython | null {
  if (!candidate) return null;
  try {
    const out = execFileSync(
      candidate,
      ['-c', 'import sys; sys.stdout.write(sys.version.split()[0])'],
      { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString('utf8').trim();
    if (!/^3\./.test(out)) return null; // Python 2 or something that printed nonsense: not usable.
    return { path: candidate, version: out };
  } catch {
    return null;
  }
}

/** Resolve the Python 3 interpreter to run App-Builder user workspaces (legacy `backend.py` apps,
 * `webapp_template` apps' own backend via `$MAESTRO_PYTHON`) and executor.ts's AST-safety validator
 * with. Order: 1) `MAESTRO_PYTHON` if the caller/environment set it explicitly -- an explicit pin
 * always wins and is NEVER silently swapped for a different interpreter when it's bad, so a
 * deliberately-set-but-broken override is a real, reportable misconfiguration rather than a
 * silently-different Python running the user's code (this is also how the PKG-2 gate simulates "no
 * interpreter": point MAESTRO_PYTHON at a path that doesn't exist); 2) the dev-tree backend/.venv
 * (never in a packaged build -- see resolveBackendPythonPath()); 3) a system Python found on PATH.
 * Returns null (never throws) so callers decide their own typed, user-facing degradation. */
export function resolveAppBuilderPython(): ResolvedPython | null {
  const override = process.env.MAESTRO_PYTHON;
  if (override) return pProbePython(override);
  const devVenv = resolveBackendPythonPath();
  if (devVenv && existsSync(devVenv)) {
    const probed = pProbePython(devVenv);
    if (probed) return probed;
  }
  for (const candidate of P_SYSTEM_PYTHON_CANDIDATES) {
    const probed = pProbePython(candidate);
    if (probed) return probed;
  }
  return null;
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
