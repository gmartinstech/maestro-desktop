// engine/src/apps/workflows/scheduler.test.ts -- SUB-7's vitest twin of a representative subset of
// backend/tests/test_workflows_semantics.py's scheduler-math cases: DST-safe wall-clock recurrence
// (spring forward + fall back), month/day/week interval math, end-condition auto-disable, the
// bi-weekly created_at-anchored phase stability, calendar occurrences, and ran_late/frozen-tools.
// Not a line-for-line port of that file's full 890 lines (docs/plans/txm-status.md's SUB-7 row
// names the exact subset ported vs. not) -- this covers the recurrence engine's own correctness,
// which is the highest-value, most fiddly-to-get-right part scheduler.ts ports.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ranLate, resolveAllowedTools } from './executor';
import { newWorkflow, coerceScheduleConfig, type ScheduleConfig } from './models';
import * as scheduler from './scheduler';
import * as storage from './store';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-workflows-scheduler-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  storage.resetCacheForTest();
  scheduler.resetForTest();
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  storage.resetCacheForTest();
  scheduler.resetForTest();
});

function utcIso(y: number, mo: number, d: number, h: number, mi: number, zone = 'utc'): string {
  return (zone === 'utc' ? DateTime.utc(y, mo, d, h, mi) : DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi }, { zone }).toUTC()).toISO()!;
}

function makeWf(overrides: Partial<ReturnType<typeof newWorkflow>> = {}) {
  return { ...newWorkflow(), title: 't', ...overrides };
}

describe('DST-safe recurrence', () => {
  test('spring forward: a 2:30am LA weekly-Sunday schedule lands on the 9th, wall-clock resolved forward', () => {
    const sched: ScheduleConfig = coerceScheduleConfig({ enabled: true, repeat_unit: 'week', repeat_every: 1, on_days: [0], hour: 2, minute: 30, timezone: 'America/Los_Angeles' });
    const ref = utcIso(2025, 3, 8, 23, 0, 'America/Los_Angeles');
    const nxt = scheduler.nextFireAfterForTest(sched, ref);
    expect(nxt).not.toBeNull();
    const nxtLocal = DateTime.fromISO(nxt!).setZone('America/Los_Angeles');
    expect(nxtLocal.toISODate()).toBe('2025-03-09');
    expect([2, 3]).toContain(nxtLocal.hour);
  });

  test('fall back: a 9am LA daily schedule fires exactly once on the fall-back day, next fire is the 3rd', () => {
    const sched: ScheduleConfig = coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'America/Los_Angeles' });
    const ref = utcIso(2025, 11, 1, 23, 0, 'America/Los_Angeles');
    const nxt = scheduler.nextFireAfterForTest(sched, ref);
    expect(DateTime.fromISO(nxt!).setZone('America/Los_Angeles').toISODate()).toBe('2025-11-02');
    const after = scheduler.nextFireAfterForTest(sched, nxt!);
    expect(DateTime.fromISO(after!).setZone('America/Los_Angeles').toISODate()).toBe('2025-11-03');
  });

  test('an unconfigured weekly schedule (no on_days) has no next fire', () => {
    const sched: ScheduleConfig = coerceScheduleConfig({ enabled: true, repeat_unit: 'week', repeat_every: 1, on_days: [], hour: 9, minute: 0, timezone: 'America/Los_Angeles' });
    expect(scheduler.nextFireAfterForTest(sched, utcIso(2026, 6, 17, 8, 0))).toBeNull();
  });
});

