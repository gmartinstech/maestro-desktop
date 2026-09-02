// scripts/run-contract-tests.mjs — boots the Python backend in isolated mock-agent mode
// (same pattern as scripts/gen-contract.mjs / e2e/golden/fixtures.ts: MAESTRO_MOCK_AGENT=1,
// throwaway data dirs, no real API key or network needed), points e2e/contract's Playwright
// suite at it via CONTRACT_HTTP_URL / CONTRACT_TOKEN, runs it, and tears the backend down
// (success or failure) before exiting with the suite's own exit code.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function pythonPath() {
  const bin = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python3');
  return join(REPO_ROOT, 'backend', '.venv', bin);
}

function playwrightBin() {
  return join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
}

// Port 0 + immediate close: a free ephemeral port with a tiny (unavoidable) race window
// before uvicorn binds it, same tradeoff scripts/gen-contract.mjs accepts.
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
      throw new Error(`backend exited prematurely (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health/check`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('backend did not become healthy within 180s');
}

// /api/dev/token is auth-exempt and hands back the per-install bearer token (dev-mode only —
// see backend/main.py's dev_token()); reading it this way is the same thing a real dev
// frontend does, rather than reaching past the HTTP surface to read auth.token off disk.
async function fetchDevToken(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/dev/token`);
  if (!res.ok) throw new Error(`GET /api/dev/token -> ${res.status}`);
  const body = await res.json();
  if (!body.token) throw new Error('GET /api/dev/token answered with no token');
  return body.token;
}

async function main() {
  const port = await freePort();
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-contract-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-contract-home-'));

  const backend = spawn(
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
  let backendOutput = '';
  backend.stdout.on('data', (d) => { backendOutput += d; });
  backend.stderr.on('data', (d) => { backendOutput += d; });

  let exitCode = 1;
  try {
    await waitForHealth(port, backend);
    const token = await fetchDevToken(port);

    console.log(`test:contract — backend up on 127.0.0.1:${port}, running e2e/contract...`);
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
          env: { ...process.env, CONTRACT_HTTP_URL: `http://127.0.0.1:${port}`, CONTRACT_TOKEN: token },
          stdio: 'inherit',
          // node_modules/.bin/playwright.cmd is a shell shim on Windows; spawn() can't exec it
          // directly without shell:true (EINVAL). Not needed/used on other platforms.
          shell: process.platform === 'win32',
        },
      );
      suite.on('exit', (code) => resolve(code ?? 1));
      suite.on('error', (err) => { console.error(err); resolve(1); });
    });
  } catch (e) {
    console.error(`test:contract: ${e.message}\n--- backend output ---\n${backendOutput}`);
    exitCode = 1;
  } finally {
    killTree(backend.pid);
    // maxRetries/retryDelay: on Windows the just-killed python.exe (and the 9Router node
    // subprocess it spawned) can hold a file handle open for a beat after taskkill returns (AV
    // scan, delayed handle release), which turns an immediate rmSync into a transient
    // EPERM/EBUSY on an otherwise-unused temp dir (same fix e2e/contract/fixtures.ts applies
    // for the same reason). Even the retries can lose that race, so this is best-effort: a
    // leftover temp dir is a cleanup nit, not a reason to mask the suite's real exit code.
    for (const dir of [dataRoot, stateHome]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (e) {
        console.warn(`test:contract: could not remove temp dir ${dir}: ${e.message}`);
      }
    }
  }
  process.exit(exitCode);
}

main();
