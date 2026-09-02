// engine/src/apps/workflows/store.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/storage.py's on-disk store for workflows + workflow runs.
//
// Layout under DATA_ROOT/workflows/ (unchanged from the Python original, same on-disk format so
// either backend can read the other's data during the migration):
//   <id>.json                workflow record
//   runs/<workflow_id>.json  bounded log (latest N) of runs for that workflow
//   paused.json              global pause flag
//   missed.json               pending missed-fire records
//
// This engine has no long-lived worker process today the way the Python one does (each HTTP
// request is its own dispatch), so -- exactly like dashboards/store.ts and dashboardLayout/
// store.ts before it -- this keeps the SAME in-process cache-plus-disk shape the Python module
// uses (a module-scoped cache, lazily loaded on first access), not a stateless per-call disk read.
// The engine process is long-lived (one Fastify server for the app's whole lifetime), so this
// cache is exactly as valid as the Python one's.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import { atomicWriteJson } from '../../settings/store';
import { coerceMissedRun, coerceWorkflow, coerceWorkflowRun, type MissedRun, type Workflow, type WorkflowRun } from './models';

export function workflowsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'workflows');
}

function runsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(workflowsDir(env), 'runs');
}

function pausedFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(workflowsDir(env), 'paused.json');
}

function missedFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(workflowsDir(env), 'missed.json');
}

// Hard ceiling on pending missed fires kept on disk -- mirrors storage.py's MAX_MISSED.
const MAX_MISSED = 200;
// Per-workflow run history cap -- mirrors storage.py's RUNS_PER_WORKFLOW.
const RUNS_PER_WORKFLOW = 200;

function ensureDirs(env: NodeJS.ProcessEnv): void {
  mkdirSync(workflowsDir(env), { recursive: true });
  mkdirSync(runsDir(env), { recursive: true });
}

function workflowFilePath(wid: string, env: NodeJS.ProcessEnv): string {
  return join(workflowsDir(env), `${wid}.json`);
}

function runsFilePath(wid: string, env: NodeJS.ProcessEnv): string {
  return join(runsDir(env), `${wid}.json`);
}

function readJsonOrNull(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Best-effort host IANA zone name -- mirrors storage.py's _resolve_host_tz_name /
 * apps/service/client.py's convention (MAESTRO_TIMEZONE override, else the system zone). */
export function resolveHostTzName(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.MAESTRO_TIMEZONE ?? '').trim();
  if (override) return override;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

class WorkflowStoreState {
  workflows = new Map<string, Workflow>();
  runs = new Map<string, WorkflowRun[]>();
  missed: MissedRun[] = [];
  paused = false;
  loaded = false;
}

// One process-wide cache, same convention as storage.py's module-level globals. A test that needs
// isolation constructs its own env (MAESTRO_DATA_ROOT pointed at a throwaway dir) and calls init()
// to force a fresh load for that root; the cache itself is keyed process-wide (matches the Python
// module's own single-process assumption -- there is exactly one DATA_ROOT per running engine).
const state = new WorkflowStoreState();

function loadAllFromDisk(env: NodeJS.ProcessEnv): void {
  ensureDirs(env);
  state.workflows.clear();
  state.runs.clear();
  const hostTz = resolveHostTzName(env);
  const dir = workflowsDir(env);
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json') || fname === 'paused.json' || fname === 'missed.json') continue;
    const raw = readJsonOrNull(join(dir, fname));
    if (raw === null || typeof raw !== 'object') continue;
    let wf: Workflow;
    try {
      wf = coerceWorkflow(raw);
    } catch {
      continue;
    }
    // Coerce legacy timezone="local" to the host IANA zone in memory only -- matches storage.py's
    // own stance (on-disk file rewritten only on the user's next save, not here).
    if (wf.schedule.timezone === 'local') wf.schedule = { ...wf.schedule, timezone: hostTz };
    state.workflows.set(wf.id, wf);
  }
  const rd = runsDir(env);
  if (existsSync(rd)) {
    for (const fname of readdirSync(rd)) {
      if (!fname.endsWith('.json')) continue;
      const wid = fname.slice(0, -5);
      const raw = readJsonOrNull(join(rd, fname));
      state.runs.set(wid, Array.isArray(raw) ? raw.map(coerceWorkflowRun) : []);
    }
  }
  const pausedRaw = readJsonOrNull(pausedFilePath(env));
  state.paused = typeof pausedRaw === 'object' && pausedRaw !== null && (pausedRaw as Record<string, unknown>).paused === true;
  state.missed = [];
  const missedRaw = readJsonOrNull(missedFilePath(env));
  if (Array.isArray(missedRaw)) {
    for (const m of missedRaw) {
      const coerced = coerceMissedRun(m);
      if (coerced) state.missed.push(coerced);
    }
  }
  state.loaded = true;
}

export function init(env: NodeJS.ProcessEnv = process.env): void {
  loadAllFromDisk(env);
}

function ensureLoaded(env: NodeJS.ProcessEnv): void {
  if (!state.loaded) loadAllFromDisk(env);
}

