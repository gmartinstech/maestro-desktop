// engine/src/apps/workflows/scheduler.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/scheduler.py: the in-process cron-style scheduler (recurrence math, the
// wake-on-next-due-boundary loop, and startup missed-fire reconciliation).
//
// Wall-clock math runs in the workflow's IANA timezone via luxon (already an engine dependency,
// see engine/package.json), then converts to UTC at the boundary -- the only safe way to honor DST,
// exactly like the Python original's zoneinfo-based math. luxon's `DateTime.weekday` is ISO
// (Monday=1..Sunday=7); this file converts to the JS/wire convention (Sunday=0..Saturday=6) at
// every read, mirroring scheduler.py's own `_js_weekday` helper so the on_days array keeps meaning
// the same thing on both sides of the migration.
//
// The tick loop (start/stop/kick) is a faithful port too. main.ts now starts it at process boot
// (gated on `workflows:native`, same convention as skills/tools/mcp-registry/outputs -- see its own
// comment there), matching Python's asyncio_lifespan starting it unconditionally when the workflows
// SubApp mounts. http.ts's own `ensureStarted()` on first request is kept as a second call site, not
// removed: start() is idempotent (see its own guard below), so whichever of the two runs first wins
// and the other is a no-op -- this keeps the scheduler live even for a caller that hits an
// /api/workflows/* route before main.ts's own gated call has run (e.g. a test that constructs its
// own Fastify server directly against http.ts, as this file's own http.test.ts does).

import { DateTime, Duration } from 'luxon';
import * as storage from './store';
import * as executor from './executor';
import { newMissedRun, type ScheduleConfig, type Workflow, type WorkflowRun } from './models';
import { newWorkflowRun } from './models';
import { resolveHostTzName } from './store';

// How many recent missed fires we keep reviewable per workflow -- mirrors PER_WORKFLOW_MISSED_CAP.
const PER_WORKFLOW_MISSED_CAP = 20;
// Bound on the per-workflow startup enumeration walk -- mirrors MISSED_ENUM_CAP.
const MISSED_ENUM_CAP = 480;

export function hostTimezoneName(env: NodeJS.ProcessEnv = process.env): string {
  return resolveHostTzName(env);
}

function resolveTz(tz: string, env: NodeJS.ProcessEnv): string {
  if (!tz || tz === 'local') return hostTimezoneName(env);
  const probe = DateTime.local().setZone(tz);
  return probe.isValid ? tz : hostTimezoneName(env);
}

/** Today's day-of-month in the given (or host-fallback) IANA zone -- used by http.ts's
 * _normalize_schedule_state port to pin a month schedule's day_of_month the first time it's
 * enabled without one. */
export function nowDayInTz(tz: string, env: NodeJS.ProcessEnv = process.env): number {
  return DateTime.utc().setZone(resolveTz(tz, env)).day;
}

/** Normalize an arbitrary stored ISO string (or null) to an aware-UTC luxon DateTime. A value with
 * no offset/`Z` is treated as host-local, matching storage._as_utc's "naive = host-local" stance
 * for legacy pre-timezone rows. */
function asUtc(value: string | null | undefined, env: NodeJS.ProcessEnv = process.env): DateTime | null {
  if (value == null) return null;
  const raw = value.trim();
  if (!raw) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const dt = hasOffset ? DateTime.fromISO(raw, { setZone: true }) : DateTime.fromISO(raw, { zone: hostTimezoneName(env) });
  return dt.isValid ? dt.toUTC() : null;
}

/** JS/wire weekday convention (Sun=0..Sat=6) from luxon's ISO weekday (Mon=1..Sun=7). */
function jsWeekday(d: DateTime): number {
  return d.weekday % 7;
}

function weekStart(d: DateTime): DateTime {
  return d.minus({ days: jsWeekday(d) }).startOf('day');
}

export function isScheduleConfigured(sched: ScheduleConfig): boolean {
  if (sched.repeat_unit === 'week') return sched.on_days.length > 0;
  return true;
}

