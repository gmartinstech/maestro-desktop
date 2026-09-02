// engine/src/apps/skills/skills.ts -- SUB-2, a full TypeScript port of backend/apps/skills/skills.py
// (the skill store: index persistence, built-in seeding, folder/flat sync, CRUD, and the prompt-
// injection text shared by the Skill tool and manual attach). HTTP wiring lives in http.ts; this
// file is the pure store layer, same split settings/store.ts vs settings/handler.ts already
// established.
//
// SKILLS_DIR mirrors Python's `os.path.expanduser("~/.claude/skills")` exactly: the REAL home
// directory (statePaths.ts's realHome(), unaffected by MAESTRO_STATE_HOME), not homeStateDir()'s
// `.maestro` tree -- this is deliberately the same directory Claude Code itself uses for skills.
//
// A test-only override (setSkillsDirForTests/resetSkillsDirForTests) stands in for Python's
// monkeypatch.setattr(skills_mod, "SKILLS_DIR", ...): this repo's `p_`-prefix / no-plain-monkeypatch
// convention is a Python-only rule (backend/CLAUDE.md), but there is still no way to reassign an
// imported TS binding from outside the module, so this file exposes the same
// set*ForTests/reset*ForTests seam auth/token.ts, auth/scrubber.ts, and settings/credentialStore.ts
// already use for exactly this purpose.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { atomicWriteJson } from '../../settings/store';
import { realHome } from '../../agents/manager/statePaths';
import { resolveDataRoot } from '../../auth/token';
import type { Skill, SkillCreate, SkillUpdate } from './models';

// engine/src/apps/skills -> apps -> src -> engine -> repo root, same depth/pattern as
// apps/service/version.ts's own P_REPO_ROOT.
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

let p_skillsDirOverride: string | null = null;

/** Test-only: pins SKILLS_DIR to a throwaway directory, mirroring the Python suite's
 * `monkeypatch.setattr(skills_mod, "SKILLS_DIR", str(d))`. */
export function setSkillsDirForTests(dir: string): void {
  p_skillsDirOverride = dir;
}

export function resetSkillsDirForTests(): void {
  p_skillsDirOverride = null;
}

export function skillsDir(): string {
  return p_skillsDirOverride ?? join(realHome(), '.claude', 'skills');
}

export function indexPath(): string {
  return join(skillsDir(), '.skills_index.json');
}

/** backend/config/paths.py's SKILLS_WORKSPACE_DIR = DATA_ROOT/skills_workspace. */
export function skillsWorkspaceDir(): string {
  return join(resolveDataRoot(), 'skills_workspace');
}

export type SkillIndexEntry = Record<string, unknown> & {
  name?: string;
  description?: string;
  command?: string;
  built_in?: boolean;
  source?: string;
  folder?: string;
  version?: string;
  seeded_hash?: string;
};

export type SkillIndex = Record<string, SkillIndexEntry>;

/** Read the skill index, never raising on a corrupt file. A truncated/garbled index (e.g. a crash
 * mid-write before atomic writes existed) is moved aside so it's recoverable, and we start empty
 * rather than bricking every skill op -- skills still list from their files with
 * frontmatter/filename-derived names. */
export function loadIndex(): SkillIndex {
  const path = indexPath();
  if (!existsSync(path)) return {};
  let parsed: unknown;
  let readOk = true;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    readOk = false;
  }
  if (readOk && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as SkillIndex;
  }
  try {
    renameSync(path, `${path}.corrupt`);
  } catch {
    // best-effort, matches the Python original's bare except OSError: pass.
  }
  return {};
}

/** Atomic index write: tmp file + rename so a crash mid-write can't leave a truncated index.
 * Reuses settings/store.ts's atomicWriteJson (same tmp-file + fsync + Windows-retry discipline the
 * Python original's own save_index hand-rolls). */
export function saveIndex(index: SkillIndex): void {
  atomicWriteJson(indexPath(), index);
}

