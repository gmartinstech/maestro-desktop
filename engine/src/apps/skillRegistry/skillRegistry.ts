// engine/src/apps/skillRegistry/skillRegistry.ts -- SUB-2, a full TypeScript port of
// backend/apps/skill_registry/skill_registry.py: the in-memory catalog cache, the hourly
// refresh-with-backoff loop, and the route-level logic (HTTP wiring is http.ts).

import { SkillHttpError, uniqueSkillSlug, writeFolderSkill, clearSkillDir, syncSkills } from '../skills/skills';
import { folderTreeSha, RegistryRateLimited, SkillRegistryValueError } from './skillRegistryGithub';
import { loadSeedCache, saveDiskCache, type CachedSkill } from './skillRegistryCache';
import {
  REPO,
  communitySearch,
  fetchAllSkills,
  resolveCommunitySkill,
  resolveCuratedSkill,
  safeRepoTree,
  searchCurated,
  warmCuratedTree,
  curatedTree,
  type CommunitySearchResult,
  type CuratedSearchResult,
  type FetchedSkill,
  type ResolvedSkill,
} from './skillRegistrySources';

const REFRESH_INTERVAL_MS = 3_600_000;
// Retry the startup fetch on this short backoff (capped) until the FIRST success, instead of
// waiting a full REFRESH_INTERVAL_MS after a cold/slow/failed fetch. That 1h gap was the "skills
// empty until reboot" bug on cold Windows networks.
const P_RETRY_BACKOFF_START_MS = 2_000;
const P_RETRY_BACKOFF_MAX_MS = 60_000;

let p_cache: Record<string, FetchedSkill> = {};
let p_cacheUpdatedAt = 0;
let p_refreshTimer: ReturnType<typeof setTimeout> | null = null;
let p_wakeResolve: (() => void) | null = null;
let p_stopped = false;

export function getCache(): Record<string, FetchedSkill> {
  return p_cache;
}

/** Test-only: mirrors the Python suite's `sr.p_cache = {...}` / `sr_routes.p_cache = {...}` direct
 * module-attribute reassignment (see this file's own header on why a plain exported `let` can't be
 * reassigned from another module under tsc's CJS emit). */
export function setCacheForTests(data: Record<string, FetchedSkill>): void {
  p_cache = data;
}

export function resetSkillRegistryStateForTests(): void {
  p_cache = {};
  p_cacheUpdatedAt = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    p_wakeResolve = resolve;
    p_refreshTimer = setTimeout(() => {
      p_refreshTimer = null;
      p_wakeResolve = null;
      resolve();
    }, ms);
  });
}

async function refreshLoop(): Promise<void> {
  let backoff = P_RETRY_BACKOFF_START_MS;
  while (!p_stopped) {
    let ok = false;
    try {
      const fetched = await fetchAllSkills();
      if (Object.keys(fetched).length > 0) {
        p_cache = fetched;
        p_cacheUpdatedAt = Date.now() / 1000;
        saveDiskCache(fetched);
        ok = true;
      }
    } catch (e) {
      console.error(`Skill registry refresh error: ${String(e)}`);
    }
    if (p_stopped) return;
    if (ok) {
      // Warm the curated file-tree on the SLOW path only (never on the fast failure-retry below,
      // which would burn the 60/hr quota in seconds).
      await warmCuratedTree();
      backoff = P_RETRY_BACKOFF_START_MS;
      await sleep(REFRESH_INTERVAL_MS);
    } else {
      // Cold/slow/failed fetch: retry soon (capped) until the first success so a transient
      // network hiccup doesn't leave the catalog empty for an hour. The seeded snapshot keeps it
      // non-empty meanwhile.
      await sleep(backoff);
      backoff = Math.min(backoff * 2, P_RETRY_BACKOFF_MAX_MS);
    }
  }
}

/** Mirrors skill_registry_lifespan: seed instantly from disk/bundled snapshot so the very first
 * request never sees an empty catalog (the live fetch overwrites it when it lands), then starts
 * the background refresh loop. Only meaningful once ('skill-registry' flipped native) -- see
 * main.ts's own gating comment for why this isn't called unconditionally. */
export function startSkillRegistry(): void {
  if (Object.keys(p_cache).length === 0) {
    p_cache = loadSeedCache();
  }
  p_stopped = false;
  void refreshLoop();
}

/** Cancels the pending sleep and stops the refresh loop from scheduling another cycle -- mirrors
 * skill_registry_lifespan's `p_refresh_task.cancel()` on shutdown. */
