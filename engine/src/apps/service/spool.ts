// engine/src/apps/service/spool.ts -- ENG-7's port of backend/apps/service/buffer.py's offline
// retry spool.
//
// SCOPED SIMPLIFICATION (flagged, not an oversight): buffer.py backs this with a SQLite file
// (service_spool.db) using auto-increment row IDs and byte-cap trimming via VACUUM. This engine
// port uses a newline-delimited JSON file instead of pulling in a SQLite binding -- native mode
// fully owns /api/service once split.ts flips it (single-owner, ENG-3's rule), so the two spool
// implementations never write the same file concurrently; there is no on-disk format to keep
// byte-compatible with Python here, unlike auth.token or settings.json which both processes can
// still read/write during the proxy period. Uses a DIFFERENT filename (service_spool.jsonl, not
// service_spool.db) specifically so an engine process and a still-running Python process can never
// mistake one file for the other's format. Same public surface (enqueue/drain/acknowledge/count/
// clear) and the same 50MB cap + 75%-trim-target behavior, oldest-first.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const P_MAX_BYTES = 50 * 1024 * 1024;
const P_TRIM_TARGET_FRACTION = 0.75;

export interface SpoolEntry {
  id: number;
  kind: string;
  payload: unknown;
}

interface SpoolFile {
  nextId: number;
  entries: SpoolEntry[];
}

function readSpoolFile(spoolPath: string): SpoolFile {
  if (!existsSync(spoolPath)) return { nextId: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(spoolPath, 'utf8')) as Partial<SpoolFile>;
    if (!Array.isArray(parsed.entries)) return { nextId: 1, entries: [] };
    return { nextId: typeof parsed.nextId === 'number' ? parsed.nextId : parsed.entries.length + 1, entries: parsed.entries };
  } catch {
    // Corrupt file; treat as empty rather than blocking every future submission behind it --
    // mirrors buffer.py's per-row corrupt-JSON handling, just at file granularity instead of a
    // per-row one (this format has no independent per-row framing to salvage the good rows from).
    return { nextId: 1, entries: [] };
  }
}

function writeSpoolFileAtomic(spoolPath: string, file: SpoolFile): void {
  mkdirSync(dirname(spoolPath), { recursive: true });
  const tmp = `${spoolPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), 'utf8');
  renameSync(tmp, spoolPath);
}

function byteSize(file: SpoolFile): number {
  return Buffer.byteLength(JSON.stringify(file), 'utf8');
}

export function enqueue(spoolPath: string, kind: string, payload: unknown): void {
  const file = readSpoolFile(spoolPath);
  file.entries.push({ id: file.nextId, kind, payload });
  file.nextId += 1;
  if (byteSize(file) > P_MAX_BYTES) {
    const target = P_MAX_BYTES * P_TRIM_TARGET_FRACTION;
    while (file.entries.length > 0 && byteSize(file) > target) {
      file.entries.shift();
    }
  }
  writeSpoolFileAtomic(spoolPath, file);
}

/** Read up to `batchSize` oldest entries. Caller acknowledges once delivered. */
export function drain(spoolPath: string, batchSize = 50): SpoolEntry[] {
  return readSpoolFile(spoolPath).entries.slice(0, batchSize);
}

export function acknowledge(spoolPath: string, ids: readonly number[]): void {
  if (ids.length === 0) return;
  const file = readSpoolFile(spoolPath);
  const idSet = new Set(ids);
  file.entries = file.entries.filter((e) => !idSet.has(e.id));
  writeSpoolFileAtomic(spoolPath, file);
}

export function count(spoolPath: string): number {
  return readSpoolFile(spoolPath).entries.length;
}

export function clear(spoolPath: string): void {
  writeSpoolFileAtomic(spoolPath, { nextId: 1, entries: [] });
}
