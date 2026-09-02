// engine/src/apps/swarm/scanAppFiles.ts -- SUB-5, a full TypeScript port of
// backend/apps/swarm/scan_app_files.py, REPLACING the SUB-3 stand-in this file used to be (that
// ticket's own header explained why: this needs backend/apps/outputs/executor.py's
// get_code_warnings, and outputs/ hadn't been ported yet -- SUB-5 has now landed
// apps/outputs/executor.ts, so this is that real port).
//
// Best-effort safety read of imported app code. AST flags risky Python via the existing executor
// allow/deny lists, and we note when an app will run real code on the importer's machine (a
// webapp_template app spawns `bash run.sh`). This is advisory and surfaced in the import
// preflight; the actual execution gates are the user choosing to open/run the app and the flat-app
// /execute HITL.
//
// ASYNC NOTE: getCodeWarnings spawns a real Python subprocess (see executor.ts's own header --
// running the actual ast.parse/ast.walk logic rather than reimplementing Python's grammar in JS),
// so unlike the Python original's synchronous call this is necessarily async. closure.ts's
// reviewBundle (this function's one caller) and swarm.ts's one call site are both already async,
// so this costs no new API shape at either.

import { getCodeWarnings } from '../outputs/executor';
import type { ReviewSummary } from './models';

export async function scanAppFiles(files: Record<string, Buffer>): Promise<ReviewSummary> {
  const findings: string[] = [];
  const scanned: string[] = [];
  let runnable = false;
  for (const [path, data] of Object.entries(files)) {
    const low = path.toLowerCase();
    if (low.endsWith('/run.sh') || low.endsWith('package.json') || low.includes('/backend/')) runnable = true;
    if (!low.endsWith('.py')) continue;
    scanned.push(path);
    let code: string;
    try {
      code = data.toString('utf8');
    } catch {
      continue;
    }
    for (const w of await getCodeWarnings(code)) {
      findings.push(`${path}: ${w}`);
    }
  }
  let verdict: ReviewSummary['verdict'] = findings.length > 0 ? 'warn' : 'clean';
  if (runnable) {
    verdict = 'warn';
    findings.unshift('This app runs code on your computer. Only import apps you trust.');
  }
  return { verdict, findings, scanned_files: scanned };
}
