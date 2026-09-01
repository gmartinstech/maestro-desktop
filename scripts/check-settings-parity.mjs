// scripts/check-settings-parity.mjs — ENG-3's own gate.
//
// Two checks, both run for real against actual processes (not mocked):
//
// 1. PARITY: seed a realistic settings.json (a legacy field name that needs migrating, plus a
//    stored credential under provedor_ia_token) and load it with BOTH implementations -- Python's
//    backend.apps.settings.store.load_settings() and the TS engine's
//    engine/dist/settings/store.js loadSettings() -- then diff the resulting objects field by
//    field. The stored credential is an opaque mtok_-shaped value, not a JWT: the JWT-shape
//    clearing store.py's p_migrate_provedor_ia_identity does (only when the OS credential store
//    holds no refresh token) is deliberately NOT ported to the TS side yet (that's ENG-4's
//    credential-store job) -- an opaque credential sidesteps that gap entirely rather than
//    papering over it, while still proving the one hard requirement: the key name itself must
//    round-trip unrenamed and unchanged.
//
// 2. SINGLE-WRITER ROUND TRIP: boot the real TS engine (engine/dist/main.js) with
//    MAESTRO_ENGINE_ROUTES=settings:native, PUT a change through its real HTTP /api/settings
//    endpoint, then confirm Python's load_settings() can still parse the resulting file --
//    with MAESTRO_ENGINE_OWNS_SETTINGS left UNSET, proving the flag-gated Python guard added to
//    store.py doesn't change anything for an install that hasn't opted in.
//
// Requires `cd engine && npm run build` to have already run (same convention as
// run-contract-tests-via-engine.mjs).
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function pythonBin() {
  return process.platform === 'win32'
    ? join(REPO_ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
    : join(REPO_ROOT, 'backend', '.venv', 'bin', 'python');
}

function engineDistMainPath() {
  const candidate = join(REPO_ROOT, 'engine', 'dist', 'main.js');
  try {
    statSync(candidate);
    return candidate;
  } catch {
    throw new Error(`engine build not found at ${candidate}. Build it first: cd engine && npm run build`);
  }
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolvePromise(port));
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

// A realistic, hand-shaped install profile: one legacy pre-rebrand field (must migrate), one
// current-schema field alongside it, and an opaque (non-JWT) stored credential.
const P_SEED_CREDENTIAL = 'mtok_a1b2c3d4e5f6realistictoken7890';
const P_SEED_RAW = {
  theme: 'dark',
  zoom_sensitivity: 65,
  openswarm_bearer_token: 'legacy-bearer-should-become-maestro_bearer_token',
  provedor_ia_token: P_SEED_CREDENTIAL,
  custom_providers: [{ name: 'provedor-ia', base_url: 'https://stale.example.com' }, { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', api_key: '', models: [] }],
  default_model: 'custom/provedor-ia/maestro-fast',
};

function runPythonLoadSettings(dataRoot) {
  const script = [
    'import json, sys',
    "sys.path.insert(0, r'" + REPO_ROOT + "')",
    'from backend.apps.settings.store import load_settings',
    'print(json.dumps(load_settings().model_dump(), sort_keys=True))',
  ].join('\n');
  const out = execFileSync(pythonBin(), ['-c', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, MAESTRO_DATA_ROOT: dataRoot, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function runTsLoadSettings(dataRoot) {
  const distStore = join(REPO_ROOT, 'engine', 'dist', 'settings', 'store.js');
  const script = [
    `const { loadSettings } = require(${JSON.stringify(distStore)});`,
    'console.log(JSON.stringify(loadSettings().settings));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, MAESTRO_DATA_ROOT: dataRoot },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function diffFields(pyObj, tsObj, fields) {
  const mismatches = [];
  for (const f of fields) {
    const a = pyObj[f];
    const b = tsObj[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ field: f, python: a, ts: b });
  }
  return mismatches;
}

async function waitForEngineHealth(url, child, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`engine exited prematurely (code ${child.exitCode})`);
    try {
      const res = await fetch(url);
      if (res.status !== undefined) return; // any real HTTP response (even 401) means the port is live
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('engine did not come up in time');
}

async function main() {
  const failures = [];

  // ---- Check 1: parity ----
  const parityRoot = mkdtempSync(join(tmpdir(), 'maestro-settings-parity-'));
  try {
    const settingsDir = join(parityRoot, 'settings');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(P_SEED_RAW, null, 2));

    const pyResult = runPythonLoadSettings(parityRoot);
    const tsResult = runTsLoadSettings(parityRoot);

    // Fields both sides are expected to agree on for this seed (excludes fields Python's
    // apply_maestro_defaults derives from 9Router/catalog state -- e.g. custom_providers gets a
    // live "Maestro" entry injected server-side on the Python load, which this ticket's TS store
    // deliberately does not port; see store.ts's module doc).
    const sharedFields = ['theme', 'zoom_sensitivity', 'maestro_bearer_token', 'provedor_ia_token', 'default_model', 'connection_mode'];
    const mismatches = diffFields(pyResult, tsResult, sharedFields);

    console.log('=== parity: Python vs TS load of the same seeded settings.json ===');
    console.log(`  legacy openswarm_bearer_token -> maestro_bearer_token: python=${JSON.stringify(pyResult.maestro_bearer_token)} ts=${JSON.stringify(tsResult.maestro_bearer_token)}`);
    console.log(`  stored credential (provedor_ia_token) round-trips: python=${JSON.stringify(pyResult.provedor_ia_token)} ts=${JSON.stringify(tsResult.provedor_ia_token)}`);
    console.log(`  stale picker prefix migration on default_model: python=${JSON.stringify(pyResult.default_model)} ts=${JSON.stringify(tsResult.default_model)}`);
    if (pyResult.provedor_ia_token !== P_SEED_CREDENTIAL || tsResult.provedor_ia_token !== P_SEED_CREDENTIAL) {
      failures.push('provedor_ia_token did not round-trip unchanged on one or both sides');
    }
    if (mismatches.length > 0) {
      failures.push(`field mismatches: ${JSON.stringify(mismatches)}`);
    } else {
      console.log('  PARITY OK on all shared fields');
    }
  } finally {
    rmSync(parityRoot, { recursive: true, force: true });
  }

  // ---- Check 2: single-writer round trip through the real TS engine HTTP endpoint ----
  const roundTripRoot = mkdtempSync(join(tmpdir(), 'maestro-settings-roundtrip-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-settings-roundtrip-home-'));
  let engine;
  try {
    const enginePort = await freePort();
    engine = spawn(process.execPath, [engineDistMainPath()], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MAESTRO_PACKAGED: '0',
        MAESTRO_DATA_ROOT: roundTripRoot,
        MAESTRO_STATE_HOME: stateHome,
        MAESTRO_ENGINE_PORT: String(enginePort),
        MAESTRO_ENGINE_ROUTES: 'settings:native',
        MAESTRO_ENGINE_SKIP_BACKEND: '1', // this gate never needs Python to be the proxy target
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let engineOutput = '';
    engine.stdout.on('data', (d) => { engineOutput += d; });
    engine.stderr.on('data', (d) => { engineOutput += d; });

    const authTokenPath = join(roundTripRoot, 'auth.token');
    await waitForEngineHealth(`http://127.0.0.1:${enginePort}/api/settings`, engine, 20_000);
    // initAuthToken() writes the token file synchronously before the port binds (auth/token.ts);
    // the port answering at all (even 401, per waitForEngineHealth) means it has already run.
    const token = readFileSync(authTokenPath, 'utf8').trim();

    const putBody = { theme: 'dark', browser_homepage: 'https://roundtrip.example.com' };
    const putRes = await fetch(`http://127.0.0.1:${enginePort}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(putBody),
    });
    if (!putRes.ok) {
      failures.push(`PUT /api/settings via the TS engine answered ${putRes.status}, expected 2xx. Engine output:\n${engineOutput}`);
    } else {
      console.log(`=== round trip: PUT /api/settings via the real TS engine (MAESTRO_ENGINE_ROUTES=settings:native) -> ${putRes.status} ===`);
    }

    killTree(engine.pid);
    engine = null;

    // MAESTRO_ENGINE_OWNS_SETTINGS deliberately left UNSET here -- this proves the Python guard's
    // default/non-opted-in path is untouched: Python must still read the file the engine just wrote.
    const pyAfter = runPythonLoadSettings(roundTripRoot);
    console.log(`  Python reads the engine-written file back fine (flag unset): theme=${JSON.stringify(pyAfter.theme)} browser_homepage=${JSON.stringify(pyAfter.browser_homepage)}`);
    if (pyAfter.theme !== 'dark' || pyAfter.browser_homepage !== 'https://roundtrip.example.com') {
      failures.push(`Python's read of the engine-written settings.json did not reflect the PUT: ${JSON.stringify(pyAfter)}`);
    }
  } finally {
    if (engine) killTree(engine.pid);
    for (const dir of [roundTripRoot, stateHome]) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best-effort cleanup */ }
    }
  }

  if (failures.length > 0) {
    console.error('\ncheck-settings-parity: FAILED');
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('\ncheck-settings-parity: PASSED');
}

main().catch((err) => {
  console.error('check-settings-parity: fatal error:', err);
  process.exit(1);
});