export function stopSkillRegistry(): void {
  p_stopped = true;
  if (p_refreshTimer) {
    clearTimeout(p_refreshTimer);
    p_refreshTimer = null;
  }
  // Wake a pending sleep() immediately (mirrors Python's `p_refresh_task.cancel()` interrupting
  // whichever `await asyncio.sleep(...)` the loop is parked in) rather than leaving it to time out
  // on its own -- refreshLoop's own `while (!p_stopped)` / post-sleep check then exits the loop.
  if (p_wakeResolve) {
    const resolve = p_wakeResolve;
    p_wakeResolve = null;
    resolve();
  }
}

export interface RegistryStats {
  total: number;
  categories: Record<string, number>;
  lastUpdated: number;
}

export function registryStats(): RegistryStats {
  const categories: Record<string, number> = {};
  for (const s of Object.values(p_cache)) {
    const cat = s.category || 'General';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }
  return { total: Object.keys(p_cache).length, categories, lastUpdated: p_cacheUpdatedAt };
}

export interface RegistrySearchParams {
  q?: string;
  limit?: number;
  offset?: number;
  category?: string;
  source?: 'curated' | 'community';
}

export async function registrySearch(params: RegistrySearchParams): Promise<CuratedSearchResult | (CommunitySearchResult & { error?: string })> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const category = params.category ?? '';
  const q = params.q ?? '';
  // The wild registry is a remote 600k-entry index, searched live, not mirrored.
  if (params.source === 'community') {
    try {
      return await communitySearch(q, limit);
    } catch (e) {
      console.warn(`community skill search failed: ${String(e)}`);
      return { skills: [], total: 0, offset: 0, limit, source: 'community', error: 'skills.sh unreachable' };
    }
  }
  return searchCurated(p_cache, q, category, offset, limit);
}

export function registryDetail(skillName: string): { skill: FetchedSkill } | { error: string } {
  const sk = p_cache[skillName];
  if (!sk) return { error: 'Skill not found' };
  return { skill: sk };
}

export interface InstallRequest {
  source: string;
  skill_id: string;
  confirm?: boolean;
}

export interface InstallDisclosure {
  name: string;
  description: string;
  repo_url: string;
  skill_md: string;
  files: string[];
  scripts: string[];
  has_scripts: boolean;
  secret_findings: string[];
}

function toDisclosure(resolved: ResolvedSkill): InstallDisclosure {
  return {
    name: resolved.name,
    description: resolved.description,
    repo_url: resolved.repo_url,
    skill_md: resolved.files['SKILL.md'] ?? '',
    files: Object.keys(resolved.files).sort(),
    scripts: resolved.scripts,
    has_scripts: resolved.scripts.length > 0,
    secret_findings: resolved.secret_findings,
  };
}

/** Install a community (skills.sh) skill, in two honest steps.
 *
 * confirm=false (default): resolve + return a disclosure (the SKILL.md and the list of files,
 * flagging scripts) WITHOUT writing anything, so the user sees exactly what they're about to
 * install from an unvetted repo.
 * confirm=true: write the skill folder to ~/.claude/skills/. Files only; no script is executed
 * here. Curated skills install via the normal skills CRUD; this endpoint is the wild-registry
 * path. */
export async function registryInstall(req: InstallRequest) {
  let resolved: ResolvedSkill;
  try {
    resolved = await resolveCommunitySkill(req.source, req.skill_id);
  } catch (e) {
    if (e instanceof RegistryRateLimited) {
      throw new SkillHttpError(429, 'GitHub rate limit hit fetching this skill; try again in a few minutes.');
    }
    if (e instanceof SkillRegistryValueError) {
      throw new SkillHttpError(404, e.message);
    }
    throw new SkillHttpError(502, `could not fetch skill: ${e instanceof Error ? e.message : String(e)}`);
  }

  const disclosure = toDisclosure(resolved);
  if (!req.confirm) {
    return { installed: false, disclosure };
  }

  // Never clobber an existing local skill that happens to share this slug; a wild-registry name
  // collision lands as a copy instead of overwriting.
  const slug = uniqueSkillSlug(resolved.skill_id);
  const skill = writeFolderSkill(slug, resolved.files, {
    name: resolved.name,
    description: resolved.description,
    source: resolved.source ?? '',
    folder: resolved.folder ?? '',
    version: resolved.version ?? '',
  });
  return { installed: true, skill, disclosure };
}

export interface CuratedInstallRequest {
  folder: string;
}

/** Offline/rate-limited curated-install fallback: rebuild a single-SKILL.md install payload from
 * the warmed catalog (it already holds the SKILL.md body) so a curated install still works when
 * GitHub is unreachable, minus the folder's extra files. Empty version means it's skipped by
 * update checks until re-installed online. */
function cachedCuratedFallback(folder: string): ResolvedSkill | null {
  const cached = Object.values(p_cache).find((s) => s.folder === folder);
  if (!cached) return null;
  const { name = '', description = '', content = '' } = cached;
  return {
    name,
    description,
    repo_url: '',
    skill_id: folder.split('/').pop() ?? folder,
    files: { 'SKILL.md': `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}` },
    scripts: [],
    secret_findings: [],
    source: REPO,
    folder,
    version: '',
  };
}

