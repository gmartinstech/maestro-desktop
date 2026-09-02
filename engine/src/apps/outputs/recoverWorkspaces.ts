// engine/src/apps/outputs/recoverWorkspaces.ts -- SUB-5, a full port of backend/apps/outputs/
// recover_workspaces.py: boot-time recovery of app workspaces whose Output record went missing.
// See the Python module doc for the full rationale (tombstoning on delete, never fabricating a
// healthy-looking record, never surfacing a husk with no real work as an openable app).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDir } from '../../agents/manager/statePaths';
import { hydrateOutput, type Output } from './models';
import { outputsWorkspaceDir } from './paths';
import { loadAll, save } from './workspaceIo';

// Written into the workspace's own .maestro dir when the user deletes the app, so recovery can
// tell "deleted on purpose" from "record lost".
const TOMBSTONE_NAME = 'deleted';

// A directory holding any of these has had real work done in it; anything else is a husk we must
// not advertise as an openable app.
const P_WORK_EVIDENCE = ['run.sh', 'index.html', 'meta.json', 'backend.py', 'package.json'];

// Distinct Material symbol so a recovered app is visually distinguishable with no locale-specific copy.
const RECOVERED_ICON = 'restore_page';

/** Mark a workspace as deliberately deleted. Best-effort: without it recovery would offer the app
 * back on the next boot, which is worse than a leftover directory. */
export function tombstone(workspaceId: string, env: NodeJS.ProcessEnv = process.env): void {
  const folder = join(outputsWorkspaceDir(env), workspaceId);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return;
  try {
    const path = stateDir(folder, TOMBSTONE_NAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Date().toISOString(), 'utf8');
  } catch {
    // Best-effort, matches recover_workspaces.py's own logged-and-continue.
  }
}

export function isTombstoned(folder: string): boolean {
  return existsSync(stateDir(folder, TOMBSTONE_NAME));
}

function pHasWork(folder: string): boolean {
  return P_WORK_EVIDENCE.some((name) => existsSync(join(folder, name)));
}

/** The app's own name from meta.json, when the agent got far enough to write one. */
function pMetaName(folder: string): string | null {
  let meta: unknown;
  try {
    meta = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
  if (typeof meta !== 'object' || meta === null) return null;
  const name = String((meta as Record<string, unknown>).name ?? '').trim();
  return name || null;
}

/** Workspace directories worth recovering: unreferenced, not tombstoned, and holding real work.
 * Sorted so a boot log reads the same twice. */
export function orphanWorkspaceIds(knownWorkspaceIds: Set<string>, env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = outputsWorkspaceDir(env);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of [...readdirSync(dir)].sort()) {
    const folder = join(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(folder).isDirectory();
    } catch {
      continue;
    }
    if (!isDir || knownWorkspaceIds.has(name)) continue;
    if (isTombstoned(folder) || !pHasWork(folder)) continue;
    out.push(name);
  }
  return out;
}

/** Re-register every recoverable orphan workspace and return the new rows. */
export function recoverOrphanWorkspaces(env: NodeJS.ProcessEnv = process.env): Output[] {
  let known: Set<string>;
  try {
    known = new Set(loadAll(env).map((o) => o.workspace_id).filter((id): id is string => !!id));
  } catch (err) {
    console.error('[outputs] workspace recovery: could not read existing records; skipping:', err);
    return [];
  }
  const recovered: Output[] = [];
  for (const workspaceId of orphanWorkspaceIds(known, env)) {
    try {
      const now = new Date().toISOString();
      const output = hydrateOutput({
        name: pMetaName(join(outputsWorkspaceDir(env), workspaceId)) || `App ${workspaceId.slice(0, 8)}`,
        icon: RECOVERED_ICON,
        files: {},
        workspace_id: workspaceId,
        recovered: true,
        created_at: now,
        updated_at: now,
      });
      save(output, env);
      recovered.push(output);
      console.log(`[outputs] recovered app workspace ${workspaceId} with no record as output ${output.id}`);
    } catch (err) {
      console.error(`[outputs] workspace recovery: could not re-register ${workspaceId}:`, err);
    }
  }
  return recovered;
}
