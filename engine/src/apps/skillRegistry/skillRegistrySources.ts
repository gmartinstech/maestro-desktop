// engine/src/apps/skillRegistry/skillRegistrySources.ts -- SUB-2, a full TypeScript port of
// backend/apps/skill_registry/skill_registry_sources.py: the curated (anthropics/skills) +
// community (skills.sh) catalog fetchers, the resolve-a-skill-to-its-full-file-set logic, and the
// curated in-memory search.

import { engineFetch } from '../../net/http';
import { findSecretsInFiles } from './secretScan';
import type { CachedSkill } from './skillRegistryCache';
import {
  MAX_SKILL_FILES,
  RegistryRateLimited,
  SkillRegistryValueError,
  fetchRepoTree,
  folderTreeSha,
  isScriptPath,
  parseFrontmatter,
  selectSkillPaths,
  treeAt,
  treeBlobPaths,
  type GithubTreeEntry,
} from './skillRegistryGithub';

export const REPO = 'anthropics/skills';
export const BRANCH = 'main';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
export const MANIFEST_URL = `${RAW_BASE}/.claude-plugin/marketplace.json`;
const CONCURRENT_FETCHES = 15;
export const GH_RAW = 'https://raw.githubusercontent.com';
export const COMMUNITY_SEARCH_URL = 'https://skills.sh/api/search';
const P_COMMUNITY_TREE_TTL_MS = 600_000;

// Alias, not a near-duplicate: skillRegistryCache.ts's CachedSkill is the canonical shape (see its
// own doc comment) -- a live GitHub fetch and a loaded cache entry are the same catalog-entry
// shape, so this is one type with two names for readability at each call site.
export type FetchedSkill = CachedSkill;

// The curated repo's recursive file tree, warmed hourly alongside the catalog. A curated install
// reads paths from here and fetches contents over raw, so it makes ZERO GitHub API calls in the
// normal case (the trees API is the 60/hr-limited part); update detection reads per-folder tree
// SHAs from it too. Empty until the first refresh warms it; install falls back to one live tree
// call then. Exposed only via curatedTree()/setCuratedTreeForTests (not a plain exported `let`) --
// tsc's CJS-interop emit gives an imported `let` binding no external setter, so this is the same
// set*ForTests seam skills.ts/auth/token.ts already use, standing in for Python's
// `monkeypatch.setattr(sr, "curated_tree", ...)`.
let p_curatedTree: GithubTreeEntry[] = [];

export function curatedTree(): GithubTreeEntry[] {
  return p_curatedTree;
}

export function setCuratedTreeForTests(tree: GithubTreeEntry[]): void {
  p_curatedTree = tree;
}

// Community repo trees for update detection, cached briefly (best-effort) so an updates check on
// skills.sh-installed skills doesn't refetch every page load nor burn the API.
const p_communityTreeCache = new Map<string, [number, GithubTreeEntry[] | null]>();

/** Bounded-concurrency map: runs `fn` over every item, at most `limit` in flight at once. Stand-in
 * for Python's `asyncio.Semaphore(CONCURRENT_FETCHES)` + `asyncio.gather`. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface ManifestSkillPath {
  folder: string;
  pluginName: string;
}

/** Fetch the marketplace.json manifest and return (skill_folder, plugin_name) pairs. Uses
 * raw.githubusercontent.com; no GitHub API needed, no rate limiting. */
