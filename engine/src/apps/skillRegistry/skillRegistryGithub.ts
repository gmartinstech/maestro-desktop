// engine/src/apps/skillRegistry/skillRegistryGithub.ts -- SUB-2, a full TypeScript port of
// backend/apps/skill_registry/skill_registry_github.py: the pure GitHub-tree resolution logic
// (SKILL.md selection, script disclosure, rate-limit signaling) plus the two live-network calls
// (tree_at/fetch_repo_tree) that need an HTTP client.
//
// Uses the engine's own fetch wrapper (net/http.ts's engineFetch) rather than a raw `fetch()` --
// see that file's header: the provider-egress ESLint rule requires every outbound network call in
// engine/src (net/ itself and pythonBackend.ts/localProxy.ts's raw node:http proxy plumbing
// excepted) to go through it, so an egress audit has one place to look.

import { engineFetch } from '../../net/http';

export const GH_API = 'https://api.github.com';
export const MAX_SKILL_FILES = 60;
const SCRIPT_EXTS = ['.sh', '.py', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl', '.ps1', '.bat', '.php'];

/** GitHub's unauthenticated API (60/hr) is exhausted; the caller surfaces a 'try again shortly'
 * rather than a generic failure. */
export class RegistryRateLimited extends Error {
  constructor() {
    super('GitHub rate limit exceeded');
    this.name = 'RegistryRateLimited';
  }
}

/** Stand-in for the Python original's `raise ValueError(...)` call sites throughout this module
 * and skillRegistrySources.ts -- a distinct class (not message-prefix sniffing) so
 * skillRegistry.ts's route handlers can map exactly these to a 404, the same
 * `except ValueError as e: raise HTTPException(404, str(e))` dispatch Python's routes do. */
export class SkillRegistryValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillRegistryValueError';
  }
}

export interface GithubTreeEntry {
  type: string;
  path: string;
  sha?: string;
}

/** Split YAML frontmatter from markdown body. */
export function parseFrontmatter(raw: string): [Record<string, string>, string] {
  if (!raw.startsWith('---')) return [{}, raw];
  const end = raw.indexOf('---', 3);
  if (end === -1) return [{}, raw];
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 3).trim();
  const meta: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^(\w[\w_-]*)\s*:\s*(.+)$/.exec(line);
    if (m) {
      meta[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  return [meta, body];
}

/** Whether a skill file is executable code worth disclosing before install. */
export function isScriptPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  if (SCRIPT_EXTS.some((ext) => lower.endsWith(ext))) return true;
  const head = rel.split('/', 1)[0].toLowerCase();
  return head === 'scripts' || head === 'bin' || head === 'hooks';
}

/** GitHub request headers, with auth if a token is set. Unauthenticated is 60 req/hr/IP (fine for
 * the odd install, the wall for a power user); a token (MAESTRO_GITHUB_TOKEN or GITHUB_TOKEN)
 * raises it to 5000/hr. */
export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'maestro-skill-registry', Accept: 'application/vnd.github+json' };
  const token = process.env.MAESTRO_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** From a GitHub recursive tree, pick the SKILL.md for `skillId` and every file beside it. Pure,
 * so the resolution logic is unit-tested without a network round-trip. When a repo has several
 * `<x>/<skill_id>/SKILL.md` matches the pick is deterministic: prefer a top-level `<skill_id>/`,
 * then `skills/<skill_id>/`, then the shallowest, then alphabetical, never an arbitrary tie. */
export function selectSkillPaths(tree: GithubTreeEntry[], skillId: string): [string, string[]] {
  const blobs = tree.filter((t) => t.type === 'blob' && typeof t.path === 'string').map((t) => t.path);
  const candidates = blobs.filter((p) => p.endsWith(`/${skillId}/SKILL.md`) || p === `${skillId}/SKILL.md`);
  if (candidates.length === 0) {
    throw new SkillRegistryValueError(`no SKILL.md for '${skillId}' in this repo`);
  }

  const rank = (p: string): [number, number, string] => {
    if (p === `${skillId}/SKILL.md`) return [0, 0, p];
    if (p === `skills/${skillId}/SKILL.md`) return [1, p.split('/').length - 1, p];
    return [2, p.split('/').length - 1, p];
  };
  const skillMd = candidates.reduce((best, cur) => (compareRank(rank(cur), rank(best)) < 0 ? cur : best));
  const skillDir = skillMd.includes('/') ? skillMd.slice(0, -'/SKILL.md'.length) : '';
  const prefix = skillDir ? `${skillDir}/` : '';
  const members = blobs.filter((p) => (prefix ? p.startsWith(prefix) : !p.includes('/')));
  return [skillMd, members.slice(0, MAX_SKILL_FILES)];
}

function compareRank(a: [number, number, string], b: [number, number, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

/** The blob (file) paths from a GitHub recursive tree, ignoring tree (dir) entries. */
export function treeBlobPaths(tree: GithubTreeEntry[]): string[] {
  return tree.filter((t) => t.type === 'blob' && typeof t.path === 'string').map((t) => t.path);
}

/** The git tree SHA of `folder` within a recursive tree: a per-folder fingerprint that changes
 * iff something inside it changes, so one skill going stale never marks its siblings stale. ''
 * when the folder isn't present as a tree entry. */
export function folderTreeSha(tree: GithubTreeEntry[], folder: string): string {
  for (const t of tree) {
    if (t.type === 'tree' && t.path === folder) return t.sha ?? '';
  }
  return '';
}

/** (tree | null) for a branch. null on 404 (branch absent); raises on rate limit. GitHub signals
 * the limit as 403 (primary) or 429 (secondary), so treat both. */
export async function treeAt(owner: string, repo: string, branch: string): Promise<GithubTreeEntry[] | null> {
  const res = await engineFetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers: githubHeaders() });
  if (res.status === 200) {
    const body = (await res.json()) as { tree?: GithubTreeEntry[] };
    return body.tree ?? [];
  }
  if (res.status === 403 || res.status === 429) throw new RegistryRateLimited();
  return null;
}

/** Recursive tree of owner/repo. Tries main then master first (one call, the 99% case, no quota
 * wasted on a repo-meta lookup); only if BOTH are absent does it ask the repo for its real default
 * branch (handles develop/trunk/etc). Raises RegistryRateLimited on a 403, an Error if no branch
 * resolves. */
export async function fetchRepoTree(owner: string, repo: string): Promise<[string, GithubTreeEntry[]]> {
  for (const branch of ['main', 'master']) {
    const tree = await treeAt(owner, repo, branch);
    if (tree !== null) return [branch, tree];
  }
  const meta = await engineFetch(`${GH_API}/repos/${owner}/${repo}`, { headers: githubHeaders() });
  if (meta.status === 403) throw new RegistryRateLimited();
  if (meta.status === 200) {
    const body = (await meta.json()) as { default_branch?: string };
    const defaultBranch = body.default_branch;
    if (defaultBranch && defaultBranch !== 'main' && defaultBranch !== 'master') {
      const tree = await treeAt(owner, repo, defaultBranch);
      if (tree !== null) return [defaultBranch, tree];
    }
  }
  throw new SkillRegistryValueError(`repo ${owner}/${repo} has no resolvable default branch`);
}
