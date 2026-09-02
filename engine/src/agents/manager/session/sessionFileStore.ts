// engine/src/agents/manager/session/sessionFileStore.ts -- SUB-3, a SCOPED port of
// backend/apps/agents/manager/session/session_store.py: just the on-disk JSON CRUD
// (load_session_data/save_session/delete_session_file/load_all_session_data), not the search
// indexing helper (build_search_text, unused by dashboards.py/swarm -- this migration's actual
// callers) and not AgentManager.ts's own no-op saveSession (see AgentManager.ts's header: "no
// persistence layer exists yet" for the LIVE agent loop's own close/delete path -- that is a
// separate, deliberate scope cut this ticket does not reopen).
//
// dashboards.py and backend/apps/swarm/entities/{dashboards,SessionExportable}.py both read/write
// session JSON files directly (not through agent_manager's in-memory state) for everything except
// a still-live turn, so this thin file-I/O layer is what those two ports need -- and is exactly
// the seam session_store.py itself already draws (`sessions_dir()` -> agent_manager.SESSIONS_DIR,
// a pure path+read_json_or_none/atomic_write_json wrapper with no in-memory involvement at all).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from '../../../settings/store';
import { migratePickerValue } from '../../../settings/migrations';
import { sessionsDir } from '../../../apps/service/sessions';

/** Direct port of json_store.py's read_json_or_none: a missing/garbled file returns null instead
 * of throwing. */
function readJsonOrNull(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Walks a JSON-shaped object/array IN PLACE, rewriting every stale `custom/provedor-ia/<model>`
 * picker-value string found at any depth to `custom/maestro/<model>` -- direct port of
 * maestro_picker_migration.py's migrate_picker_values_in_place. Deliberately untyped/blunt (not a
 * schema-aware migration), matching the Python original's own stance. */
function migratePickerValuesInPlace(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      const v = obj[i] as unknown;
      if (typeof v === 'string') obj[i] = migratePickerValue(v);
      else if (v !== null && typeof v === 'object') migratePickerValuesInPlace(v);
    }
  } else if (obj !== null && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (typeof v === 'string') rec[k] = migratePickerValue(v);
      else if (v !== null && typeof v === 'object') migratePickerValuesInPlace(v);
    }
  }
}

function sessionFilePath(sessionId: string, env: NodeJS.ProcessEnv): string {
  return join(sessionsDir(env), `${sessionId}.json`);
}

export function saveSessionFile(sessionId: string, docData: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): void {
  const dir = sessionsDir(env);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(sessionFilePath(sessionId, env), docData);
}

export function loadSessionData(sessionId: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> | null {
  const data = readJsonOrNull(sessionFilePath(sessionId, env));
  if (data !== null) migratePickerValuesInPlace(data);
  return data;
}

export function deleteSessionFile(sessionId: string, env: NodeJS.ProcessEnv = process.env): void {
  const path = sessionFilePath(sessionId, env);
  if (existsSync(path)) rmSync(path);
}

export function loadAllSessionData(env: NodeJS.ProcessEnv = process.env): Array<[string, Record<string, unknown>]> {
  const dir = sessionsDir(env);
  if (!existsSync(dir)) return [];
  const results: Array<[string, Record<string, unknown>]> = [];
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const data = readJsonOrNull(join(dir, fname));
    if (data === null) continue;
    migratePickerValuesInPlace(data);
    results.push([fname.slice(0, -5), data]);
  }
  return results;
}
