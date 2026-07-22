// scripts/verify.mjs
import { execSync } from 'node:child_process';
// Fatal gate: a failure here means "not safe to merge".
const steps = [
  ['typecheck', 'cd frontend && npx tsc --noEmit'],
  ['build',     'cd frontend && npm run build'],
  ['golden',    'npm run e2e:golden'],          // wired in Task 6
];
let failed = [];
for (const [name, cmd] of steps){
  try { console.log(`\n=== ${name} ===`); execSync(cmd, { stdio:'inherit', shell:true }); }
  catch { failed.push(name); }
}
// Best-effort checks: informative, not fatal. The repo linter (linter/lint.py) needs a
// provisioned Python toolchain (ruff/pyright/eslint/knip); when absent, warn rather than
// fail the whole gate. Frontend has no standalone eslint script — lint runs through lint.py.
try { console.log('\n=== lint (best-effort) ==='); execSync('python3 linter/lint.py --root .', { stdio:'inherit', shell:true }); }
catch { console.warn('WARN: lint skipped or reported issues (linter toolchain may be unprovisioned)'); }
// Fatal now that the DET epic is complete: any *.openswarm.com regression must block merge.
try { console.log('\n=== call-home ==='); execSync('node scripts/check-callhome.mjs', { stdio:'inherit' }); }
catch { failed.push('call-home'); }
if (failed.length){ console.error(`\nVERIFY FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\nVERIFY GREEN');
