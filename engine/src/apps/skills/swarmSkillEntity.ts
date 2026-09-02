// engine/src/apps/skills/swarmSkillEntity.ts -- SUB-2's port of
// backend/apps/swarm/entities/skills.py's SkillExportable, RECONCILED by SUB-3 against the real
// swarm/ port that landed alongside it (engine/src/apps/swarm/{models,exportable}.ts) -- this file
// used to carry its own narrowly-scoped, inline stand-ins for EntityType/Requirement/DepRef/
// ExportContext/RemapTable (see this ticket's own history), exactly as its own header at the time
// said a later SUB-3 should do: "delete this file's local shims and re-import the real ones; the
// class body itself should need no change since the shapes are identical." It didn't.
//
// swarm/registry.ts imports SkillExportable from here (not the other way around) -- this stays
// the single source of truth for the skill entity, same as backend/apps/swarm/registry.py imports
// FROM backend/apps/skills/skills.py's sibling module rather than owning skill logic itself.
//
// One deliberate scope cut, carried over unchanged from SUB-2 and still true: backend/tests/
// test_skills_folders.py::test_stage_zip_carries_supporting_files_into_sandbox exercises
// backend.apps.swarm.closure.stage_skill_from_zip's general multi-entity zip-import/sandbox path,
// not anything skill-specific -- that test's TS twin lives with swarm/closure.test.ts instead.
//
// `rollback` (below) is a SUB-3 addition, not carried over from SUB-2: the Python original always
// had it (backend/apps/swarm/entities/skills.py's own rollback classmethod), but SUB-2's own gate
// didn't need it, so it wasn't ported until closure.ts's all-or-nothing commit() (this ticket)
// needed a real rollback for every registry entry, skills included.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadIndex, saveIndex, skillMdPath, skillsDir, writeFolderSkill } from './skills';
import { RemapTable, type DepRef, type ExportContext } from '../swarm/exportable';
import { EntityType, type Requirement } from '../swarm/models';

/** Kept as a re-export so any pre-existing import of `SKILL_ENTITY_TYPE` from this file (rather
 * than `EntityType.skill` directly) still resolves to the exact same value. */
export const SKILL_ENTITY_TYPE = EntityType.skill;

/** Re-exported so this file's public surface (and any existing test import) is unchanged now that
 * the real types live in swarm/exportable.ts + swarm/models.ts. */
export type SwarmRequirement = Requirement;
export type SwarmDepRef = DepRef;
export type SwarmExportContext = ExportContext;
export { RemapTable };

export interface SkillExportPayload {
  slug: string;
  name: string;
  description: string;
  command: string;
  content: string;
  builtin: boolean;
}

/** Every file in a skill folder except SKILL.md, as {relpath: Buffer}. Full port of
 * backend/apps/swarm/entities/skills.py's p_read_supporting_files. */
function readSupportingFiles(skillDir: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(full);
        continue;
      }
      const rel = relative(skillDir, full);
      if (rel === 'SKILL.md' || name.startsWith('.')) continue;
      try {
        out[rel.split('\\').join('/')] = readFileSync(full);
      } catch {
        // best-effort, matches the Python original's try/except OSError: continue.
      }
    }
  };
  walk(skillDir);
  return out;
}

/** Full port of backend/apps/swarm/entities/skills.py's SkillExportable. Skills are leaves (no
 * deps, no requirements). A skill is either a single markdown file or a folder (SKILL.md +
 * supporting files like scripts/templates), so this powers both the .swarm round-trip AND the
 * generic "import a .md or a zip-of-SKILL.md" path. Folder skills ride the entity files() channel
 * so their supporting files survive export/import. */
export class SkillExportable {
  readonly type = SKILL_ENTITY_TYPE;

  constructor(
    public readonly localId: string,
    public readonly name: string,
    public readonly payload: SkillExportPayload,
    private readonly p_files: Record<string, Buffer> = {},
  ) {}

  static load(localId: string): SkillExportable | null {
    const [mdPath, kind] = skillMdPath(localId);
    if (!mdPath) return null;
    const content = readFileSync(mdPath, 'utf8');
    const meta = loadIndex()[localId] ?? {};
    const name = (meta.name as string | undefined) || titleCase(localId);
    const payload: SkillExportPayload = {
      slug: localId,
      name,
      description: (meta.description as string | undefined) ?? '',
      command: (meta.command as string | undefined) ?? localId,
      content,
      builtin: Boolean(meta.built_in),
    };
    const files = kind === 'folder' ? readSupportingFiles(join(skillsDir(), localId)) : {};
    return new SkillExportable(localId, name, payload, files);
  }

  serialize(_ctx: SwarmExportContext): SkillExportPayload {
    return { ...this.payload };
  }

  files(): Record<string, Buffer> {
    return { ...this.p_files };
  }

  dependencies(): SwarmDepRef[] {
    return [];
  }

  requirements(): SwarmRequirement[] {
    return [];
  }

  static conflict(payload: { slug?: string }): string | null {
    const slug = payload.slug ?? '';
    if (slug && slugTaken(slug)) return 'already exists; will be added as a copy';
    return null;
  }

  static import_(payload: Record<string, unknown>, files: Record<string, Buffer>, _remap: RemapTable | null): string {
    const base = String((payload.slug as string | undefined) ?? (payload.name as string | undefined) ?? 'skill')
      .toLowerCase()
      .replace(/ /g, '-');
    const slug = freeSlug(base);
    const meta: Record<string, unknown> = {
      name: (payload.name as string | undefined) ?? slug,
      description: (payload.description as string | undefined) ?? '',
      command: (payload.command as string | undefined) ?? slug,
    };
    // Every imported skill lands as a folder (SKILL.md + any supporting files), one path for
    // one-file and multi-file skills alike. writeFolderSkill is path-traversal-safe, so an
    // untrusted bundle can't escape the skill dir.
    const bundle: Record<string, string> = { 'SKILL.md': (payload.content as string | undefined) ?? '' };
    for (const [rel, data] of Object.entries(files)) {
      bundle[rel] = data.toString('utf8');
    }
    const skill = writeFolderSkill(slug, bundle, meta);
    return skill.id;
  }

  /** Full port of backend/apps/swarm/entities/skills.py's rollback classmethod: undoes exactly
   * what import_ did, for closure.ts's all-or-nothing commit(). */
  static rollback(localId: string): void {
    const skillDir = join(skillsDir(), localId);
    const flat = join(skillsDir(), `${localId}.md`);
    if (existsSync(skillDir) && statSync(skillDir).isDirectory()) {
      rmSync(skillDir, { recursive: true, force: true });
    }
    if (existsSync(flat) && statSync(flat).isFile()) {
      rmSync(flat);
    }
    const index = loadIndex();
    if (localId in index) {
      delete index[localId];
      saveIndex(index);
    }
  }
}

function titleCase(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function slugTaken(slug: string): boolean {
  return Boolean(loadIndex()[slug]) || existsSync(join(skillsDir(), `${slug}.md`)) || existsSync(join(skillsDir(), slug));
}

function freeSlug(base: string): string {
  const b = base || 'skill';
  if (!slugTaken(b)) return b;
  const cand = `${b}-imported`;
  if (!slugTaken(cand)) return cand;
  let i = 2;
  while (slugTaken(`${b}-imported-${i}`)) i += 1;
  return `${b}-imported-${i}`;
}
