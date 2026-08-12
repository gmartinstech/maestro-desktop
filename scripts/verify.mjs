// scripts/verify.mjs
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

// The golden smoke drives the PACKAGED app, so a missing or stale artifact makes it
// meaningless: it would either die on an opaque Playwright error or green against a
// binary built before the change under test. Refuse both, with the fix in the message.
function packagedAppStatus() {
  const dist = path.join(process.cwd(), 'electron', 'dist');
  const candidates = process.platform === 'win32'
    ? [path.join(dist, 'win-unpacked', 'Maestro Studio.exe')]
    : process.platform === 'darwin'
      ? [path.join(dist, 'mac-arm64', 'Maestro Studio.app', 'Contents', 'MacOS', 'Maestro Studio'),
         path.join(dist, 'mac', 'Maestro Studio.app', 'Contents', 'MacOS', 'Maestro Studio')]
      : [path.join(dist, 'linux-unpacked', 'maestro-studio')];
  // `npm run dist` is mac-only; each host has its own entry point.
  const buildCmd = process.platform === 'win32' ? 'pwsh scripts\\build-app-win.ps1'
    : process.platform === 'darwin' ? 'npm --prefix electron run dist'
      : 'npm --prefix electron exec electron-builder -- --linux';
  const target = process.env.E2E_APP_PATH || candidates.find((c) => { try { return statSync(c).isFile(); } catch { return false; } });
  if (!target) return { ok: false, why: `no packaged app found. Build it first (${buildCmd}), or set E2E_APP_PATH.\n  Looked in:\n    ${candidates.join('\n    ')}` };
  const builtAt = statSync(target).mtimeMs;
  const headAt = Number(execSync('git log -1 --format=%ct', { encoding: 'utf8' }).trim()) * 1000;
  if (builtAt < headAt) {
    return { ok: false, why: `packaged app is older than HEAD, so golden would test stale code.\n  ${target}\n  built ${new Date(builtAt).toISOString()} < commit ${new Date(headAt).toISOString()}\n  Rebuild with: ${buildCmd}` };
  }
  return { ok: true };
}

const steps = [
  ['lint',      'cd frontend && npm run lint'],
  ['typecheck', 'cd frontend && npx tsc --noEmit'],
  ['build',     'cd frontend && npm run build'],
  ['golden',    'npm run e2e:golden', packagedAppStatus],
  // CLAUDE.md advertises "tests" in this gate; the 1745-test backend suite was never actually
  // invoked here. MAESTRO_MOCK_AGENT must stay UNSET: the mock starves the WebSocket assertions.
  ['backend',   process.platform === 'win32'
      // Absolute + double-quoted: a relative venv path breaks differently in cmd (rejects forward
      // slashes in the exe position) and in sh (eats lone backslashes). Quoting sidesteps both.
      ? `"${path.join(process.cwd(), 'backend', '.venv', 'Scripts', 'python.exe')}" -m pytest -q -p no:randomly`
      : `"${path.join(process.cwd(), 'backend', '.venv', 'bin', 'python')}" -m pytest -q -p no:randomly`,
      undefined, 'backend'],
];
let failed = [];
for (const [name, cmd, precondition, cwd] of steps){
  console.log(`\n=== ${name} ===`);
  if (precondition){
    const { ok, why } = precondition();
    if (!ok){ console.error(`SKIPPED-AS-FAILED: ${name} — ${why}`); failed.push(name); continue; }
  }
  try { execSync(cmd, { stdio:'inherit', shell:true, cwd: cwd ? path.join(process.cwd(), cwd) : undefined }); }
  catch { failed.push(name); }
}
// Was a console.warn "expected until DET epic". That epic is done and the tree is clean, so a
// regression here must fail the gate rather than scroll past in a build log.
try { console.log('\n=== call-home ==='); execSync('node scripts/check-callhome.mjs', { stdio:'inherit' }); }
catch { failed.push('call-home'); }
// Fork drift is a HARD failure, unlike the call-home warning above: an upstream merge that
// reintroduces a deleted subsystem or the old branding must not reach main. See docs/UPSTREAM.md.
try { console.log('\n=== fork-drift ==='); execSync('node scripts/check-fork-drift.mjs', { stdio:'inherit' }); }
catch { failed.push('fork-drift'); }
if (failed.length){ console.error(`\nVERIFY FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\nVERIFY GREEN');
