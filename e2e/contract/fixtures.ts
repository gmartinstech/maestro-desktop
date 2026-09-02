// e2e/contract/fixtures.ts
//
// Boots the Python backend directly (no Electron, no browser) with an isolated data root and
// MAESTRO_MOCK_AGENT=1 — the same pattern `scripts/gen-contract.mjs` (CTR-1) uses to snapshot
// /openapi.json, itself modeled on `e2e/golden/fixtures.ts`'s isolation (temp MAESTRO_DATA_ROOT /
// MAESTRO_STATE_HOME so a run never touches a real user profile).
//
// One deliberate divergence from `e2e/golden/fixtures.ts`: that suite seeds an opaque
// `provedor_ia_token` into settings.json so the FRONTEND sign-in gate reads "opaque" and never
// opens a Keycloak browser flow (see maestro_token_status.py — `opaque` is the classification for
// a static, non-JWT credential, distinct from the backend's own auth). This suite never renders
// the frontend or its sign-in gate at all, and MAESTRO_MOCK_AGENT=1 short-circuits provider
// resolution before any credential is read (backend/apps/agents/agent_manager.py's
// run_agent_loop checks mock_agent_enabled() before touching providers), so there is nothing for
// that token to gate here. The credential this suite DOES need is a different one: the backend's
// own per-install bearer token (backend/auth.py's AUTH_TOKEN_FILE, `<dataRoot>/auth.token`),
// which gates every HTTP route and the WS handshake. It is minted fresh on boot; we just read it
// off disk once the backend is healthy.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

// e2e/contract -> e2e -> repo root. Playwright's test transform runs this as CommonJS, so
// __dirname (not import.meta.url) is the right way to anchor paths — same as e2e/helpers/launch.ts.
const REPO_ROOT = resolve(__dirname, '..', '..');

function pythonPath(): string {
  const bin = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python3');
  return join(REPO_ROOT, 'backend', '.venv', bin);
}

// ENG-1's gate: this same suite, unmodified, run against the TypeScript engine instead of Python
// directly — proving the strangler-fig proxy layer is transparent (see docs/plans/2026-08-31-txm-
// tauri-typescript-migration.md's ENG-1 entry). Set CONTRACT_ENGINE=1 to flip bootBackend()'s
// target; unset (the default) keeps booting Python directly, unchanged from CTR-3/CTR-4.
function engineDistMainPath(): string {
  const candidate = join(REPO_ROOT, 'engine', 'dist', 'main.js');
  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch { /* fall through to the error below */ }
  throw new Error(`engine build not found at ${candidate}. Build it first (cd engine && npm run build).`);
}

// Port 0 + immediate close: a free ephemeral port with a tiny (unavoidable) race window before
// uvicorn binds it, same tradeoff scripts/gen-contract.mjs accepts.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
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

async function waitForHealth(baseUrl: string, child: ChildProcess, output: { text: string }): Promise<void> {
  // Generous: a cold cache dir can trigger one-time setup well past a minute, same as gen-contract.mjs.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited prematurely (code ${child.exitCode})\n--- backend output ---\n${output.text}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health/check`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`backend did not become healthy within 180s\n--- backend output ---\n${output.text}`);
}

export interface BackendHandle {
  /** e.g. http://127.0.0.1:51234 */
  httpBaseUrl: string;
  /** e.g. ws://127.0.0.1:51234 */
  wsBaseUrl: string;
  /** Per-install bearer token (backend/auth.py); required on every non-exempt HTTP route and the WS handshake. */
  token: string;
  /** Isolated MAESTRO_DATA_ROOT for this run; handed out for tests that want to poke session JSON on disk. */
  dataRoot: string;
  /** Kills the backend process (tree) and removes the temp dirs. Safe to call multiple times. */
  close: () => void;
}

/** Boots `backend.main:app` under uvicorn with MAESTRO_MOCK_AGENT=1 and a throwaway data root /
 * state home, waits for it to answer /api/health/check, and reads back its freshly-minted
 * per-install auth token. No Electron, no browser — this is the plain HTTP/WS surface the
 * TypeScript engine rewrite (AGT-6) will be graded against with this exact test unmodified.
 *
 * With CONTRACT_ENGINE=1 this instead spawns `engine/dist/main.js` (ENG-1) on `port`, which
 * spawns Python itself on its own internal port and proxies everything through — the returned
 * `httpBaseUrl`/`wsBaseUrl` point at the ENGINE, not Python directly, but are otherwise identical
 * in shape, so no caller (including this exact file's own consumers) needs to change. Requires
 * the engine to already be built (`cd engine && npm run build`); this fixture doesn't build it,
 * same as e2e/golden-tauri/fixtures.ts not building tauri/target/debug/app.exe. */
export async function bootBackend(): Promise<BackendHandle> {
  const port = await freePort();
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-contract-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-contract-home-'));
  const output = { text: '' };
  const viaEngine = process.env.CONTRACT_ENGINE === '1';
  const child = viaEngine
    ? spawn(
      process.execPath,
      [engineDistMainPath()],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          MAESTRO_MOCK_AGENT: '1',
          MAESTRO_PACKAGED: '0',
          MAESTRO_DATA_ROOT: dataRoot,
          MAESTRO_STATE_HOME: stateHome,
          MAESTRO_ENGINE_PORT: String(port),
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    : spawn(
      pythonPath(),
      ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          MAESTRO_MOCK_AGENT: '1',
          MAESTRO_PACKAGED: '0',
          MAESTRO_DATA_ROOT: dataRoot,
          MAESTRO_STATE_HOME: stateHome,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  child.stdout?.on('data', (d) => { output.text += d; });
  child.stderr?.on('data', (d) => { output.text += d; });

  const httpBaseUrl = `http://127.0.0.1:${port}`;
  const wsBaseUrl = `ws://127.0.0.1:${port}`;

  // maxRetries/retryDelay: on Windows the just-killed python.exe (or an AV scan reacting to it)
  // can hold a handle into the temp dir open for a beat after taskkill returns, which turns an
  // immediate rmSync into a transient EPERM/EBUSY. fs.rmSync retries those specific errno classes
  // itself; wrapped in try/catch too because cleanup is best-effort — a leftover dir under the OS
  // temp root is harmless (nothing in it is sensitive, and the OS reclaims it eventually), so a
  // cleanup straggler must never fail the test whose actual job is asserting the WS turn contract.
  function rmBestEffort(path: string): void {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`golden-turn fixtures: best-effort cleanup of ${path} failed (ignored): ${(e as Error).message}`);
    }
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    killTree(child.pid);
    rmBestEffort(dataRoot);
    rmBestEffort(stateHome);
  };

  try {
    await waitForHealth(httpBaseUrl, child, output);
    // init_auth_token() (backend/auth.py) writes this BEFORE the HTTP port binds, so it's
    // guaranteed to exist by the time /api/health/check answers 200.
    const token = readFileSync(join(dataRoot, 'auth.token'), 'utf8').trim();
    if (!token) throw new Error(`auth token file at ${join(dataRoot, 'auth.token')} was empty`);
    return { httpBaseUrl, wsBaseUrl, token, dataRoot, close };
  } catch (e) {
    close();
    throw e;
  }
}
