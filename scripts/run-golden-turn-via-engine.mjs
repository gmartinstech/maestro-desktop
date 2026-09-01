// scripts/run-golden-turn-via-engine.mjs — ENG-1's gate, second half.
//
// Runs e2e/contract/golden-turn.spec.ts (CTR-4) completely unmodified, but with its fixtures
// (e2e/contract/fixtures.ts's bootBackend()) booting through the TypeScript engine instead of
// Python directly — set via CONTRACT_ENGINE=1, spawned through node here rather than baked into
// package.json's scripts block so it works identically on Windows/POSIX with no shell-specific
// env-var syntax. A pass here proves the full mock-agent turn (HTTP session create + WS
// send_message + streamed reply) is byte-identical when proxied through the engine.
//
// Requires the engine to already be built (`cd engine && npm run build`); this script doesn't
// build it, same as run-contract-tests-via-engine.mjs.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function playwrightBin() {
  return join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
}

const child = spawn(
  playwrightBin(),
  ['test', 'e2e/contract/golden-turn.spec.ts', '--timeout=180000'],
  {
    cwd: REPO_ROOT,
    env: { ...process.env, CONTRACT_ENGINE: '1' },
    stdio: 'inherit',
    // node_modules/.bin/playwright.cmd is a shell shim on Windows; spawn() can't exec it
    // directly without shell:true (EINVAL) — same as run-contract-tests.mjs.
    shell: process.platform === 'win32',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => { console.error(err); process.exit(1); });
