// engine/src/settings/store.ts -- ENG-3, the TypeScript engine's settings.json persistence.
//
// Ports backend/config/json_store.py's atomic_write_json pattern EXACTLY: write to a temp file in
// the same directory, fsync the file's own data before the rename (a bare rename is atomic for
// the *name* but the bytes can still be sitting in the page cache -- a crash between rename and
// the kernel's writeback can leave a torn/zero-length file even though the rename "succeeded"),
// THEN best-effort fsync the parent directory so the rename itself survives a crash too.
// Confirmed live on this repo's own Windows dev box that the equivalent Python test
// (backend/tests/test_disk_resilience.py::test_atomic_write_fsyncs_directory_after_rename) itself
// FAILS there -- it's one of scripts/verify.mjs's 6 Windows-environmental deselects, because
// Python's own p_fsync_dir already silently no-ops on Windows via a caught OSError. This port's
// try/catch around the directory fsync reproduces that SAME real behavior, not a regression this
// port introduced.
//
// Single-writer rule (the ticket's hard constraint): during the migration, Python and this engine
// BOTH can reach settings.json, and exactly one may write it. This module is the engine's half --
// it writes unconditionally whenever a request is routed here (split.ts's native/proxy table is
// the actual on/off switch for whether the engine ever gets called at all). The Python half is
// backend/apps/settings/store.py's own additive MAESTRO_ENGINE_OWNS_SETTINGS=1 guard, which makes
// ITS write path a no-op once the flag is set -- the two are independent, deliberately: this file
// doesn't need to know about that env var, because if the engine is receiving the request at all,
// split.ts has already decided this engine owns /api/settings for this install.

import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDataRoot } from '../auth/token';
import { migrateLegacyFields } from './migrations';
import { coerceSettings, defaultAppSettings, DEFAULT_SYSTEM_PROMPT, type AppSettings } from './models';

// backend/config/paths.py: SETTINGS_DIR = DATA_ROOT/settings. resolveDataRoot() (auth/token.ts)
// already ports DATA_ROOT's env-override/packaged/dev resolution byte-for-byte; this just adds
// the one subdirectory segment rather than re-deriving DATA_ROOT a second time in this file.
export function settingsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'settings');
}

export function settingsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(settingsDir(env), 'settings.json');
}

// Blocks the calling thread for `ms` -- Node has no synchronous sleep primitive, and the retry
// loop below must stay synchronous to match json_store.py's own sync retry-with-time.sleep shape.
// Atomics.wait on a throwaway SharedArrayBuffer is the standard Node trick for this.
function blockingSleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Best-effort directory fsync -- see module doc: on this repo's Windows dev box this silently
// no-ops (openSync/fsyncSync on a directory handle fails), matching Python's own real behavior,
// not a gap this port introduces.
function fsyncDirBestEffort(directory: string): void {
  let fd: number;
  try {
    fd = openSync(directory, 'r');
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // non-fatal, matches p_fsync_dir
  } finally {
    closeSync(fd);
  }
}

// Direct port of backend/config/json_store.py's atomic_write_json. Reused by any future engine
// store that needs the same crash-safety, not just settings -- kept generic on purpose, same as
// the Python original.
export function atomicWriteJson(path: string, payload: unknown): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const tmp = join(directory, `.tmp-${randomBytes(8).toString('hex')}.json`);
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(payload, null, 2), null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Windows: Defender can briefly hold the destination open; a couple of retries covers every
    // real case -- mirrors json_store.py's 3-attempt loop (time.sleep(0.1) between attempts).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        renameSync(tmp, path);
        fsyncDirBestEffort(directory);
        return;
      } catch (e) {
        if (attempt === 2) throw e;
        blockingSleepMs(100);
      }
    }
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup, matches json_store.py
    }
    throw e;
  }
}

export interface LoadSettingsResult {
  settings: AppSettings;
  /** Fields present on disk but dropped for failing their type check (coerceSettings). */
  droppedFields: string[];
}

// Parse+validate settings.json, returning defaults if the file is missing or unreadable. Mirrors
// store.py's load_settings error handling (a corrupt or version-mismatched file must never brick
// boot/GET /api/settings) but deliberately skips its mtime+size in-memory cache -- that's a pure
// perf optimization (a stat skips reopening a file Defender can turn into 5-50ms), not a
// correctness requirement, and out of this ticket's scope.
export function loadSettings(env: NodeJS.ProcessEnv = process.env): LoadSettingsResult {
  const path = settingsFilePath(env);
  if (!existsSync(path)) {
    return { settings: defaultAppSettings(), droppedFields: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Corrupt/unreadable file -- boot on defaults rather than crash, matching store.py's
    // p_preserve_corrupt_settings + defaults fallback. Deliberately does not rename the file
    // aside here (that mutation belongs to whichever process currently owns writes).
    return { settings: defaultAppSettings(), droppedFields: [] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { settings: defaultAppSettings(), droppedFields: [] };
  }
  const droppedFields: string[] = [];
  const migrated = migrateLegacyFields(raw as Record<string, unknown>);
  const settings = coerceSettings(migrated, (fields) => droppedFields.push(...fields));
  if (settings.default_system_prompt === null) settings.default_system_prompt = DEFAULT_SYSTEM_PROMPT;
  return { settings, droppedFields };
}

// Persists a full AppSettings object. The payload is always already current-schema (built from
// this module's own AppSettings shape), so -- like store.py's atomic_write_settings -- no
// migration runs on the write path, only on load.
export function saveSettings(settings: AppSettings, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteJson(settingsFilePath(env), settings);
}