describe('reconcile / tick auto-disable', () => {
  test('reconcile disables an enabled weekly schedule with no on_days', () => {
    const wf = makeWf({ schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'week', repeat_every: 1, on_days: [], hour: 9, minute: 0, timezone: 'America/Los_Angeles' }) });
    wf.next_run_at = DateTime.utc().plus({ days: 1 }).toISO();
    storage.saveWorkflow(wf);
    scheduler.reconcileOnStartup();
    const after = storage.getWorkflow(wf.id)!;
    expect(after.schedule.enabled).toBe(false);
    expect(after.next_run_at).toBeNull();
  });

  test('a tick disables a schedule that hit max_runs', async () => {
    const wf = makeWf({ schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'UTC', max_runs: 2, runs_count: 2 }) });
    wf.next_run_at = DateTime.utc().minus({ minutes: 1 }).toISO();
    storage.saveWorkflow(wf);
    await scheduler.tickForTest();
    const after = storage.getWorkflow(wf.id)!;
    expect(after.schedule.enabled).toBe(false);
    expect(after.next_run_at).toBeNull();
  });

  test('a tick disables a schedule that hit ends_at', async () => {
    const wf = makeWf({ schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'UTC', ends_at: DateTime.utc().minus({ days: 1 }).toISO() }) });
    wf.next_run_at = DateTime.utc().minus({ minutes: 1 }).toISO();
    storage.saveWorkflow(wf);
    await scheduler.tickForTest();
    expect(storage.getWorkflow(wf.id)!.schedule.enabled).toBe(false);
  });
});

describe('month/day/week interval math', () => {
  test('month repeat no longer clamps to 28: March 31 -> April 30 -> (May 31 continues later)', () => {
    const sched = coerceScheduleConfig({ enabled: true, repeat_unit: 'month', repeat_every: 1, hour: 9, minute: 0, timezone: 'America/Los_Angeles' });
    const ref = utcIso(2025, 3, 31, 10, 0, 'America/Los_Angeles');
    const nxt = scheduler.nextFireAfterForTest(sched, ref);
    expect(DateTime.fromISO(nxt!).setZone('America/Los_Angeles').toISODate()).toBe('2025-04-30');
  });

  test('month repeat can pin the first day', () => {
    const sched = coerceScheduleConfig({ enabled: true, repeat_unit: 'month', repeat_every: 1, day_of_month: 1, hour: 9, minute: 0, timezone: 'America/Los_Angeles' });
    const ref = utcIso(2025, 6, 20, 10, 0, 'America/Los_Angeles');
    const nxt = scheduler.nextFireAfterForTest(sched, ref);
    expect(DateTime.fromISO(nxt!).setZone('America/Los_Angeles').toISODate()).toBe('2025-07-01');
  });

  test('month repeat_every respects the interval after a clamped day', () => {
    const sched = coerceScheduleConfig({ enabled: true, repeat_unit: 'month', repeat_every: 2, day_of_month: 31, hour: 9, minute: 0, timezone: 'UTC' });
    const nxt = scheduler.nextFireAfterForTest(sched, utcIso(2025, 1, 31, 9, 0));
    expect(nxt).toBe(utcIso(2025, 3, 31, 9, 0));
  });

  test('daily repeat_every skips by the interval', () => {
    const sched = coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 3, hour: 9, minute: 0, timezone: 'UTC' });
    const nxt = scheduler.nextFireAfterForTest(sched, utcIso(2026, 6, 20, 9, 0));
    expect(nxt).toBe(utcIso(2026, 6, 23, 9, 0));
  });

  test('weekly repeat_every skips inactive weeks', () => {
    const sched = coerceScheduleConfig({ enabled: true, repeat_unit: 'week', repeat_every: 2, on_days: [1], hour: 9, minute: 0, timezone: 'UTC' });
    const nxt = scheduler.nextFireAfterForTest(sched, utcIso(2026, 6, 22, 9, 0));
    expect(nxt).toBe(utcIso(2026, 7, 6, 9, 0));
  });

  test('bi-weekly phase is stable across recompute, anchored to created_at not the recompute moment', () => {
    const wf = makeWf({
      created_at: utcIso(2026, 6, 8, 0, 0),
      schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'week', repeat_every: 2, on_days: [1], hour: 9, minute: 0, timezone: 'UTC' }),
    });
    expect(scheduler.computeNextFire(wf, utcIso(2026, 6, 23, 0, 0))).toBe(utcIso(2026, 7, 6, 9, 0));
    expect(scheduler.computeNextFire(wf, utcIso(2026, 6, 30, 0, 0))).toBe(utcIso(2026, 7, 6, 9, 0));
    expect(scheduler.computeNextFire(wf, utcIso(2026, 6, 16, 0, 0))).toBe(utcIso(2026, 6, 22, 9, 0));
  });
});

