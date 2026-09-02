// engine/src/apps/workflows/audit.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/audit.py: an append-only JSONL diff log for workflow edits, one file per
// workflow at <DATA_ROOT>/workflows/audit/<wid>.jsonl.
//
// Same on-disk layout as the Python original (both backends can read/write the same files during
// the migration). Node has no direct equivalent of Python's threading.Lock guarding the same
// process's concurrent writers, but this engine handles one HTTP request at a time per file (no
// worker threads touch this path), so the synchronous fs calls below are already serialized by the
// event loop the same way the Python lock serializes CPython's GIL-scheduled threads -- no lock
// object needed here.

import { existsSync, mkdirSync, openSync, readSync, closeSync, appendFileSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workflowsDir } from './store';

// Soft cap on bytes per audit file -- mirrors audit.py's SOFT_CAP_BYTES (256 KiB is ~2000 edits).
const SOFT_CAP_BYTES = 256 * 1024;

function auditDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(workflowsDir(env), 'audit');
}

function auditPath(wid: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(auditDir(env), `${wid}.jsonl`);
}

/** Shallow diff: only keys whose value changed (deep-equal via JSON.stringify, same as Python's
 * `!=` on nested dicts/lists -- a small sub-dict compares as a whole rather than key-by-key). */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed[k] = { before: b ?? null, after: a ?? null };
  }
  return changed;
}

/** Read the tail bytes of a file without loading it whole -- mirrors audit.py's truncate-to-tail-
 * half logic (seek from the end, drop the first partial line). */
function truncateToTailHalf(path: string): void {
  const size = statSync(path).size;
  const wantBytes = Math.floor(SOFT_CAP_BYTES / 2);
  const start = Math.max(0, size - wantBytes);
  const fd = openSync(path, 'r');
  let tail: Buffer;
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    tail = buf;
  } finally {
    closeSync(fd);
  }
  const text = tail.toString('utf8');
  const firstNl = text.indexOf('\n');
  const kept = firstNl >= 0 ? text.slice(firstNl + 1) : '';
  writeFileSync(path, kept, 'utf8');
}

export function logChange(wid: string, who: string, before: Record<string, unknown>, after: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): void {
  const d = diff(before, after);
  if (Object.keys(d).length === 0) return;
  const entry = { ts: new Date().toISOString(), who, diff: d };
  try {
    mkdirSync(auditDir(env), { recursive: true });
    const path = auditPath(wid, env);
    if (existsSync(path) && statSync(path).size > SOFT_CAP_BYTES) truncateToTailHalf(path);
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Best-effort, mirrors the Python original's logged-and-swallowed failure.
  }
}

export function readTail(wid: string, limit = 50, env: NodeJS.ProcessEnv = process.env): Array<Record<string, unknown>> {
  const path = auditPath(wid, env);
  if (!existsSync(path)) return [];
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(-limit)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip a corrupt line, same as the Python original's try/except-continue.
    }
  }
  out.reverse();
  return out;
}
