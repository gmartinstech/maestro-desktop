// engine/src/apps/swarm/entities/modeExportable.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/entities/modes.py's ModeExportable.
//
// A user-created mode (system prompt + allowed tools). Pulled in as a dependency when a shared
// dashboard's agent runs in a custom mode. Built-in modes (agent/ask/plan/...) ship with every
// install, so they're never bundled -- they surface as requirements instead (see
// sessionExportable.ts / workflowExportable.ts). Modes are referenced by slug, so import reuses an
// existing same-slug mode rather than clobbering it (keeps the session's `mode` pointer valid
// without rewriting it).

import { loadModeByIdOrNull, saveMode } from '../../modes/store';
import type { Mode } from '../../modes/models';
import type { DepRef, Exportable, ExportContext } from '../exportable';
import { RemapTable } from '../exportable';
import { EntityType, type Requirement } from '../models';

// Machine-relative or install-owned fields that must not ride along.
const P_DROP = new Set(['is_builtin', 'default_folder']);

export class ModeExportable implements Exportable {
  readonly type = EntityType.mode;

  constructor(
    public readonly localId: string,
    public readonly name: string,
    private readonly pData: Mode,
  ) {}

  static load(localId: string): ModeExportable | null {
    const m = loadModeByIdOrNull(localId);
    if (m === null) return null;
    return new ModeExportable(localId, m.name || localId, m);
  }

  serialize(_ctx: ExportContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.pData)) {
      if (!P_DROP.has(k)) out[k] = v;
    }
    return out;
  }

  files(): Record<string, Buffer> {
    return {};
  }

  dependencies(): DepRef[] {
    return [];
  }

  requirements(): Requirement[] {
    return [];
  }

  static import_(payload: Record<string, unknown>, _files: Record<string, Buffer>, _remap: RemapTable | null): string {
    const mid = (payload.id as string | undefined) || String(payload.name ?? 'mode').toLowerCase().replace(/ /g, '-');
    // Reuse a same-slug mode (incl. built-ins) instead of overwriting it; sessions point at modes
    // by this slug.
    if (loadModeByIdOrNull(mid) !== null) return mid;
    const data: Record<string, unknown> = { ...payload };
    delete data.is_builtin;
    const mode: Mode = {
      id: mid,
      name: (data.name as string | undefined) ?? mid,
      description: (data.description as string | undefined) ?? '',
      system_prompt: (data.system_prompt as string | null | undefined) ?? null,
      tools: (data.tools as string[] | null | undefined) ?? null,
      default_next_mode: (data.default_next_mode as string | null | undefined) ?? null,
      is_builtin: false,
      icon: (data.icon as string | undefined) ?? 'smart_toy',
      color: (data.color as string | undefined) ?? '#818cf8',
      default_folder: (data.default_folder as string | null | undefined) ?? null,
    };
    saveMode(mode);
    return mid;
  }
}

// Referenced by sessionExportable.ts/workflowExportable.ts for the "is this a built-in mode"
// check -- kept here so both entities agree with modes.py's own BUILTIN_MODES catalog rather than
// hand-copying the id list twice.
export const P_BUILTIN_MODES: ReadonlySet<string> = new Set(['agent', 'ask', 'plan', 'view-builder', 'skill-builder']);
