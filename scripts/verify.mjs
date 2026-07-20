// scripts/verify.mjs
import { execSync } from 'node:child_process';
const steps = [
  ['lint',      'cd frontend && npm run lint'],
  ['typecheck', 'cd frontend && npx tsc --noEmit'],
  ['build',     'cd frontend && npm run build'],
  ['golden',    'npm run e2e:golden'],          // wired in Task 6
];
let failed = [];
for (const [name, cmd] of steps){
  try { console.log(`\n=== ${name} ===`); execSync(cmd, { stdio:'inherit', shell:true }); }
  catch { failed.push(name); }
}
try { execSync('node scripts/check-callhome.mjs', { stdio:'inherit' }); }
catch { console.warn('WARN: call-home not yet clean (expected until DET epic)'); }
if (failed.length){ console.error(`\nVERIFY FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\nVERIFY GREEN');
