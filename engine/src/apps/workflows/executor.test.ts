// engine/src/apps/workflows/executor.test.ts -- SUB-7's vitest twin of
// backend/tests/test_workflows_semantics.py's executor-merge / delete-during-run / cost-cap /
// stuck-run-reaper cases (the ones that don't need a live agent turn -- the real end-to-end drive
// through `execute()` with MAESTRO_MOCK_AGENT=1 lives in http.test.ts's `/run` case instead, since
// that's exercised through the real HTTP surface this ticket's gate asks for).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as executor from './executor';
import * as scheduler from './scheduler';
import { newWorkflow, newWorkflowRun } from './models';
import * as storage from './store';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-workflows-executor-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  storage.resetCacheForTest();
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  storage.resetCacheForTest();
  scheduler.resetForTest();
});

function makeWf(overrides: Partial<ReturnType<typeof newWorkflow>> = {}) {
  return { ...newWorkflow(), title: 't-orig', ...overrides };
}

describe('persistRunFields', () => {
  test('does not clobber fields a concurrent PATCH changed mid-run', () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    // Simulate a user PATCH landing while the (stale, captured-before-patch) `wf` reference is
    // still what the executor holds.
    const live = storage.getWorkflow(wf.id)!;
    live.title = 't-patched';
    live.description = 'patched while running';
    storage.saveWorkflow(live);

    executor.persistRunFields(wf, { last_run_at: new Date().toISOString(), last_run_status: 'success' });
    const after = storage.getWorkflow(wf.id)!;
    expect(after.title).toBe('t-patched');
    expect(after.description).toBe('patched while running');
    expect(after.last_run_status).toBe('success');
  });

  test('silently no-ops when the workflow was deleted mid-run (does not resurrect it)', () => {
    const wf = makeWf({ title: 'doomed' });
    storage.saveWorkflow(wf);
    storage.deleteWorkflow(wf.id);
    executor.persistRunFields(wf, { last_run_at: new Date().toISOString(), last_run_status: 'success' }, 1);
    expect(storage.getWorkflow(wf.id)).toBeNull();
  });
});

describe('stuck-run reaper', () => {
  test('a run left "running" across a restart gets a friendly, non-jargon failure message', async () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    storage.recordRun(newWorkflowRun({ workflow_id: wf.id, status: 'running' }));
    // start() runs markStuckRunsFailed() + reconcileOnStartup() synchronously before returning
    // (see scheduler.ts's own header on why this engine starts the scheduler lazily rather than
    // at process lifespan); stop() right after so no background loop survives the test.
    await scheduler.start();
    const runs = storage.listRuns(wf.id, 10);
    expect(runs.some((r) => r.status === 'failure' && (r.error ?? '').includes('Interrupted') && (r.error ?? '').includes('shut down'))).toBe(true);
    expect(runs.some((r) => (r.error ?? '').includes('Killed by restart'))).toBe(false);
    await scheduler.stop();
  });
});

describe('cost cap', () => {
  test('execute() short-circuits to skipped with a clear error when the monthly cap is already spent', async () => {
    const wf = makeWf({ title: 'cap-immediate', cost_cap_usd_monthly: 0.01 });
    storage.saveWorkflow(wf);
    storage.recordRun(newWorkflowRun({
      workflow_id: wf.id,
      status: 'success',
      cost_usd: 5.0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    }));
    const run = await executor.execute(wf, { triggeredBy: 'manual' });
    expect(run.status).toBe('skipped');
    expect((run.error ?? '').toLowerCase()).toContain('cost cap');
  });
});
