// scripts/check-callhome.mjs — fails if a forbidden host appears in built output
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// GUARD FILE. The `openswarm` literals below are INTENTIONAL and must never be
// renamed away: they are the regression detector for the upstream call-home
// hosts. Renaming them to `maestro` would silently disarm this check.
const FORBIDDEN = [
  /openswarm\.com/i,
  /[a-z0-9-]+\.openswarm\.(com|ai|io|net)/i,
  /api\.openswarm/i,
  /analytics\.openswarm/i,
];
const ROOTS = ['frontend/build', 'electron', 'engine/src', 'engine/dist', 'tauri/src', 'tauri/gen', 'contract'];
let hits = [];
function walk(p){ for (const e of readdirSync(p)){ const f=join(p,e); const s=statSync(f);
  if (s.isDirectory()){ if(!/node_modules|\.git/.test(f)) walk(f);}
  // Test files are exempt, and only test files: a spec asserting `engineFetch('https://api.openswarm.com/x')`
  // REJECTS is evidence the guard works, not a call-home, and tests are not in any shipped bundle.
  // Nothing else is exempt — production sources under these ROOTS stay fully scanned.
  else if (/\.(test|spec)\.[jt]sx?$/.test(f)) { /* skip */ }
  else if (/\.(js|html|json|css|rs|toml|ts|tsx|mjs|kt|swift|plist|xml|yml)$/.test(f)){ const t=readFileSync(f,'utf8');
    for (const rx of FORBIDDEN) if (rx.test(t)) hits.push(`${f} :: ${rx}`);} } }
for (const r of ROOTS){ try { walk(r); } catch {} }
if (hits.length){ console.error('CALL-HOME LEAK:\n'+hits.join('\n')); process.exit(1); }
console.log('call-home check: clean');
