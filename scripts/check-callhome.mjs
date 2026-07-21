// scripts/check-callhome.mjs — fails if a forbidden host appears in built output OR source.
// Scans both the built renderer/electron (catches anything bundled) and the production
// source tree (catches detachment regressions before a build). Test fixtures and the
// vendored webapp-template snapshot legitimately reference the old host, so they're skipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const FORBIDDEN = [/openswarm\.com/i, /api\.openswarm/i, /analytics\.openswarm/i];
const ROOTS = ['frontend/dist', 'electron', 'frontend/src', 'backend'];
const SKIP_DIR = /node_modules|\.git|__pycache__|webapp_template|(^|[\\/])tests?([\\/]|$)/;
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$|_test\.py$|test_.*\.py$/;
const SCAN_EXT = /\.(js|mjs|cjs|ts|tsx|html|json|css|py|sh)$/;
let hits = [];
function walk(p){ for (const e of readdirSync(p)){ const f=join(p,e); const s=statSync(f);
  if (s.isDirectory()){ if(!SKIP_DIR.test(f)) walk(f);}
  else if (SCAN_EXT.test(f) && !SKIP_FILE.test(f)){ const t=readFileSync(f,'utf8');
    for (const rx of FORBIDDEN) if (rx.test(t)) hits.push(`${f} :: ${rx}`);} } }
for (const r of ROOTS){ try { walk(r); } catch {} }
if (hits.length){ console.error('CALL-HOME LEAK:\n'+hits.join('\n')); process.exit(1); }
console.log('call-home check: clean');