/** Soft-deleted records are filtered here so the scheduler, calendar, and every list view skip
 * them with no per-caller guard -- mirrors storage.py's list_workflows(). */
export function listWorkflows(env: NodeJS.ProcessEnv = process.env): Workflow[] {
  ensureLoaded(env);
  return [...state.workflows.values()].filter((w) => w.deleted_at === null);
}

export function listDeletedWorkflows(env: NodeJS.ProcessEnv = process.env): Workflow[] {
  ensureLoaded(env);
  return [...state.workflows.values()].filter((w) => w.deleted_at !== null);
}

export function getWorkflow(wid: string, env: NodeJS.ProcessEnv = process.env): Workflow | null {
  ensureLoaded(env);
  return state.workflows.get(wid) ?? null;
}

export function saveWorkflow(wf: Workflow, env: NodeJS.ProcessEnv = process.env): Workflow {
  ensureDirs(env);
  state.workflows.set(wf.id, wf);
  atomicWriteJson(workflowFilePath(wf.id, env), wf);
  return wf;
}

export function deleteWorkflow(wid: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const existed = state.workflows.has(wid);
  state.workflows.delete(wid);
  state.runs.delete(wid);
  const wfPath = workflowFilePath(wid, env);
  if (existsSync(wfPath)) rmSync(wfPath);
  const rp = runsFilePath(wid, env);
  if (existsSync(rp)) rmSync(rp);
  if (state.missed.some((m) => m.workflow_id === wid)) {
    state.missed = state.missed.filter((m) => m.workflow_id !== wid);
    writeMissed(env);
  }
  return existed;
}

export function listRuns(wid: string, limit = 50, env: NodeJS.ProcessEnv = process.env): WorkflowRun[] {
  ensureLoaded(env);
  const runs = state.runs.get(wid) ?? [];
  return runs.slice(-limit).reverse();
}

export function listAllRuns(limit = 200, env: NodeJS.ProcessEnv = process.env): WorkflowRun[] {
  ensureLoaded(env);
  const flat: WorkflowRun[] = [];
  for (const arr of state.runs.values()) flat.push(...arr);
  flat.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return flat.slice(0, limit);
}

export function recordRun(run: WorkflowRun, env: NodeJS.ProcessEnv = process.env): WorkflowRun {
  ensureDirs(env);
  let arr = state.runs.get(run.workflow_id);
  if (!arr) {
    arr = [];
    state.runs.set(run.workflow_id, arr);
  }
  const idx = arr.findIndex((r) => r.id === run.id);
  if (idx >= 0) arr[idx] = run;
  else arr.push(run);
  if (arr.length > RUNS_PER_WORKFLOW) arr.splice(0, arr.length - RUNS_PER_WORKFLOW);
  atomicWriteJson(runsFilePath(run.workflow_id, env), arr);
  return run;
}

export function getPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  ensureLoaded(env);
  return state.paused;
}

export function setPaused(value: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  ensureDirs(env);
  state.paused = value;
  atomicWriteJson(pausedFilePath(env), { paused: state.paused });
  return state.paused;
}

function writeMissed(env: NodeJS.ProcessEnv): void {
  atomicWriteJson(missedFilePath(env), state.missed);
}

export function listMissed(env: NodeJS.ProcessEnv = process.env): MissedRun[] {
  ensureLoaded(env);
  return [...state.missed];
}

export function addMissed(run: MissedRun, env: NodeJS.ProcessEnv = process.env): MissedRun {
  ensureLoaded(env);
  ensureDirs(env);
  state.missed.push(run);
  if (state.missed.length > MAX_MISSED) {
    state.missed.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
    state.missed.splice(0, state.missed.length - MAX_MISSED);
  }
  writeMissed(env);
  return run;
}

export function removeMissed(ids: string[], env: NodeJS.ProcessEnv = process.env): void {
  ensureLoaded(env);
  ensureDirs(env);
  const drop = new Set(ids);
  state.missed = state.missed.filter((m) => !drop.has(m.id));
  writeMissed(env);
}

export function updateRun(runId: string, fields: Partial<WorkflowRun>, env: NodeJS.ProcessEnv = process.env): WorkflowRun | null {
  ensureLoaded(env);
  for (const arr of state.runs.values()) {
    const idx = arr.findIndex((r) => r.id === runId);
    if (idx >= 0) {
      const updated = { ...arr[idx], ...fields };
      arr[idx] = updated;
      atomicWriteJson(runsFilePath(updated.workflow_id, env), arr);
      return updated;
    }
  }
  return null;
}

/** Test-only escape hatch: forces the next accessor to reload from disk. Production code never
 * needs this (the cache is meant to stay warm for the process lifetime); a vitest suite that
 * switches MAESTRO_DATA_ROOT between cases needs it so the module-level cache doesn't leak
 * workflows from a previous test's throwaway directory. */
export function resetCacheForTest(): void {
  state.workflows.clear();
  state.runs.clear();
  state.missed = [];
  state.paused = false;
  state.loaded = false;
}