/** First instant on the grid {anchor + k*step} strictly after ref -- mirrors p_first_after. */
function firstAfter(anchor: DateTime, ref: DateTime, step: Duration): DateTime {
  if (anchor > ref) return anchor;
  const stepMs = step.as('milliseconds');
  const n = Math.floor(ref.diff(anchor).as('milliseconds') / stepMs);
  return anchor.plus({ milliseconds: stepMs * (n + 1) });
}

function daysInMonth(year: number, month: number): number {
  return DateTime.local(year, month, 1).daysInMonth ?? 28;
}

function nextFireAfter(sched: ScheduleConfig, refUtc: DateTime, anchorUtc: DateTime | null, env: NodeJS.ProcessEnv): DateTime | null {
  if (!sched.enabled || !isScheduleConfigured(sched)) return null;
  const tz = resolveTz(sched.timezone, env);
  const refLocal = refUtc.setZone(tz);
  const base = refLocal.set({ second: 0, millisecond: 0 });
  const anchorLocal = (anchorUtc ?? refUtc).setZone(tz);

  if (sched.repeat_unit === 'minute') {
    const step = Math.max(15, sched.repeat_every);
    const grid = anchorLocal.set({ second: 0, millisecond: 0 });
    return firstAfter(grid, refLocal, Duration.fromObject({ minutes: step })).toUTC();
  }

  if (sched.repeat_unit === 'hour') {
    const step = Math.max(1, sched.repeat_every);
    const grid = anchorLocal.set({ minute: sched.minute, second: 0, millisecond: 0 });
    return firstAfter(grid, refLocal, Duration.fromObject({ hours: step })).toUTC();
  }

  let candidate = base.set({ hour: sched.hour, minute: sched.minute });

  if (sched.repeat_unit === 'day') {
    const step = Math.max(1, sched.repeat_every);
    while (candidate <= refLocal) candidate = candidate.plus({ days: step });
    return candidate.toUTC();
  }

  if (sched.repeat_unit === 'month') {
    const targetDay = sched.day_of_month ?? refLocal.day;
    const step = Math.max(1, sched.repeat_every);
    const monthDay = (year: number, month: number): number => {
      const last = daysInMonth(year, month);
      return sched.last_day_of_month ? last : Math.min(targetDay, last);
    };
    let c = candidate.set({ day: monthDay(candidate.year, candidate.month) });
    while (c <= refLocal) {
      const total = c.month - 1 + step;
      const year = c.year + Math.floor(total / 12);
      const month = (total % 12) + 1;
      c = c.set({ year, month, day: monthDay(year, month) });
    }
    return c.toUTC();
  }

  if (candidate <= refLocal) candidate = candidate.plus({ days: 1 });

  if (sched.repeat_unit === 'week') {
    const allowed = new Set(sched.on_days);
    const step = Math.max(1, sched.repeat_every);
    const anchorWeek = weekStart(anchorLocal);
    for (let i = 0; i < 7 * step + 7; i++) {
      const weekDelta = Math.floor(weekStart(candidate).diff(anchorWeek, 'days').days / 7);
      if (allowed.has(jsWeekday(candidate)) && candidate > refLocal && (weekDelta === 0 || weekDelta % step === 0)) {
        return candidate.toUTC();
      }
      candidate = candidate.plus({ days: 1 });
    }
    return candidate.toUTC();
  }

  return null;
}

export function computeNextFire(wf: Workflow, ref: string | null = null, env: NodeJS.ProcessEnv = process.env): string | null {
  const refUtc = ref !== null ? asUtc(ref, env) : DateTime.utc();
  const nxt = nextFireAfter(wf.schedule, refUtc ?? DateTime.utc(), asUtc(wf.created_at, env), env);
  return nxt ? nxt.toISO() : null;
}

/** Test-only direct access to the raw recurrence math, one level below computeNextFire's
 * Workflow-shaped wrapper -- mirrors backend/tests/test_workflows_semantics.py's own direct calls
 * to scheduler.py's `_next_fire_after` against a bare ScheduleConfig (no full Workflow needed). */