/** Install a curated (anthropics/skills) skill with its FULL folder, not just SKILL.md, so
 * scripts/assets land too. Curated is the vetted source, so this is one-click; files are still
 * written inert, never executed. When GitHub is unreachable (offline / rate-limited) it falls back
 * to the catalog's cached SKILL.md, so the install still works (single file, no folder extras). */
export async function registryInstallCurated(req: CuratedInstallRequest) {
  let resolved: ResolvedSkill;
  try {
    resolved = await resolveCuratedSkill(req.folder);
  } catch (e) {
    if (e instanceof SkillRegistryValueError) {
      throw new SkillHttpError(404, e.message);
    }
    const fallback = cachedCuratedFallback(req.folder);
    if (fallback === null) {
      if (e instanceof RegistryRateLimited) {
        throw new SkillHttpError(429, 'GitHub rate limit hit and no cached copy of this skill; try again in a few minutes.');
      }
      throw new SkillHttpError(502, `GitHub unreachable and no cached copy: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(
      `curated install: GitHub unreachable (${e instanceof Error ? e.constructor.name : typeof e}); installing '${req.folder}' from cached SKILL.md (single file, no folder extras)`,
    );
    resolved = fallback;
  }

  const slug = uniqueSkillSlug(resolved.skill_id);
  const skill = writeFolderSkill(slug, resolved.files, {
    name: resolved.name,
    description: resolved.description,
    source: resolved.source ?? '',
    folder: resolved.folder ?? '',
    version: resolved.version ?? '',
  });
  return { installed: true, skill, files: Object.keys(resolved.files).sort(), scripts: resolved.scripts };
}

export interface RegistryUpdatesResult {
  outdated: string[];
  checked: string[];
  unknown: string[];
}

/** Which installed skills have a newer version upstream. Curated skills check against the warmed
 * tree (zero API calls); community skills re-fetch their repo tree (best-effort, deduped per repo,
 * cached). A skill with no recorded source (user-created, or installed before versioning) is
 * skipped, not reported. */
export async function registryUpdates(): Promise<RegistryUpdatesResult> {
  const outdated: string[] = [];
  const checked: string[] = [];
  const unknown: string[] = [];
  const communityTrees = new Map<string, Awaited<ReturnType<typeof safeRepoTree>>>();
  for (const s of syncSkills()) {
    if (!s.source || !s.folder || !s.version) continue;
    let tree;
    if (s.source === REPO) {
      tree = curatedTree();
    } else {
      if (!communityTrees.has(s.source)) {
        communityTrees.set(s.source, await safeRepoTree(s.source));
      }
      tree = communityTrees.get(s.source) ?? null;
    }
    if (!tree || tree.length === 0) {
      unknown.push(s.id);
      continue;
    }
    const current = folderTreeSha(tree, s.folder);
    checked.push(s.id);
    if (current && current !== s.version) outdated.push(s.id);
  }
  return { outdated, checked, unknown };
}

export interface UpdateRequest {
  skill_id: string;
}

/** Re-fetch an installed skill from its recorded source and overwrite it in place, bumping its
 * version. Re-runs the secret scan and returns any findings so the UI can flag a community update
 * that newly ships secrets. A skill with no source (user-made) can't be updated. */
export async function registryUpdate(req: UpdateRequest) {
  const target = syncSkills().find((s) => s.id === req.skill_id);
  if (target === undefined) throw new SkillHttpError(404, 'skill not found');
  if (!target.source || !target.folder) throw new SkillHttpError(400, 'this skill has no upstream source to update from');

  let resolved: ResolvedSkill;
  try {
    resolved = target.source === REPO ? await resolveCuratedSkill(target.folder) : await resolveCommunitySkill(target.source, target.folder.split('/').pop() ?? target.folder);
  } catch (e) {
    if (e instanceof RegistryRateLimited) throw new SkillHttpError(429, 'GitHub rate limit hit; try again in a few minutes.');
    if (e instanceof SkillRegistryValueError) {
      throw new SkillHttpError(404, e.message);
    }
    throw new SkillHttpError(502, `could not fetch skill: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Overwrite in place: clear first so files removed upstream don't linger, keep the user's
  // command alias, refresh everything else from source.
  clearSkillDir(target.id);
  const skill = writeFolderSkill(target.id, resolved.files, {
    name: resolved.name,
    description: resolved.description,
    command: target.command,
    source: resolved.source ?? '',
    folder: resolved.folder ?? '',
    version: resolved.version ?? '',
  });
  return { updated: true, skill, scripts: resolved.scripts, secret_findings: resolved.secret_findings };
}

export type { CachedSkill };