interface BuiltInSkillEntry {
  id: string;
  name: string;
  description: string;
  command: string;
  source_path: string;
}

/** Built-in skills shipped with Maestro itself. Each entry describes a skill file copied into
 * ~/.claude/skills/ on first boot and tagged `built_in: true` in the index. Users can edit the
 * content (their changes flow through to the matching agent's prompt on the next turn), but can't
 * delete the file; the DELETE handler refuses with 409.
 *
 * Source markdown still lives under backend/apps/outputs/ (outputs.view_builder_templates,
 * SUB-5's "outputs (App Builder)" -- not ported yet): read directly from that on-disk location
 * rather than duplicating the file, the same "both processes read the same file during the proxy
 * period" precedent auth/token.ts's auth.token file already establishes. */
export function builtInSkillRegistry(): BuiltInSkillEntry[] {
  const outputsDir = join(P_REPO_ROOT, 'backend', 'apps', 'outputs');
  return [
    {
      id: 'app_builder_skill',
      name: 'App Builder',
      description:
        'Reference doc the App Builder agent reads on every turn. ' +
        'Edit this to change how every App Builder agent behaves; ' +
        'your edits take effect on the next turn, no restart. ' +
        'Built-in: can be edited but not deleted.',
      command: 'app-builder-skill',
      source_path: join(outputsDir, 'app_builder_skill.md'),
    },
    {
      id: 'swarm_debug_skill',
      name: 'swarm-debug Logger',
      description:
        'How to use `swarm_debug.debug()` in an App backend; the ' +
        "colored frame-aware logger that lands in the App Builder's " +
        'Terminal pane under [BACKEND]. Edit to teach your debugging ' +
        'conventions to the App Builder agent. Built-in: editable, ' +
        'not deletable.',
      command: 'swarm-debug-skill',
      source_path: join(outputsDir, 'swarm_debug_skill.md'),
    },
  ];
}

// Test-only seam mirroring the Python suite's monkeypatch.setattr(skills_mod, "p_built_in_skill_registry", ...).
let p_builtInSkillRegistryOverride: (() => BuiltInSkillEntry[]) | null = null;

export function setBuiltInSkillRegistryForTests(fn: (() => BuiltInSkillEntry[]) | null): void {
  p_builtInSkillRegistryOverride = fn;
}