export function nextFireAfterForTest(sched: ScheduleConfig, refIso: string, anchorIso: string | null = null, env: NodeJS.ProcessEnv = process.env): string | null {
  const refUtc = asUtc(refIso, env);
  if (refUtc === null) return null;
  const nxt = nextFireAfter(sched, refUtc, anchorIso !== null ? asUtc(anchorIso, env) : null, env);
  return nxt ? nxt.toISO() : null;
}

/** Count fires from now through `days` days from now, honoring end conditions -- mirrors
 * fires_in_window. Caps the walk at 5000 fires. */
export function firesInWindow(wf: Workflow, days = 30, env: NodeJS.ProcessEnv = process.env): number {
  const sched = wf.schedule;
  if (!sched.enabled) return 0;
  if (sched.max_runs !== null && sched.runs_count >= sched.max_runs) return 0;
  let cursorUtc: DateTime = DateTime.utc();
  let endUtc: DateTime = cursorUtc.plus({ days });
  const endsAtUtc = asUtc(sched.ends_at, env);
  if (endsAtUtc !== null && endsAtUtc < endUtc) endUtc = endsAtUtc;
  const remainingBudget = sched.max_runs !== null ? sched.max_runs - sched.runs_count : 5000;
  const anchorUtc = asUtc(wf.created_at, env);
  let count = 0;
  const cap = Math.min(5000, remainingBudget);
  while (count < cap) {
    const nxt = nextFireAfter(sched, cursorUtc, anchorUtc, env);
    if (nxt === null || nxt > endUtc) break;
    count += 1;
    cursorUtc = nxt;
  }
  return count;
}

/** Scheduled fire instants in [fromUtc, toUtc) -- mirrors occurrences_between. Inputs/outputs are
 * ISO UTC strings. */
export function occurrencesBetween(wf: Workflow, fromIso: string, toIso: string, cap = 5000, env: NodeJS.ProcessEnv = process.env): string[] {
  const sched = wf.schedule;
  if (!sched.enabled || !isScheduleConfigured(sched)) return [];
  if (sched.max_runs !== null && sched.runs_count >= sched.max_runs) return [];
  const startUtc = asUtc(fromIso, env);
  let endUtc = asUtc(toIso, env);
  if (startUtc === null || endUtc === null || endUtc <= startUtc) return [];

  const createdAt = asUtc(wf.created_at, env);
  let cursorUtc = startUtc.minus({ milliseconds: 1 });
  if (createdAt !== null && createdAt > cursorUtc) cursorUtc = createdAt;

  const endsAt = asUtc(sched.ends_at, env);
  if (endsAt !== null) {
    if (endsAt <= startUtc) return [];
    if (endsAt < endUtc) endUtc = endsAt;
  }

  const remaining = sched.max_runs !== null ? sched.max_runs - sched.runs_count : cap;
  const limit = Math.max(0, Math.min(cap, remaining));
  const out: string[] = [];
  while (out.length < limit) {
    const nxt = nextFireAfter(sched, cursorUtc, createdAt, env);
    if (nxt === null || nxt >= endUtc) break;
    if (nxt >= startUtc) out.push(nxt.toUTC().toISO() ?? '');
    cursorUtc = nxt;
  }
  return out;
}

// -- tick loop ------------------------------------------------------------------------------

let wakeResolve: (() => void) | null = null;

export function kick(): void {
  if (wakeResolve) {
    const r = wakeResolve;
    wakeResolve = null;
    r();
  }
}

function endConditionHit(wf: Workflow, nowUtc: DateTime, env: NodeJS.ProcessEnv): boolean {
  const s = wf.schedule;
  const endsAt = asUtc(s.ends_at, env);
  if (endsAt !== null && nowUtc >= endsAt) return true;
  if (s.max_runs !== null && s.runs_count >= s.max_runs) return true;
  return false;
}

function disableSchedule(wf: Workflow, env: NodeJS.ProcessEnv): void {
  wf.schedule = { ...wf.schedule, enabled: false };
  wf.next_run_at = null;
  storage.saveWorkflow(wf, env);
}

