// engine/src/apps/workflows/store.test.ts -- SUB-7's vitest twin of
// backend/tests/test_workflows_storage.py: storage durability (the crash-safe write path and the
// bounded caches). atomicWriteJson itself is settings/store.ts's own port (ENG-3, already tested
// there); this file's atomic-write case exercises it through store.ts's saveWorkflow call, same
// spirit as the Python original's direct storage.p_atomic_write_json call.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { newMissedRun, newWorkflow, newWorkflowRun } from './models';
import * as storage from './store';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-workflows-storage-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  storage.resetCacheForTest();
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  storage.resetCacheForTest();
});

function makeWf(overrides: Partial<ReturnType<typeof newWorkflow>> = {}) {
  return { ...newWorkflow(), ...overrides };
}

describe('atomic write (via saveWorkflow)', () => {
  test('round-trips a workflow record to disk', () => {
    const wf = makeWf({ title: 'roundtrip' });
    storage.saveWorkflow(wf);
    const onDisk = JSON.parse(readFileSync(join(storage.workflowsDir(), `${wf.id}.json`), 'utf8'));
    expect(onDisk.title).toBe('roundtrip');
  });

  test('leaves no .tmp sibling behind', () => {
    const wf = makeWf({ title: 'clean' });
    storage.saveWorkflow(wf);
    const leftovers = readdirSync(storage.workflowsDir()).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('corrupt-record resilience', () => {
  test('a corrupt workflow record is skipped, not fatal', () => {
    const good = makeWf({ title: 'good' });
    storage.saveWorkflow(good);
    writeFileSync(join(storage.workflowsDir(), 'broken.json'), '{"id": "broken", "title": "trunc', 'utf8');
    storage.resetCacheForTest();
    const ids = new Set(storage.listWorkflows().map((w) => w.id));
    expect(ids.has(good.id)).toBe(true);
    expect(ids.has('broken')).toBe(false);
  });

  test('a corrupt runs file yields empty history', () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    storage.recordRun(newWorkflowRun({ workflow_id: wf.id, status: 'success' }));
    const runsDir = join(storage.workflowsDir(), 'runs');
    writeFileSync(join(runsDir, `${wf.id}.json`), 'not json at all', 'utf8');
    storage.resetCacheForTest();
    expect(storage.listRuns(wf.id)).toEqual([]);
  });
});

describe('bounded caches', () => {
  test('missed cache is capped to the newest by scheduled_for', () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const total = 225; // MAX_MISSED (200) + 25
    for (let i = 0; i < total; i++) {
      storage.addMissed(newMissedRun(wf.id, new Date(base + i * 60_000).toISOString()));
    }
    const kept = storage.listMissed();
    expect(kept.length).toBe(200);
    const earliest = kept.reduce((min, m) => (m.scheduled_for < min ? m.scheduled_for : min), kept[0].scheduled_for);
    expect(earliest).toBe(new Date(base + 25 * 60_000).toISOString());
  });

  test('run history is bounded per workflow', () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    const over = 210; // RUNS_PER_WORKFLOW (200) + 10
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < over; i++) {
      storage.recordRun(newWorkflowRun({
        workflow_id: wf.id,
        status: 'success',
        started_at: new Date(base + i * 60_000).toISOString(),
      }));
    }
    expect(storage.listRuns(wf.id, 1000).length).toBe(200);
  });
});

describe('legacy timezone coercion on load -- mirrors test_legacy_timezone_coerced_on_load', () => {
  test('an on-disk "local" timezone loads as the host zone in memory, but the file is left unchanged', () => {
    const originalTz = process.env.MAESTRO_TIMEZONE;
    process.env.MAESTRO_TIMEZONE = 'America/Los_Angeles';
    try {
      const wf = makeWf({ id: 'legacy-wf', title: 'legacy', schedule: { ...makeWf().schedule, timezone: 'local' } });
      storage.saveWorkflow(wf);
      storage.resetCacheForTest();
      const loaded = storage.getWorkflow('legacy-wf');
      expect(loaded).not.toBeNull();
      expect(loaded!.schedule.timezone).toBe('America/Los_Angeles');
      const onDisk = JSON.parse(readFileSync(join(storage.workflowsDir(), 'legacy-wf.json'), 'utf8'));
      expect(onDisk.schedule.timezone).toBe('local');
    } finally {
      if (originalTz === undefined) delete process.env.MAESTRO_TIMEZONE;
      else process.env.MAESTRO_TIMEZONE = originalTz;
    }
  });
});

describe('paused flag + missed/run accessors', () => {
  test('getPaused/setPaused persists across a cache reset', () => {
    expect(storage.getPaused()).toBe(false);
    storage.setPaused(true);
    storage.resetCacheForTest();
    expect(storage.getPaused()).toBe(true);
  });

  test('deleteWorkflow removes the on-disk record and its runs', () => {
    const wf = makeWf();
    storage.saveWorkflow(wf);
    storage.recordRun(newWorkflowRun({ workflow_id: wf.id, status: 'success' }));
    expect(storage.deleteWorkflow(wf.id)).toBe(true);
    expect(existsSync(join(storage.workflowsDir(), `${wf.id}.json`))).toBe(false);
    expect(storage.getWorkflow(wf.id)).toBeNull();
  });
});
