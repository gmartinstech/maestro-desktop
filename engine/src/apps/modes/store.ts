// engine/src/apps/modes/store.ts -- SUB-1's native port of backend/apps/modes/modes.py's
// on-disk store (load_all/save/load/load_mode) plus modes_lifespan's one-time migration.
//
// backend/apps/modes/modes.py runs its stale-chat-cleanup + builtin-seed as a FastAPI lifespan
// (once, at process boot). This engine has no per-SubApp lifespan hook (ENG-3's settings/store.ts
// established the pattern this follows: do the equivalent work lazily, on first access, rather
// than wiring a new boot-time concept just for this one ticket) -- ensureSeeded() below is called
// at the top of every handler that reads the mode list, mirroring loadSettings()'s lazy-migrate
// shape. Idempotent either way: re-running the seed/cleanup on every call is a cheap directory
// listing plus a handful of file existence checks, not a correctness risk.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import { atomicWriteJson } from '../../settings/store';
import { builtinModes, newModeId, type Mode } from './models';

export function modesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'modes');
}

function modeFilePath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

// Direct port of json_store.py's read_json_or_none: a missing/garbled file returns null instead of
// throwing, so one corrupt mode file can't crash the whole load_all() list.
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

// A Mode as read off disk is trusted structurally (this engine wrote it, or a still-compatible
// Python did) -- unlike settings.ts's coerceSettings, there's no legacy-field migration needed
// here (Mode's shape hasn't changed across versions the way AppSettings has), so this just fills
// in defaults for any field an older file might be missing, the same tolerance pydantic's own
// field defaults give load() when it re-validates a stored dict.
function hydrateMode(data: Record<string, unknown>): Mode | null {
  // Mode.id has a pydantic default_factory (uuid4().hex) -- only `name` is truly required; a file
  // missing `id` is not a corruption, it gets a freshly generated one, matching Mode(**data).
  if (typeof data.name !== 'string') return null;
  return {
    id: typeof data.id === 'string' ? data.id : newModeId(),
    name: data.name,
    description: typeof data.description === 'string' ? data.description : '',
    system_prompt: typeof data.system_prompt === 'string' ? data.system_prompt : null,
    tools: Array.isArray(data.tools) ? (data.tools as string[]) : null,
    default_next_mode: typeof data.default_next_mode === 'string' ? data.default_next_mode : null,
    is_builtin: data.is_builtin === true,
    icon: typeof data.icon === 'string' ? data.icon : 'smart_toy',
    color: typeof data.color === 'string' ? data.color : '#818cf8',
    default_folder: typeof data.default_folder === 'string' ? data.default_folder : null,
  };
}

export function saveMode(mode: Mode, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteJson(modeFilePath(modesDir(env), mode.id), mode);
}

export function loadAllModes(env: NodeJS.ProcessEnv = process.env): Mode[] {
  const dir = modesDir(env);
  if (!existsSync(dir)) return [];
  const result: Mode[] = [];
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const data = readJsonOrNull(join(dir, fname));
    if (data === null) continue;
    const mode = hydrateMode(data);
    if (mode === null) continue;
    result.push(mode);
  }
  return result;
}

/** Returns the mode or null (never throws) -- callers that need modes.py's 404-on-missing HTTP
 * behavior (load()) check for null themselves; loadModeByIdOrNull() is the public
 * "resolve a mode by id" helper modes.py itself exposes to other modules. */
export function loadModeByIdOrNull(modeId: string, env: NodeJS.ProcessEnv = process.env): Mode | null {
  const data = readJsonOrNull(modeFilePath(modesDir(env), modeId));
  return data === null ? null : hydrateMode(data);
}

// Direct port of delete_mode's file-removal step (the is_builtin/404 guards live in modes.ts,
// the HTTP layer -- this is just the disk-side effect).
export function deleteModeFile(modeId: string, env: NodeJS.ProcessEnv = process.env): void {
  const path = modeFilePath(modesDir(env), modeId);
  if (existsSync(path)) rmSync(path);
}

// Direct port of modes_lifespan's body: remove a stale BUILT-IN chat.json (chat was merged into
// ask -- a user-customized copy, is_builtin=false, is left alone), then seed any builtin mode
// whose file doesn't exist yet. Safe to call on every request: os.makedirs/mkdirSync is a no-op
// once the dir exists, and each builtin write is skipped once its file is present.
export function ensureSeeded(env: NodeJS.ProcessEnv = process.env): void {
  const dir = modesDir(env);
  mkdirSync(dir, { recursive: true });

  const chatPath = join(dir, 'chat.json');
  if (existsSync(chatPath)) {
    const data = readJsonOrNull(chatPath);
    if (data !== null && data.is_builtin === true && data.id === 'chat') {
      try {
        rmSync(chatPath);
      } catch {
        // matches modes.py's broad except + log-only around this migration step
      }
    }
  }

  for (const builtin of builtinModes(env)) {
    const path = modeFilePath(dir, builtin.id);
    if (!existsSync(path)) saveMode(builtin, env);
  }
}