export function recordSkipped(wf: Workflow, scheduledFor: string, error: string, env: NodeJS.ProcessEnv = process.env): WorkflowRun {
  const now = new Date().toISOString();
  const run = newWorkflowRun({
    workflow_id: wf.id,
    status: 'skipped',
    scheduled_for: scheduledFor,
    started_at: now,
    finished_at: now,
    triggered_by: 'schedule',
    error,
  });
  storage.recordRun(run, env);
  wf.last_run_at = now;
  wf.last_run_status = 'skipped';
  wf.last_run_id = run.id;
  storage.saveWorkflow(wf, env);
  return run;
}

function captureMissed(wf: Workflow, missed: string[], env: NodeJS.ProcessEnv): void {
  if (missed.length === 0) return;
  const recent = missed.slice(-PER_WORKFLOW_MISSED_CAP);
  const older = missed.slice(0, missed.length - recent.length);
  if (older.length > 0) {
    const suffix = missed.length >= MISSED_ENUM_CAP ? '+' : '';
    recordSkipped(wf, older[0], `Skipped ${older.length}${suffix} earlier missed runs while Maestro was closed`, env);
  }
  for (const sf of recent) storage.addMissed(newMissedRun(wf.id, sf), env);
}

export async function runMissedSequence(wf: Workflow, scheduledFors: string[]): Promise<void> {
  for (const sf of scheduledFors) {
    try {
      await executor.execute(wf, { triggeredBy: 'schedule', scheduledFor: sf });
    } catch (err) {
      console.error(`[workflows] missed-run fire failed for workflow=${wf.id}`, err);
    }
  }
}

/** Walk persisted workflows once and capture fires missed while closed -- mirrors
 * reconcile_on_startup. Rolls next_run_at forward so a repeat call (e.g. dev hot-reload, or this
 * engine's own lazy ensureStarted()) doesn't re-enumerate the same misses. */
export function reconcileOnStartup(env: NodeJS.ProcessEnv = process.env): void {
  const nowUtc = DateTime.utc();
  for (const wf of storage.listWorkflows(env)) {
    if (!wf.schedule.enabled) {
      wf.next_run_at = null;
      storage.saveWorkflow(wf, env);
      continue;
    }
    if (!isScheduleConfigured(wf.schedule)) {
      disableSchedule(wf, env);
      continue;
    }
    if (endConditionHit(wf, nowUtc, env)) {
      disableSchedule(wf, env);
      continue;
    }
    const anchor = asUtc(wf.next_run_at, env);
    if (anchor !== null && anchor <= nowUtc) {
      const missed = occurrencesBetween(wf, anchor.toISO() ?? '', nowUtc.toISO() ?? '', MISSED_ENUM_CAP, env);
      captureMissed(wf, missed, env);
    }
    const nxt = nextFireAfter(wf.schedule, nowUtc, asUtc(wf.created_at, env), env);
    wf.next_run_at = nxt ? nxt.toISO() : null;
    storage.saveWorkflow(wf, env);
  }
}

/** Any run marked 'running' that survives a process restart is dead (its owning loop is gone) --
 * mirrors _mark_stuck_runs_failed. */
function markStuckRunsFailed(env: NodeJS.ProcessEnv): void {
  const now = new Date().toISOString();
  for (const wf of storage.listWorkflows(env)) {
    for (const r of storage.listRuns(wf.id, 200, env)) {
      if (r.status === 'running') {
        storage.updateRun(r.id, {
          status: 'failure',
          error: 'Interrupted: Maestro or your computer shut down before this run finished.',
          finished_at: now,
        }, env);
        if (wf.last_run_id === r.id && wf.last_run_status === 'running') {
          executor.persistRunFields(wf, { last_run_status: 'failure', last_run_at: now }, 0, env);
        }
      }
    }
  }
}

async function fire(wf: Workflow, scheduledFor: string | null, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await executor.execute(wf, { triggeredBy: 'schedule', scheduledFor: scheduledFor ?? undefined }, env);
  } catch (err) {
    console.error(`[workflows] scheduler fire failed for workflow=${wf.id}`, err);
  }
}

/** Test-only direct access to one tick, without spinning up the background loop -- mirrors
 * backend/tests/test_workflows_semantics.py's own direct `scheduler._tick()` calls. */
export async function tickForTest(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return tick(env);
}