describe('calendar occurrences', () => {
  test('occurrences use the schedule timezone, not a viewer timezone', () => {
    const wf = makeWf({
      created_at: utcIso(2026, 1, 1, 0, 0),
      schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'America/New_York' }),
    });
    const fires = scheduler.occurrencesBetween(wf, utcIso(2026, 6, 18, 0, 0), utcIso(2026, 6, 20, 0, 0));
    expect(fires.length).toBe(2);
    expect(DateTime.fromISO(fires[0]).setZone('America/New_York').hour).toBe(9);
    expect(DateTime.fromISO(fires[0]).setZone('America/Los_Angeles').hour).toBe(6);
  });

  test('occurrences stay wall-clock across a DST boundary', () => {
    const wf = makeWf({
      created_at: utcIso(2025, 1, 1, 0, 0),
      schedule: coerceScheduleConfig({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'America/New_York' }),
    });
    const fires = scheduler.occurrencesBetween(wf, utcIso(2025, 3, 8, 0, 0), utcIso(2025, 3, 11, 0, 0));
    const locals = fires.map((f) => DateTime.fromISO(f).setZone('America/New_York'));
    expect(locals.map((d) => d.toISODate())).toEqual(['2025-03-08', '2025-03-09', '2025-03-10']);
    expect(locals.every((d) => d.hour === 9 && d.minute === 0)).toBe(true);
    expect(fires.map((f) => DateTime.fromISO(f, { setZone: true }).toUTC().hour)).toEqual([14, 13, 13]);
  });

  test('occurrences honor end conditions (max_runs, ends_at) and enabled/on_days gates', () => {
    const start = utcIso(2026, 6, 18, 0, 0);
    const end = utcIso(2026, 6, 22, 0, 0);
    const wf = makeWf({
      created_at: utcIso(2026, 1, 1, 0, 0),
      schedule: coerceScheduleConfig({
        enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0, timezone: 'UTC',
        max_runs: 3, runs_count: 1, ends_at: utcIso(2026, 6, 21, 0, 0),
      }),
    });
    const fires = scheduler.occurrencesBetween(wf, start, end);
    expect(fires.map((f) => DateTime.fromISO(f).toISODate())).toEqual(['2026-06-18', '2026-06-19']);

    wf.schedule = { ...wf.schedule, enabled: false };
    expect(scheduler.occurrencesBetween(wf, start, end)).toEqual([]);

    wf.schedule = { ...wf.schedule, enabled: true, repeat_unit: 'week', on_days: [] };
    expect(scheduler.occurrencesBetween(wf, start, end)).toEqual([]);
  });
});

describe('ran_late + frozen tools (executor helpers)', () => {
  test('ran_late is measured from start, not finish', () => {
    const slot = utcIso(2026, 6, 22, 9, 0);
    expect(ranLate(slot, slot)).toBe(false);
    expect(ranLate(DateTime.fromISO(slot).plus({ minutes: 4 }).toISO()!, slot)).toBe(false);
    expect(ranLate(DateTime.fromISO(slot).plus({ minutes: 6 }).toISO()!, slot)).toBe(true);
  });

  test('a frozen empty tool set does not fall back to the defaults', () => {
    const wf = makeWf({ actions: { prevent_unused: false, freeze: true, configured_sets: [] } });
    expect(resolveAllowedTools(wf)).toEqual([]);
  });
});

describe('list_active reflects the executor running map', () => {
  // A real in-flight run (executor.execute() actually claiming the workflow) is covered by
  // http.test.ts's end-to-end `/run` + `/active` case, which drives a real (mock-agent) turn --
  // this case only pins the empty-state shape so a regression that breaks the join itself (not
  // just the "nothing running" case) still has SOME direct coverage here.
  test('is empty when nothing is running', () => {
    expect(scheduler.listActive()).toEqual([]);
  });
});
