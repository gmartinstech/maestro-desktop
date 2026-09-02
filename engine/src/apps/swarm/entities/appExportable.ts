// engine/src/apps/swarm/entities/appExportable.ts -- SUB-5, a full TypeScript port of
// backend/apps/swarm/entities/apps.py's AppExportable, REPLACING the stand-in SUB-3 left here
// (that ticket's own header explained why: AppExportable's whole implementation sits on top of
// backend/apps/outputs, which SUB-5 is this repo's own ticket for -- "whichever ticket ports SUB-5
// should replace this file with a real port of apps.py"). SUB-5 has now landed outputs/ (models.ts,
// workspaceIo.ts, viewBuilderTemplates.ts), so this is that real port.
//
// An app is an Output record + its workspace file tree. We carry the editable source (frontend/,
// backend/, run.sh, package.json, .env.example, meta) but NOT node_modules/.venv/dist (skip dirs)
// and NOT the live `.env` (it holds the source machine's absolute paths + pinned port). On import
// we mint a fresh output id + workspace id, drop the builder session link, and regenerate a local
// `.env` with a free port. The app stays inert until the user opens it.
//
// SCOPE NOTE on p_localize_env: the Python original also re-links the imported workspace's
// frontend/node_modules at the shared warm-cache directory (view_builder_templates.py's
// link_node_modules) and re-derives a warm backend-venv cache path (warm_venv_dir). Both of those
// caches are viewBuilderTemplates.ts's own DISCLOSED scope cut (see that file's header: the
// workspace's own run.sh/backend_init.sh already self-heal with a real install when node_modules/
// the venv is missing). So the same cut applies here for the same reason -- an imported/branched
// app pays a real first-install cost instead of a symlink, which is strictly correct, just slower
// on the very first launch.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve as pathResolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DepRef, Exportable, ExportContext } from '../exportable';
import type { RemapTable } from '../exportable';
import { EntityType, type Requirement } from '../models';
import { hydrateOutput, type Output } from '../../outputs/models';
import { WALK_SKIP_DIRS, WALK_SKIP_FILES, loadOutput, save } from '../../outputs/workspaceIo';
import { outputsDir, outputsWorkspaceDir } from '../../outputs/paths';
import { findFreePort } from '../../outputs/runtimeProc';
import { TEMPLATE_BACKEND_PATH, patchEnvPort } from '../../outputs/viewBuilderTemplates';

// Matches ziputil's per-entry cap.
const P_MAX_APP_FILE = 25 * 1024 * 1024;

function pSafeJoin(folder: string, rel: string): string {
  const dest = pathResolve(join(folder, rel));
  const root = pathResolve(folder);
  if (dest !== root && !dest.startsWith(root + sep)) throw new Error('app file path escapes the workspace');
  return dest;
}

/** Regenerate the workspace .env on the importer's machine: a fresh port plus this install's
 * absolute template path (the source's was dropped). Best-effort throughout, matching
 * p_localize_env's own broad try/except-and-continue. */
async function pLocalizeEnv(folder: string): Promise<void> {
  const envPath = join(folder, '.env');
  const example = join(folder, '.env.example');
  if (!existsSync(envPath)) {
    if (existsSync(example)) {
      try {
        writeFileSync(envPath, readFileSync(example));
      } catch {
        return;
      }
    } else {
      return; // flat app: no run.sh, no env needed
    }
  }
  try {
    const port = await findFreePort();
    patchEnvPort(envPath, 'FRONTEND_PORT', String(port));
    patchEnvPort(envPath, 'MAESTRO_TEMPLATE_BACKEND_PATH', TEMPLATE_BACKEND_PATH);
  } catch {
    // Best-effort, matches the Python original's own broad except-pass.
  }
}

export class AppExportable implements Exportable {
  readonly type = EntityType.app;

  constructor(
    private readonly output: Output,
  ) {}

  get localId(): string {
    return this.output.id;
  }

  get name(): string {
    return this.output.name || 'Untitled App';
  }

  static load(localId: string): AppExportable | null {
    const o = loadOutput(localId);
    return o ? new AppExportable(o) : null;
  }

  serialize(_ctx: ExportContext): Record<string, unknown> {
    return {
      name: this.output.name,
      description: this.output.description,
      icon: this.output.icon,
      input_schema: this.output.input_schema,
      // With a workspace, disk is the source and files() ships it; carrying output.files too would
      // snap every edited file back to its creation-time v1 on import. Only true flat apps (no
      // workspace) still need the inline copy.
      files: this.output.workspace_id ? {} : this.output.files,
    };
  }

  files(): Record<string, Buffer> {
    const out: Record<string, Buffer> = {};
    const wsid = this.output.workspace_id;
    if (!wsid) return out;
    const folder = join(outputsWorkspaceDir(), wsid);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) return out;
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (WALK_SKIP_DIRS.has(entry.name)) continue;
          walk(full);
          continue;
        }
        // .env is install-specific (absolute paths + port); .env.example travels instead.
        if (entry.name === '.env') continue;
        if (WALK_SKIP_FILES.has(entry.name)) continue;
        try {
          if (lstatSync(full).isSymbolicLink()) continue;
          if (statSync(full).size > P_MAX_APP_FILE) continue;
          const data = readFileSync(full);
          const rel = relative(folder, full).split(sep).join('/');
          out[`workspace/${rel}`] = data;
        } catch {
          // Best-effort, matches apps.py's own per-file except-continue.
        }
      }
    };
    walk(folder);
    return out;
  }

  dependencies(): DepRef[] {
    return [];
  }

  requirements(): Requirement[] {
    return [];
  }

  static import_(payload: Record<string, unknown>, files: Record<string, Buffer>, _remap: RemapTable | null): string {
    const newWsid = randomUUID().replace(/-/g, '');
    const folder = join(outputsWorkspaceDir(), newWsid);
    let wroteWorkspace = false;
    for (const [rel, data] of Object.entries(files)) {
      if (!rel.startsWith('workspace/')) continue;
      const dest = pSafeJoin(folder, rel.slice('workspace/'.length));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, data);
      wroteWorkspace = true;
    }
    if (wroteWorkspace) {
      // Fire-and-forget, matching apps.py's own broad try/except around the localize step -- a
      // failure here must never fail the import itself (the app just keeps its stale/no .env
      // until the workspace's own run.sh self-heals it on first launch).
      void pLocalizeEnv(folder).catch(() => undefined);
    }

    const now = new Date().toISOString();
    const output = hydrateOutput({
      name: (payload.name as string) || 'Imported App',
      description: (payload.description as string) ?? '',
      icon: (payload.icon as string) ?? 'view_quilt',
      input_schema: payload.input_schema ?? { type: 'object', properties: {}, required: [] },
      files: payload.files ?? {},
      workspace_id: wroteWorkspace ? newWsid : null,
      session_id: null,
      created_at: now,
      updated_at: now,
    });
    save(output);
    return output.id;
  }

  static rollback(localId: string): void {
    const o = loadOutput(localId);
    if (o?.workspace_id) {
      try {
        rmSync(join(outputsWorkspaceDir(), o.workspace_id), { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
    }
    const p = join(outputsDir(), `${localId}.json`);
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
      } catch {
        // Best-effort.
      }
    }
  }
}