async function tick(env: NodeJS.ProcessEnv): Promise<void> {
  const nowUtc = DateTime.utc();
  if (storage.getPaused(env)) return;
  const due: Workflow[] = [];
  for (const wf of storage.listWorkflows(env)) {
    if (!wf.schedule.enabled) continue;
    if (!isScheduleConfigured(wf.schedule)) {
      disableSchedule(wf, env);
      continue;
    }
    if (endConditionHit(wf, nowUtc, env)) {
      disableSchedule(wf, env);
      continue;
    }
    const nra = asUtc(wf.next_run_at, env);
    if (nra !== null && nra <= nowUtc) due.push(wf);
  }
  for (const wf of due) {
    const scheduledFor = asUtc(wf.next_run_at, env);
    const nxt = nextFireAfter(wf.schedule, nowUtc, asUtc(wf.created_at, env), env);
    wf.next_run_at = nxt ? nxt.toISO() : null;
    storage.saveWorkflow(wf, env);
    void fire(wf, scheduledFor ? (scheduledFor.toISO() ?? null) : null, env);
  }
}

function secondsUntilNext(env: NodeJS.ProcessEnv): number {
  if (storage.getPaused(env)) return 60.0;
  const nowUtc = DateTime.utc();
  let soonest: DateTime | null = null;
  for (const wf of storage.listWorkflows(env)) {
    if (!wf.schedule.enabled) continue;
    const nra = asUtc(wf.next_run_at, env);
    if (nra === null) continue;
    if (soonest === null || nra < soonest) soonest = nra;
  }
  if (soonest === null) return 60.0;
  const delta = soonest.diff(nowUtc).as('seconds');
  return Math.max(1.0, Math.min(delta, 60.0));
}

function waitForWakeOrTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      wakeResolve = null;
      resolve();
    }, ms);
    timer.unref?.();
    wakeResolve = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
  });
}

async function loop(handle: { stopped: boolean }, env: NodeJS.ProcessEnv): Promise<void> {
  while (!handle.stopped) {
    try {
      await tick(env);
    } catch (err) {
      console.error('[workflows] scheduler tick error', err);
    }
    if (handle.stopped) return;
    await waitForWakeOrTimeout(secondsUntilNext(env) * 1000);
  }
}

let runningHandle: { stopped: boolean } | null = null;
let runningPromise: Promise<void> | null = null;

/** Idempotent: a second call while already started is a no-op, mirroring scheduler.start()'s own
 * `if _loop_task is not None: return` guard. */
export async function start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (runningHandle !== null) return;
  markStuckRunsFailed(env);
  reconcileOnStartup(env);
  const handle = { stopped: false };
  runningHandle = handle;
  runningPromise = loop(handle, env);
}

export async function stop(): Promise<void> {
  if (runningHandle === null) return;
  runningHandle.stopped = true;
  kick();
  try {
    await runningPromise;
  } catch {
    // Best-effort, mirrors the Python original's swallow-on-cancel.
  }
  runningHandle = null;
  runningPromise = null;
}

/** Test-only escape hatch: forces the next start() to actually (re)start the loop. Production code
 * never needs this -- the loop is meant to stay running for the process lifetime. */
export function resetForTest(): void {
  runningHandle = null;
  runningPromise = null;
  wakeResolve = null;
}

/** Snapshot of currently-running workflow runs -- mirrors list_active, joining executor's
 * workflow_id -> run_id map against the workflow cache for titles. */
export function listActive(env: NodeJS.ProcessEnv = process.env): Array<{ workflow_id: string; run_id: string; title: string; started_at: string | null }> {
  const out: Array<{ workflow_id: string; run_id: string; title: string; started_at: string | null }> = [];
  for (const [wid, runId] of executor.runningSnapshot()) {
    const wf = storage.getWorkflow(wid, env);
    const title = wf ? wf.title : '';
    let startedAt: string | null = null;
    if (wf) {
      for (const r of storage.listRuns(wid, 10, env)) {
        if (r.id === runId) {
          startedAt = r.started_at;
          break;
        }
      }
    }
    out.push({ workflow_id: wid, run_id: runId, title, started_at: startedAt });
  }
  return out;
}
