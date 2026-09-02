// engine/src/apps/workflows/audit.test.ts -- SUB-7's vitest twin of
// backend/tests/test_workflows_semantics.py's audit-log cases.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as audit from './audit';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-workflows-audit-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

describe('logChange / readTail', () => {
  test('records a field diff', () => {
    audit.logChange('wf-1', 'user', { title: 'old' }, { title: 'new' });
    const entries = audit.readTail('wf-1', 10);
    expect(entries.length).toBe(1);
    const diff = entries[0].diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.title.before).toBe('old');
    expect(diff.title.after).toBe('new');
  });

  test('is a no-op when nothing changed', () => {
    audit.logChange('wf-2', 'user', { title: 'same' }, { title: 'same' });
    expect(audit.readTail('wf-2')).toEqual([]);
  });

  test('newest entry reads first (read_tail reverses)', () => {
    audit.logChange('wf-3', 'user', { title: 'a' }, { title: 'b' });
    audit.logChange('wf-3', 'user', { title: 'b' }, { title: 'c' });
    const entries = audit.readTail('wf-3', 10);
    expect(entries.length).toBe(2);
    expect((entries[0].diff as Record<string, { after: unknown }>).title.after).toBe('c');
    expect((entries[1].diff as Record<string, { after: unknown }>).title.after).toBe('b');
  });
});
