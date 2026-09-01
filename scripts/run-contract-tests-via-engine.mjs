// scripts/run-contract-tests-via-engine.mjs — ENG-1's gate.
//
// Same test:contract suite as scripts/run-contract-tests.mjs (http.spec.ts + ws.spec.ts,
// unmodified), but boots it through the TypeScript engine (engine/dist/main.js) instead of
// Python directly: MAESTRO_ENGINE_ROUTES is deliberately left UNSET, so every /api/* and /ws/*
// prefix defaults to 'proxy' (split.ts) and the engine spawns Python itself on an internal port
// nothing outside this script ever touches. CONTRACT_HTTP_URL/CONTRACT_TOKEN point the suite at
// the ENGINE's port, so a pass here proves the proxy layer is transparent — byte-identical
// responses to hitting Python directly — not just that routing exists.
//
// Requires the engine to already be built (`cd engine && npm run build`); this script doesn't
// build it, same as run-contract-tests.mjs doesn't build the Python venv.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function engineDistMainPath() {
  const candidate = join(REPO_ROOT, 'engine', 'dist', 'main.js');
  try {
    statSync(candidate);
    return candidate;
  } catch {
    throw new Error(`engine build not found at ${candidate}. Build it first: cd engine && npm run build`);
  }
}

function playwrightBin() {
  return join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
}

// Port 0 + immediate close: a free ephemeral port with a tiny (unavoidable) race window before
// the engine binds it, same tradeoff scripts/run-contract-tests.mjs / scripts/gen-contract.mjs accept.
async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function killTree(pid) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(pid), '/t', '/f']); } catch { /* already exited */ }
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
  }
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`engine exited prematurely (code ${child.exitCode})`);
    }
    try {
      // /api/health isn't native yet (that's SUB-1) — this exercises the whole proxy hop:
      // engine -> spawned Python -> back through the engine to us.
      const res = await fetch(`http://127.0.0.1:${port}/api/health/check`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('engine did not become healthy within 180s');
}

// /api/dev/token is auth-exempt on the Python side and proxies through unmodified; reading it
// this way (rather than the auth.token file directly) exercises the proxy for this call too.
async function fetchDevToken(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/dev/token`);
  if (!res.ok) throw new Error(`GET /api/dev/token -> ${res.status}`);
  const body = await res.json();
  if (!body.token) throw new Error('GET /api/dev/token answered with no token');
  return body.token;
}

async function main() {
  const enginePort = await freePort();
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-contract-engine-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-contract-engine-home-'));

  const engine = spawn(
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
        MAESTRO_ENGINE_PORT: String(enginePort),
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let engineOutput = '';
  engine.stdout.on('data', (d) => { engineOutput += d; });
  engine.stderr.on('data', (d) => { engineOutput += d; });

  let exitCode = 1;
  try {
    await waitForHealth(enginePort, engine);
    const token = await fetchDevToken(enginePort);

    console.log(`test:contract:engine — engine up on 127.0.0.1:${enginePort} (proxying to its own spawned backend), running e2e/contract...`);
    exitCode = await new Promise((resolve) => {
      const suite = spawn(
        playwrightBin(),
        [
          'test',
          'e2e/contract/http.spec.ts',
          'e2e/contract/ws.spec.ts',
          '--config', 'e2e/contract/playwright.config.ts',
        ],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, CONTRACT_HTTP_URL: `http://127.0.0.1:${enginePort}`, CONTRACT_TOKEN: token },
          stdio: 'inherit',
          shell: process.platform === 'win32',
        },
      );
      suite.on('exit', (code) => resolve(code ?? 1));
      suite.on('error', (err) => { console.error(err); resolve(1); });
    });
  } catch (e) {
    console.error(`test:contract:engine: ${e.message}\n--- engine output ---\n${engineOutput}`);
    exitCode = 1;
  } finally {
    killTree(engine.pid);
    for (const dir of [dataRoot, stateHome]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (e) {
        console.warn(`test:contract:engine: could not remove temp dir ${dir}: ${e.message}`);
      }
    }
  }
  process.exit(exitCode);
}

main();
