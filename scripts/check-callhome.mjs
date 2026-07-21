// scripts/check-callhome.mjs — fails if a forbidden host appears in built output
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const FORBIDDEN = [/openswarm\.com/i, /api\.openswarm/i, /analytics\.openswarm/i];
const ROOTS = ['frontend/dist', 'electron'];
let hits = [];
function walk(p){ for (const e of readdirSync(p)){ const f=join(p,e); const s=statSync(f);
  if (s.isDirectory()){ if(!/node_modules|\.git/.test(f)) walk(f);}
  else if (/\.(js|html|json|css)$/.test(f)){ const t=readFileSync(f,'utf8');
    for (const rx of FORBIDDEN) if (rx.test(t)) hits.push(`${f} :: ${rx}`);} } }
for (const r of ROOTS){ try { walk(r); } catch {} }
if (hits.length){ console.error('CALL-HOME LEAK:\n'+hits.join('\n')); process.exit(1); }
console.log('call-home check: clean');