function resolveBuiltInSkillRegistry(): BuiltInSkillEntry[] {
  return (p_builtInSkillRegistryOverride ?? builtInSkillRegistry)();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Copy each built-in skill into SKILLS_DIR and keep an *unedited* copy in sync with the bundled
 * source across upgrades. Idempotent; safe on every boot.
 *
 * `seeded_hash` in the index records the bytes we last wrote. A file still hashing to it was never
 * edited, so a newer bundle replaces it; a file that diverges is a user edit and is left alone.
 * Installs predating `seeded_hash` can't be told apart from an edit, so we only claim provenance
 * when the bytes already match the bundle -- otherwise they stay untracked and frozen, since
 * silently clobbering a real edit is the worse failure. Before this, seeding was create-if-absent,
 * so every install was pinned forever to whatever shipped the day it first booted. */
export function seedBuiltInSkills(): void {
  const index = loadIndex();
  let dirty = false;
  for (const entry of resolveBuiltInSkillRegistry()) {
    const fpath = join(skillsDir(), `${entry.id}.md`);
    let bundled: string;
    try {
      bundled = readFileSync(entry.source_path, 'utf8');
    } catch {
      console.warn(`built-in skill source missing: ${entry.source_path}`);
      continue;
    }
    let current: string | null = null;
    if (existsSync(fpath)) {
      try {
        current = readFileSync(fpath, 'utf8');
      } catch {
        console.warn(`built-in skill unreadable, leaving as-is: ${fpath}`);
        continue;
      }
    }
    const meta: SkillIndexEntry = { ...(index[entry.id] ?? {}) };
    const seededHash = meta.seeded_hash;
    if (current === null || (seededHash && contentHash(current) === seededHash)) {
      // Absent, or byte-identical to what we last seeded: no user edit to lose.
      if (current !== bundled) {
        try {
          mkdirSync(skillsDir(), { recursive: true });
          writeFileSync(fpath, bundled, 'utf8');
        } catch {
          console.warn(`built-in skill write failed: ${fpath}`);
          continue;
        }
      }
      meta.seeded_hash = contentHash(bundled);
    } else if (!seededHash && current === bundled) {
      // Untracked but already in sync; safe to adopt so the NEXT upgrade can move it.
      meta.seeded_hash = contentHash(bundled);
    }
    // Anything else is a user edit, or an untracked install indistinguishable from one: leave both
    // the file and its (absent) provenance alone so we never overwrite it.
    if (meta.name === undefined) meta.name = entry.name;
    if (meta.description === undefined) meta.description = entry.description;
    if (meta.command === undefined) meta.command = entry.command;
    if (!meta.built_in) meta.built_in = true;
    if (JSON.stringify(index[entry.id] ?? null) !== JSON.stringify(meta)) {
      index[entry.id] = meta;
      dirty = true;
    }
  }
  if (dirty) saveIndex(index);
}

/** Drop index entries whose skill files are gone (deleted out-of-band, e.g. a manual rm of the
 * folder), so ghosts don't pile up as dead metadata or escalate install slugs (pdf -> pdf-2 ->
 * pdf-3) by squatting a name with nothing on disk. */
export function pruneOrphanIndex(): void {
  const index = loadIndex();
  const alive: SkillIndex = {};
  for (const [id, entry] of Object.entries(index)) {
    if (skillMdPath(id)[0] !== null) alive[id] = entry;
  }
  if (Object.keys(alive).length !== Object.keys(index).length) saveIndex(alive);
}

/** One-time boot sequence mirroring skills_lifespan: ensure the dirs exist, seed built-ins, prune
 * orphans. Never throws -- a seed failure must not block engine startup (worst case, the user
 * pastes the skill in once by hand), matching the Python original's broad except+log. */
export function initSkills(): void {
  try {
    mkdirSync(skillsDir(), { recursive: true });
    mkdirSync(skillsWorkspaceDir(), { recursive: true });
    seedBuiltInSkills();
    pruneOrphanIndex();
  } catch (err) {
    console.error('failed to seed built-in skills:', err);
  }
}

export type SkillMdKind = 'folder' | 'flat';

/** Resolve where a skill's markdown lives: [path, kind]. A skill is either a folder
 * (~/.claude/skills/<id>/SKILL.md, multi-file) or a legacy flat file (~/.claude/skills/<id>.md).
 * Folder wins if both exist. The one place that knows the layout, so get/update/delete never
 * re-guess it. */
export function skillMdPath(skillId: string): [string | null, SkillMdKind] {
  const folderMd = join(skillsDir(), skillId, 'SKILL.md');
  if (isFile(folderMd)) return [folderMd, 'folder'];
  const flatMd = join(skillsDir(), `${skillId}.md`);
  if (isFile(flatMd)) return [flatMd, 'flat'];
  return [null, 'flat'];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True if a skill folder ships anything beyond its SKILL.md (scripts, templates). */
export function hasSupportingFiles(skillDir: string): boolean {
  try {
    return readdirSync(skillDir).some((e) => e !== 'SKILL.md' && !e.startsWith('.'));
  } catch {
    return false;
  }
}

/** Extract YAML frontmatter fields from a SKILL.md file. */
export function parseSkillFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('---', 3);
  if (end === -1) return {};
  const fmBlock = raw.slice(3, end).trim();
  const meta: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^(\w[\w_-]*)\s*:\s*(.+)$/.exec(line);
    if (m) {
      meta[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  return meta;
}

function titleCase(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Assemble a Skill from disk + index, falling back to SKILL.md frontmatter for a folder skill the
 * index hasn't catalogued (e.g. hand-dropped). */
export function buildSkill(skillId: string, content: string, mdPath: string, kind: SkillMdKind, index: SkillIndex): Skill {
  const meta: SkillIndexEntry = { ...(index[skillId] ?? {}) };
  if (kind === 'folder' && (meta.name === undefined || meta.description === undefined)) {
    const fm = parseSkillFrontmatter(content);
    if (meta.name === undefined) meta.name = fm.name ?? '';
    if (meta.description === undefined) meta.description = fm.description ?? '';
  }
  const pretty = titleCase(skillId);
  const skillDir = join(skillsDir(), skillId);
  return {
    id: skillId,
    name: meta.name || pretty,
    description: meta.description ?? '',
    content,
    file_path: mdPath,
    command: (meta.command as string | undefined) || skillId,
    built_in: Boolean(meta.built_in),
    dir_path: kind === 'folder' ? skillDir : '',
    has_supporting_files: kind === 'folder' && hasSupportingFiles(skillDir),
    source: meta.source ?? '',
    folder: meta.folder ?? '',
    version: meta.version ?? '',
  };
}

/** Sync skills from the filesystem, updating nothing (read-only) -- reads both layouts: legacy
 * flat <id>.md files and multi-file <id>/SKILL.md folders. */
export function syncSkills(): Skill[] {
  const index = loadIndex();
  const result: Skill[] = [];
  const seen = new Set<string>();
  const dir = skillsDir();
  if (!existsSync(dir)) return result;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let skillId: string;
    if (isDir(full)) {
      skillId = entry;
    } else if (entry.endsWith('.md')) {
      skillId = entry.slice(0, -'.md'.length);
    } else {
      continue;
    }
    if (seen.has(skillId)) continue;
    const [mdPath, kind] = skillMdPath(skillId);
    if (!mdPath) continue;
    const content = readFileSync(mdPath, 'utf8');
    seen.add(skillId);
    result.push(buildSkill(skillId, content, mdPath, kind, index));
  }
  return result;
}

/** The exact prompt block for one skill, shared by manual attach (resolveAttachedSkills) and the
 * on-demand Skill tool so both inject byte-identical text. `folder` is the supporting-files dir
 * when the skill ships any, else null. */
export function formatSkillForPrompt(name: string, content: string, folder: string | null): string {
  let block = `[Using skill: ${name}]\n\n${content}`;
  if (folder) {
    block +=
      `\n\nThis skill bundles supporting files in ${folder}. ` +
      "Read them with your normal file tools (Read / Glob / Bash) when " +
      "the steps above call for one; don't guess their contents.";
  }
  return block;
}

/** Resolve the identifier the model handed the Skill tool: exact id first, then a case-insensitive
 * match on id/command/name so a near-miss still loads. */
export function resolveSkill(skillId: string, skillsList: Skill[]): Skill | null {
  for (const s of skillsList) {
    if (s.id === skillId) return s;
  }
  const low = skillId.trim().toLowerCase();
  if (low) {
    for (const s of skillsList) {
      if (low === s.id.toLowerCase() || low === s.command.toLowerCase() || low === s.name.toLowerCase()) return s;
    }
  }
  return null;
}

export function safeSlug(raw: string | null | undefined): string {
  const slug = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

/** Existence is decided by FILES on disk only: a lingering index entry whose folder was deleted
 * out-of-band (a manual rm) is a ghost and must not block reusing its slug. */
export function skillExists(slug: string): boolean {
  return isFile(join(skillsDir(), `${slug}.md`)) || isDir(join(skillsDir(), slug));
}

/** A free slug for `base`, suffixing -2, -3, ... on collision. Lets a registry install land beside
 * a same-named skill instead of silently overwriting the user's existing one. */
export function uniqueSkillSlug(base: string): string {
  const slug = safeSlug(base);
  if (!skillExists(slug)) return slug;
  let i = 2;
  while (skillExists(`${slug}-${i}`)) i += 1;
  return `${slug}-${i}`;
}

/** Empty a skill's folder before an in-place update so files removed upstream don't linger as
 * orphans. writeFolderSkill recreates the dir right after. */
export function clearSkillDir(skillId: string): void {
  const d = join(skillsDir(), safeSlug(skillId));
  if (isDir(d)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort, matches shutil.rmtree(ignore_errors=True).
    }
  }
}

/** Resolves `dest = base/rel` and rejects anything that would land outside `base` (an absolute
 * `rel`, or one that walks up past it via `..`) -- portable across POSIX and Windows path
 * semantics, unlike a literal port of Python's os.path.commonpath check. An untrusted registry
 * archive can't write outside its own dir. */
function safeJoinWithinBase(baseAbs: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const dest = resolve(join(baseAbs, rel));
  const relFromBase = relative(baseAbs, dest);
  if (relFromBase === '' || relFromBase.startsWith('..') || isAbsolute(relFromBase)) return null;
  return dest;
}

/** Write a multi-file skill folder (relpath -> content) under SKILLS_DIR and index it. `files`
 * must include a 'SKILL.md'. Shared by registry install and future zip/.swarm import. Relpaths
 * that try to escape the skill folder (../, abs paths) are dropped. */
export function writeFolderSkill(skillId: string, files: Record<string, string>, meta: Record<string, unknown>): Skill {
  const slug = safeSlug(skillId);
  const base = join(skillsDir(), slug);
  const baseAbs = resolve(base);
  // A folder write supersedes any legacy flat <slug>.md, so we never leave a phantom flat file
  // shadowed by the folder (folder wins in skillMdPath).
  const legacyFlat = join(skillsDir(), `${slug}.md`);
  if (isFile(legacyFlat)) {
    try {
      unlinkSync(legacyFlat);
    } catch {
      // best-effort
    }
  }
  mkdirSync(base, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = safeJoinWithinBase(baseAbs, rel);
    if (dest === null) {
      console.warn(`skill import: dropped path-escape entry ${JSON.stringify(rel)}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, 'utf8');
  }

  const index = loadIndex();
  const entry: SkillIndexEntry = {
    name: (meta.name as string | undefined) || slug,
    description: (meta.description as string | undefined) ?? '',
    command: (meta.command as string | undefined) ?? slug,
  };
  // Carry provenance (source/folder/version) when an installer supplies it, so updates can be
  // detected later. User-created skills omit these and stay un-versioned.
  for (const k of ['source', 'folder', 'version'] as const) {
    const v = meta[k];
    if (v) (entry as Record<string, unknown>)[k] = v;
  }
  index[slug] = entry;
  saveIndex(index);

  const [mdPath, kind] = skillMdPath(slug);
  if (!mdPath) throw new SkillHttpError(400, 'skill had no SKILL.md');
  const content = readFileSync(mdPath, 'utf8');
  return buildSkill(slug, content, mdPath, kind, index);
}

/** Thin HTTP-status-carrying error, mirroring the Python routes' HTTPException(status_code=...) --
 * http.ts catches this and maps it to a JSON error response instead of a bare 500. */
export class SkillHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    detail: string,
  ) {
    super(detail);
  }
}

export interface ListSkillsResult {
  skills: Skill[];
}

export function listSkills(): ListSkillsResult {
  return { skills: syncSkills() };
}

export interface LoadSkillResult {
  ok: boolean;
  text?: string;
  error?: string;
  available?: string[];
}

/** Back the Skill tool: resolve a skill id to its prompt-ready text. On a miss returns the
 * installed ids (not a 404) so the model can self-correct its next call. */
export function loadSkill(id: string): LoadSkillResult {
  const skillsList = syncSkills();
  const target = resolveSkill(id, skillsList);
  if (target === null) {
    return { ok: false, error: 'unknown_skill', available: skillsList.map((s) => s.id) };
  }
  const folder = target.dir_path && target.has_supporting_files ? target.dir_path : null;
  return { ok: true, text: formatSkillForPrompt(target.name, target.content, folder) };
}

export function seedSkillWorkspace(workspaceId: string, skillContent: string | null | undefined, meta: Record<string, unknown> | null | undefined): { path: string } {
  const folder = join(skillsWorkspaceDir(), workspaceId);
  mkdirSync(folder, { recursive: true });
  if (skillContent) {
    writeFileSync(join(folder, 'SKILL.md'), skillContent, 'utf8');
  }
  if (meta) {
    writeFileSync(join(folder, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  }
  return { path: resolve(folder) };
}

export interface ReadSkillWorkspaceResult {
  skill_content: string | null;
  meta: Record<string, unknown> | null;
  frontmatter: Record<string, string>;
}

export function readSkillWorkspace(workspaceId: string): ReadSkillWorkspaceResult {
  const folder = join(skillsWorkspaceDir(), workspaceId);
  if (!isDir(folder)) throw new SkillHttpError(404, 'Workspace not found');

  let skillContent: string | null = null;
  const skillPath = join(folder, 'SKILL.md');
  if (isFile(skillPath)) skillContent = readFileSync(skillPath, 'utf8');

  let meta: Record<string, unknown> | null = null;
  const metaPath = join(folder, 'meta.json');
  if (isFile(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }

  const frontmatter = skillContent ? parseSkillFrontmatter(skillContent) : {};
  return { skill_content: skillContent, meta, frontmatter };
}

export function getSkill(skillId: string): Skill {
  for (const s of syncSkills()) {
    if (s.id === skillId) return s;
  }
  throw new SkillHttpError(404, 'Skill not found');
}

export function createSkill(body: SkillCreate): { ok: true; skill: Skill } {
  // All user skills are folders now (<id>/SKILL.md); flat files stay readable but are no longer
  // written, so a skill's on-disk shape no longer depends on how it was created vs imported.
  const meta: Record<string, unknown> = { name: body.name, description: body.description ?? '' };
  if (body.command) meta.command = body.command;
  const skill = writeFolderSkill(body.name, { 'SKILL.md': body.content }, meta);
  return { ok: true, skill };
}

export function updateSkill(skillId: string, body: SkillUpdate): { ok: true; skill: Skill } {
  const [mdPath, kind] = skillMdPath(skillId);
  if (!mdPath) throw new SkillHttpError(404, 'Skill not found');

  if (body.content !== null && body.content !== undefined) {
    writeFileSync(mdPath, body.content, 'utf8');
  }

  const index = loadIndex();
  const meta: SkillIndexEntry = { ...(index[skillId] ?? {}) };
  if (body.name !== null && body.name !== undefined) meta.name = body.name;
  if (body.description !== null && body.description !== undefined) meta.description = body.description;
  if (body.command !== null && body.command !== undefined) meta.command = body.command;
  index[skillId] = meta;
  saveIndex(index);

  const content = readFileSync(mdPath, 'utf8');
  const skill = buildSkill(skillId, content, mdPath, kind, index);
  return { ok: true, skill };
}

export function deleteSkill(skillId: string): { ok: true } {
  const index = loadIndex();
  if (index[skillId]?.built_in) {
    throw new SkillHttpError(
      409,
      `'${skillId}' is a built-in skill and can't be deleted ` +
        "(edit its content instead; your edits take effect on " +
        'the next agent turn).',
    );
  }
  // Remove whichever layout exists: the whole folder, or the flat file.
  const skillDir = join(skillsDir(), skillId);
  const flat = join(skillsDir(), `${skillId}.md`);
  if (isDir(skillDir)) {
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {
      // best-effort, matches shutil.rmtree(ignore_errors=True).
    }
  }
  if (isFile(flat)) unlinkSync(flat);
  delete index[skillId];
  saveIndex(index);
  return { ok: true };
}
