// scripts/gen-contract.mjs — freezes the HTTP contract as contract/openapi.json
//
// No flags: boots the backend (MAESTRO_MOCK_AGENT=1, isolated temp data dirs — same
// pattern as e2e/golden/fixtures.ts), fetches /openapi.json, and overwrites
// contract/openapi.json with a pretty-printed, key-sorted copy.
//
// --check: does the same generation into memory, then diffs against the committed
// file byte-for-byte (after the same sort+format normalization) and exits non-zero
// on any mismatch. Used by the contract-freeze gate; never writes.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTRACT_FILE = join(REPO_ROOT, 'contract', 'openapi.json');
const CHECK = process.argv.includes('--check');

function pythonPath() {
  const bin = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python3');
  return join(REPO_ROOT, 'backend', '.venv', bin);
}

// Port 0 + immediate close: a free ephemeral port with a tiny (unavoidable) race
// window before uvicorn binds it, same tradeoff every dev script here accepts.
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
  // Generous: a cold cache dir triggers one-time setup (9Router install, webapp-template
  // node_modules warm) that can run well past a minute before /api/health/check answers.
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
  throw new Error('backend did not become healthy within 60s');
}

// Boots the backend the same way run.ps1/electron do (uvicorn, isolated data dirs,
// MAESTRO_MOCK_AGENT=1 so no real API key or network is needed), fetches
// /openapi.json, and shuts the backend down cleanly. Returns the raw JSON text.
async function fetchOpenapiJson() {
  const port = await freePort();
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-contract-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-contract-home-'));
  const child = spawn(
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
        // Fixed seed so Python's per-process string-hash randomization can't reorder the
        // method sets FastAPI iterates when auto-naming operationIds for multi-method
        // routes (e.g. the anthropic-proxy catch-all) — without this, two runs on an
        // otherwise-identical schema can disagree on which duplicate gets a "_head" vs
        // "_options" suffix, and --check would flap between successive good commits.
        PYTHONHASHSEED: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  try {
    await waitForHealth(port, child);
    const res = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    if (!res.ok) throw new Error(`GET /openapi.json -> ${res.status}`);
    return await res.text();
  } catch (e) {
    throw new Error(`${e.message}\n--- backend output ---\n${output}`);
  } finally {
    killTree(child.pid);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(stateHome, { recursive: true, force: true });
  }
}

// Stable, sorted-key pretty-print so the committed artifact diffs cleanly across
// runs regardless of the source object's own key order.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, k) => {
      out[k] = sortKeys(value[k]);
      return out;
    }, {});
  }
  return value;
}

function normalize(rawJson) {
  return `${JSON.stringify(sortKeys(JSON.parse(rawJson)), null, 2)}\n`;
}

async function main() {
  const normalized = normalize(await fetchOpenapiJson());

  if (CHECK) {
    let committed;
    try {
      committed = readFileSync(CONTRACT_FILE, 'utf8');
    } catch {
      console.error(`contract check: ${CONTRACT_FILE} does not exist — run \`node scripts/gen-contract.mjs\` first`);
      process.exit(1);
    }
    if (committed !== normalized) {
      console.error(`contract check: contract/openapi.json is stale relative to the live backend schema.\nRun \`node scripts/gen-contract.mjs\` and commit the diff.`);
      process.exit(1);
    }
    console.log('contract check: contract/openapi.json matches the live backend schema');
    return;
  }

  writeFileSync(CONTRACT_FILE, normalized);
  console.log(`wrote ${CONTRACT_FILE}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
