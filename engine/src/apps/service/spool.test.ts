import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { acknowledge, clear, count, drain, enqueue, P_MAX_BYTES } from './spool';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-service-spool-'));
  path = join(dir, 'spool.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('service spool', () => {
  test('count is 0 when the file does not exist yet', () => {
    expect(count(path)).toBe(0);
  });

  test('enqueue then drain returns entries oldest-first, with monotonic ids', () => {
    enqueue(path, 's:/a', { n: 1 });
    enqueue(path, 's:/a', { n: 2 });
    const entries = drain(path, 10);
    expect(entries.map((e) => e.payload)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(entries[0]!.id).toBeLessThan(entries[1]!.id);
  });

  test('drain respects batchSize', () => {
    for (let i = 0; i < 5; i++) enqueue(path, 's:/a', { n: i });
    expect(drain(path, 2)).toHaveLength(2);
  });

  test('acknowledge removes exactly the given ids, leaving the rest', () => {
    enqueue(path, 's:/a', { n: 1 });
    enqueue(path, 's:/a', { n: 2 });
    const [first, second] = drain(path, 2);
    acknowledge(path, [first!.id]);
    expect(count(path)).toBe(1);
    expect(drain(path, 10)[0]!.payload).toEqual(second!.payload);
  });

  test('acknowledge with an empty list is a no-op', () => {
    enqueue(path, 's:/a', { n: 1 });
    acknowledge(path, []);
    expect(count(path)).toBe(1);
  });

  test('clear empties the spool', () => {
    enqueue(path, 's:/a', { n: 1 });
    clear(path);
    expect(count(path)).toBe(0);
  });

  test('a corrupt spool file is treated as empty rather than throwing', () => {
    enqueue(path, 's:/a', { n: 1 }); // creates the dir
    writeFileSync(path, '{ not json', 'utf8');
    expect(count(path)).toBe(0);
    expect(() => enqueue(path, 's:/a', { n: 2 })).not.toThrow();
  });

  test('oldest entries are dropped once the byte cap is exceeded', () => {
    // Few, large entries (not many small ones): each enqueue() rewrites the whole accumulated
    // file, so this keeps the test's total I/O bounded (a handful of ~20MB writes) instead of
    // O(n^2) over dozens of iterations, while still genuinely exercising the real 50MB cap.
    const big = 'x'.repeat(Math.ceil(P_MAX_BYTES * 0.4));
    enqueue(path, 's:/a', { n: 0, big });
    enqueue(path, 's:/a', { n: 1, big });
    enqueue(path, 's:/a', { n: 2, big }); // pushes cumulative size past P_MAX_BYTES
    const remaining = drain(path, 1000);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(3);
    // The oldest entry (n: 0) must be the one dropped, not the newest.
    expect(remaining[remaining.length - 1]!.payload).toEqual({ n: 2, big });
  }, 20000);
});