async function fetchSkillPaths(): Promise<ManifestSkillPath[]> {
  const resp = await engineFetch(MANIFEST_URL);
  if (!resp.ok) throw new Error(`manifest fetch failed: ${resp.status}`);
  const manifest = (await resp.json()) as { plugins?: Array<{ name?: string; skills?: string[] }> };
  const paths: ManifestSkillPath[] = [];
  for (const plugin of manifest.plugins ?? []) {
    const pluginName = plugin.name ?? '';
    for (const skillRef of plugin.skills ?? []) {
      const folder = skillRef.replace(/^\.\//, '');
      paths.push({ folder, pluginName });
    }
  }
  return paths;
}

function titleCaseWords(text: string): string {
  return text
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function fetchOneSkill(folder: string, pluginName: string): Promise<FetchedSkill | null> {
  let raw: string;
  try {
    const resp = await engineFetch(`${RAW_BASE}/${folder}/SKILL.md`);
    if (resp.status !== 200) return null;
    raw = await resp.text();
  } catch {
    return null;
  }
  const [meta, body] = parseFrontmatter(raw);
  let name = meta.name ?? '';
  if (!name) {
    const folderName = folder.split('/').pop() ?? folder;
    name = titleCaseWords(folderName);
  }
  return {
    name,
    description: meta.description ?? '',
    content: body,
    folder,
    category: titleCaseWords(pluginName),
    repositoryUrl: `https://github.com/${REPO}/tree/${BRANCH}/${folder}`,
  };
}

export async function fetchAllSkills(): Promise<Record<string, FetchedSkill>> {
  const skills: Record<string, FetchedSkill> = {};
  let paths: ManifestSkillPath[];
  try {
    paths = await fetchSkillPaths();
  } catch (e) {
    console.warn(`Skill registry manifest fetch failed: ${String(e)}`);
    return skills;
  }
  console.log(`Skill registry: found ${paths.length} skills in manifest, fetching content...`);
  const results = await mapWithConcurrency(paths, CONCURRENT_FETCHES, ({ folder, pluginName }) => fetchOneSkill(folder, pluginName));
  for (const rec of results) {
    if (rec) skills[rec.name] = rec;
  }
  console.log(`Skill registry cache refreshed: ${Object.keys(skills).length} skills`);
  return skills;
}

/** Best-effort: list the anthropics/skills repo once and cache its file paths so curated installs
 * need ZERO trees-API calls (they read paths here, fetch contents over raw). One cheap call per
 * hourly refresh, reused by every install in that hour. Isolated, a failure here never touches the
 * SKILL.md catalog; install falls back to a live tree call while the cache is cold. */
export async function warmCuratedTree(): Promise<void> {
  const [owner, repo] = REPO.split('/');
  try {
    const tree = await treeAt(owner, repo, BRANCH);
    if (tree) {
      p_curatedTree = tree;
      console.log(`Curated skill tree warmed: ${treeBlobPaths(tree).length} file paths cached`);
    }
  } catch (e) {
    if (e instanceof RegistryRateLimited) {
      // Visible on purpose: a rate-limited warm-up means installs stay on the slow live-call path
      // until the IP's quota resets or a token is set.
      console.warn(
        'Curated tree warm-up rate-limited by GitHub (60/hr anon limit). Set GITHUB_TOKEN or wait for the hourly reset; installs use a live tree call meanwhile.',
      );
    } else {
      console.debug('curated tree warm-up failed; installs fall back to a live tree call');
    }
  }
}

export interface ResolvedSkill {
  name: string;
  description: string;
  repo_url: string;
  skill_id: string;
  files: Record<string, string>;
  scripts: string[];
  secret_findings: string[];
  source: string;
  folder: string;
  version: string;
}

/** Fetch every member file of a resolved skill folder and assemble the install payload (relpaths,
 * scripts list, secret scan, provenance). Shared by the community and curated resolvers so both
 * install the WHOLE folder identically. Fetches text only; never runs anything. `version` is the
 * folder's tree SHA, the update fingerprint. */
async function buildResolvedSkill(
  owner: string,
  repo: string,
  branch: string,
  skillDir: string,
  members: string[],
  skillId: string,
  version: string,
): Promise<ResolvedSkill> {
  const prefix = skillDir ? `${skillDir}/` : '';
  const files: Record<string, string> = {};
  for (const p of members) {
    const rel = prefix ? p.slice(prefix.length) : p;
    const raw = await engineFetch(`${GH_RAW}/${owner}/${repo}/${branch}/${p}`);
    if (raw.status === 200) files[rel] = await raw.text();
  }
  if (!('SKILL.md' in files)) throw new SkillRegistryValueError('SKILL.md could not be fetched');

  const [meta] = parseFrontmatter(files['SKILL.md']);
  // Reuse the .swarm importer's content scan: flag files holding secret-shaped literals (the
  // author's leaked key, or a sketchy skill) so the user sees it before installing from an
  // unvetted repo.
  const secretFindings = findSecretsInFiles(
    Object.fromEntries(Object.entries(files).map(([rel, data]) => [rel, Buffer.from(data, 'utf8')])),
  );
  return {
    name: meta.name || skillId,
    description: meta.description ?? '',
    repo_url: `https://github.com/${owner}/${repo}/tree/${branch}/${skillDir}`.replace(/\/$/, ''),
    skill_id: skillId,
    files,
    scripts: Object.keys(files)
      .filter((rel) => isScriptPath(rel))
      .sort(),
    secret_findings: secretFindings,
    source: `${owner}/${repo}`,
    folder: skillDir,
    version,
  };
}

/** Resolve a skills.sh entry (source='owner/repo', skill_id=folder name) to its files via the
 * GitHub trees API. Returns name/description/repo_url plus {relpath: content} and the list of
 * script files. Fetches text only; never runs anything. Throws on a bad source or a missing
 * skill, and RegistryRateLimited when GitHub's anon API is exhausted. */
export async function resolveCommunitySkill(source: string, skillId: string): Promise<ResolvedSkill> {
  const [owner, repo] = source.split(/\/(.*)/s);
  if (!owner || !repo) throw new SkillRegistryValueError(`unrecognized source '${source}' (expected owner/repo)`);
  const [branch, tree] = await fetchRepoTree(owner, repo);
  const [skillMd, members] = selectSkillPaths(tree, skillId);
  const skillDir = skillMd.includes('/') ? skillMd.slice(0, -'/SKILL.md'.length) : '';
  const version = folderTreeSha(tree, skillDir);
  return buildResolvedSkill(owner, repo, branch, skillDir, members, skillId, version);
}

/** Resolve a curated (anthropics/skills) skill folder to ALL its files via the GitHub trees API,
 * so multi-file curated skills (pdf/docx/pptx scripts, etc.) install whole instead of just their
 * SKILL.md. The exact folder comes from our catalog, so we match it precisely (not by basename).
 * Same payload shape as resolveCommunitySkill. Throws if the folder has no SKILL.md and
 * RegistryRateLimited when GitHub's anon API is exhausted. */
export async function resolveCuratedSkill(folder: string): Promise<ResolvedSkill> {
  const [owner, repo] = REPO.split('/');
  const skillDir = folder.replace(/\/$/, '');
  const skillId = skillDir.split('/').pop() ?? skillDir;
  const prefix = `${skillDir}/`;
  let tree = p_curatedTree;
  if (tree.length === 0) {
    // Cold cache (pre-first-refresh, or a failed/rate-limited warm-up): pay one live tree call
    // this once.
    const live = await treeAt(owner, repo, BRANCH);
    if (live === null) throw new SkillRegistryValueError(`could not read ${REPO}@${BRANCH} tree`);
    tree = live;
  }
  const blobs = treeBlobPaths(tree);
  if (!blobs.includes(`${prefix}SKILL.md`)) throw new SkillRegistryValueError(`no SKILL.md at '${folder}'`);
  const members = blobs.filter((p) => p.startsWith(prefix)).slice(0, MAX_SKILL_FILES);
  const version = folderTreeSha(tree, skillDir);
  return buildResolvedSkill(owner, repo, BRANCH, skillDir, members, skillId, version);
}

export interface CuratedSearchResult {
  skills: Array<{ name: string; description: string; folder: string; category: string; repositoryUrl: string }>;
  total: number;
  offset: number;
  limit: number;
}

/** Filter + paginate the in-memory curated catalog. Pure (cache passed in) so the route stays a
 * thin wrapper and this layer owns all skill-data shaping. */
export function searchCurated(cache: Record<string, FetchedSkill>, q: string, category: string, offset: number, limit: number): CuratedSearchResult {
  let pool = Object.values(cache);
  if (category) {
    const catLower = category.toLowerCase();
    pool = pool.filter((s) => (s.category ?? '').toLowerCase() === catLower);
  }
  const queryLower = q.toLowerCase().trim();
  if (queryLower) {
    pool = pool.filter((s) => `${s.name} ${s.description} ${s.category ?? ''}`.toLowerCase().includes(queryLower));
  }
  pool = [...pool].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const total = pool.length;
  const page = pool.slice(offset, offset + limit);
  const summary = page.map((s) => ({
    name: s.name,
    description: s.description,
    folder: s.folder,
    category: s.category || 'General',
    repositoryUrl: s.repositoryUrl ?? '',
  }));
  return { skills: summary, total, offset, limit };
}

export interface CommunitySearchResult {
  skills: Array<{
    name: string;
    description: string;
    folder: string;
    category: string;
    repositoryUrl: string;
    source: string;
    skillId: string;
    installs: number;
    community: true;
  }>;
  total: number;
  offset: number;
  limit: number;
  source: 'community';
}

/** Live-proxy a query to the skills.sh wild registry. Not cached: it's a 600k-entry remote index,
 * so we search it on demand rather than mirror it. */
export async function communitySearch(q: string, limit: number): Promise<CommunitySearchResult> {
  const url = new URL(COMMUNITY_SEARCH_URL);
  url.searchParams.set('q', q || 'skill');
  const r = await engineFetch(url, { headers: { 'User-Agent': 'maestro' } });
  if (!r.ok) throw new Error(`skills.sh search failed: ${r.status}`);
  const data = (await r.json()) as { skills?: Array<Record<string, unknown>> };
  const skills = (data.skills ?? []).slice(0, limit).map((s) => {
    const src = (s.source as string | undefined) ?? '';
    let installs = 0;
    const rawInstalls = s.installs;
    if (typeof rawInstalls === 'number') installs = rawInstalls;
    else if (typeof rawInstalls === 'string' && rawInstalls.trim() !== '' && !Number.isNaN(Number(rawInstalls))) installs = Number(rawInstalls);
    return {
      name: (s.name as string | undefined) ?? '',
      description: `${installs.toLocaleString('en-US')} installs`,
      folder: (s.skillId as string | undefined) ?? '',
      category: src,
      repositoryUrl: src ? `https://github.com/${src}` : '',
      source: src,
      skillId: (s.skillId as string | undefined) ?? '',
      installs,
      community: true as const,
    };
  });
  return { skills, total: skills.length, offset: 0, limit, source: 'community' };
}

/** Recursive tree for a community 'owner/repo', cached briefly and best-effort (null on
 * rate-limit / missing repo) so an updates check never fails the whole list because one repo is
 * unreachable. */
export async function safeRepoTree(source: string): Promise<GithubTreeEntry[] | null> {
  const now = Date.now();
  const hit = p_communityTreeCache.get(source);
  if (hit && now - hit[0] < P_COMMUNITY_TREE_TTL_MS) return hit[1];
  const [owner, repo] = source.split(/\/(.*)/s);
  let tree: GithubTreeEntry[] | null = null;
  if (owner && repo) {
    try {
      [, tree] = await fetchRepoTree(owner, repo);
    } catch {
      tree = null;
    }
  }
  p_communityTreeCache.set(source, [now, tree]);
  return tree;
}
