// engine/src/agents/manager/statePaths.ts -- AGT-5, a SCOPED port of
// backend/config/state_paths.py: only the pieces AgentLaunch.ts needs (`pStateHome`/
// `homeStateDir`/`stateDir`/the `.openswarm` -> `.maestro` one-time migration). A full
// `backend/config/*` port (the rest of state_paths.py's callers, plus config/paths.py's other
// directory constants) is a bigger, cross-cutting job that belongs to whichever ticket first needs
// the rest of that module -- this file exists because AgentLaunch.py's fixed bug (see this
// ticket's own instructions) hinges on exactly this function, and porting the fix without its real
// dependency would just move the bug into a stub.

import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_DIR_NAME = '.maestro';
export const LEGACY_STATE_DIR_NAME = '.openswarm';

/** Move legacy entries into an already-populated new dir, never overwriting a name that exists
 * there. Best-effort: a failed individual move is silently skipped, mirroring the Python
 * original's own swallow-and-continue. */
function mergeLegacyEntries(legacy: string, current: string): void {
  for (const name of readdirSync(legacy)) {
    const dst = join(current, name);
    if (existsSync(dst)) continue;
    const src = join(legacy, name);
    try {
      renameSync(src, dst);
    } catch {
      // Best-effort, mirrors the Python original's try/except pass.
    }
  }
}

/** Rename `<parent>/.openswarm` to `<parent>/.maestro` and return the new path. Safe when neither,
 * either, or both exist: a populated `.maestro` is never clobbered. */
export function migrateStateDir(parent: string): string {
  const current = join(parent, STATE_DIR_NAME);
  const legacy = join(parent, LEGACY_STATE_DIR_NAME);
  if (!existsSync(legacy)) return current;
  try {
    if (!existsSync(legacy)) return current;
    if (!existsSync(current)) {
      renameSync(legacy, current);
    } else {
      mergeLegacyEntries(legacy, current);
    }
  } catch {
    // Best-effort, mirrors the Python original's try/except pass.
  }
  return current;
}

/** Path inside `<parent>/.maestro`, migrating a pre-rebrand `.openswarm` first. */
export function stateDir(parent: string, ...parts: string[]): string {
  return join(migrateStateDir(parent), ...parts);
}

/** `$MAESTRO_STATE_HOME` when set, else the real home. The override exists so an e2e run against a
 * packaged build cannot write workspaces and caches into the developer's own `~/.maestro`. */
export function pStateHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.MAESTRO_STATE_HOME ?? '').trim();
  if (override) return join(override); // path.resolve-equivalent normalize, mirrors os.path.abspath
  return realHome(env);
}

/** The REAL home directory, unaffected by MAESTRO_STATE_HOME. Exists as its own export because
 * AgentLaunch.py's fixed bug hinges on the distinction between this and pStateHome(): the state
 * home decides the workspace LOCATION, but a git-init safety guard must always check against the
 * REAL home, or a user pointing target_directory at their actual home while MAESTRO_STATE_HOME is
 * overridden would slip past it. */
export function realHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.USERPROFILE || env.HOME || '';
}

/** Path inside `~/.maestro` (workspaces, caches, tool reports). */
export function homeStateDir(...parts: string[]): string {
  return stateDir(pStateHome(), ...parts);
}
