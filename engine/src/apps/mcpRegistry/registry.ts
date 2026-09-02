// engine/src/apps/mcpRegistry/registry.ts -- SUB-4, a full port of
// backend/apps/mcp_registry/mcp_registry.py: the public MCP-server discovery catalog (the official
// registry.modelcontextprotocol.io index, Google's own MCP catalog parsed out of a README, and
// GitHub star counts layered on top), refreshed hourly in the background. This is the "browse and
// install a new MCP server" surface, distinct from toolsLib's already-configured-tool store.

import { engineFetch } from '../../net/http';

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1';
const PAGE_LIMIT = 100;
const REFRESH_INTERVAL_MS = 3600 * 1000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_BATCH = GITHUB_TOKEN ? 4000 : 50;
const GITHUB_CONCURRENT = 10;

export interface RegistryServer {
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  repositoryUrl: string;
  remoteUrl: string;
  remoteType: string;
  iconUrl: string;
  environmentVariables: unknown[];
  keywords: string[];
  license: string;
  stars: number | null;
  source: 'community' | 'google';
}

// Module state -- mirrors mcp_registry.py's p_cache/p_cache_updated_at/p_stars_cache globals.
let cache: Record<string, RegistryServer> = {};
let cacheUpdatedAt = 0;
let starsCache: Record<string, number> = {};
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<void> | null = null;
let stopped = false;

/** Test-only: resets every module-level global between test cases. */
export function resetRegistryStateForTests(): void {
  cache = {};
  cacheUpdatedAt = 0;
  starsCache = {};
}

/** Test-only: seed the cache directly, mirroring the Python suite's ability to monkeypatch
 * `mcp_registry.p_cache` -- lets http.test.ts exercise /stats, /search, /detail without a real
 * network refresh. */
export function setRegistryCacheForTests(servers: Record<string, RegistryServer>, updatedAt = Date.now() / 1000): void {
  cache = servers;
  cacheUpdatedAt = updatedAt;
}

export function registryCache(): Readonly<Record<string, RegistryServer>> {
  return cache;
}

export function registryCacheUpdatedAt(): number {
  return cacheUpdatedAt;
}

/** Parse 'owner/repo' from a GitHub URL. */
export function extractGhRepo(repoUrl: string): string | null {
  if (!repoUrl || !repoUrl.includes('github.com')) return null;
  const parts = repoUrl.replace(/\/+$/, '').split('/');
  const idx = parts.findIndex((p) => p.includes('github.com'));
  if (idx === -1 || parts.length <= idx + 2) return null;
  const owner = parts[idx + 1];
  const repo = parts[idx + 2].replace(/\.git$/, '');
  return `${owner}/${repo}`;
}

interface RegistryEntry {
  _meta?: { 'io.modelcontextprotocol.registry/official'?: { isLatest?: boolean } };
  server?: {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    websiteUrl?: string;
    repository?: { url?: string } | unknown;
    remotes?: Array<{ url?: string; type?: string }>;
    packages?: Array<{ environmentVariables?: unknown[] }>;
    icons?: Array<{ src?: string }>;
    _meta?: { 'io.modelcontextprotocol.registry/publisher-provided'?: { keywords?: string[]; license?: string } };
  };
}

/** Extract a flat server record from a registry entry, keeping only latest versions. */
export function extractServer(entry: RegistryEntry): RegistryServer | null {
  const meta = entry._meta?.['io.modelcontextprotocol.registry/official'];
  if (!meta?.isLatest) return null;

  const srv = entry.server ?? {};
  const name = srv.name ?? '';
  if (!name) return null;

  const remotes = srv.remotes ?? [];
  const remoteUrl = remotes.length > 0 ? (remotes[0].url ?? '') : '';
  const remoteType = remotes.length > 0 ? (remotes[0].type ?? '') : '';

  const repo = srv.repository;
  const repoUrl = repo && typeof repo === 'object' && !Array.isArray(repo) ? ((repo as { url?: string }).url ?? '') : '';

  const packages = srv.packages ?? [];
  const envVars = packages.length > 0 ? (packages[0].environmentVariables ?? []) : [];

  const pubMeta = srv._meta?.['io.modelcontextprotocol.registry/publisher-provided'];

  const icons = srv.icons ?? [];
  let iconUrl = icons.length > 0 ? (icons[0].src ?? '') : '';
  if (!iconUrl && repoUrl && repoUrl.includes('github.com')) {
    const parts = repoUrl.replace(/\/+$/, '').split('/');
    const ghIdx = parts.findIndex((p) => p.includes('github.com'));
    if (ghIdx >= 0 && parts.length > ghIdx + 1) {
      iconUrl = `https://github.com/${parts[ghIdx + 1]}.png?size=64`;
    }
  }

  return {
    name,
    title: srv.title ?? '',
    description: srv.description ?? '',
    version: srv.version ?? '',
    websiteUrl: srv.websiteUrl ?? '',
    repositoryUrl: repoUrl,
    remoteUrl,
    remoteType,
    iconUrl,
    environmentVariables: envVars,
    keywords: pubMeta?.keywords ?? [],
    license: pubMeta?.license ?? '',
    stars: null,
    source: 'community',
  };
}

/** Paginate through the full registry and return a dict keyed by server name. */
export async function fetchAllServers(): Promise<Record<string, RegistryServer>> {
  const servers: Record<string, RegistryServer> = {};
  let cursor: string | null = null;
  let pages = 0;

  while (true) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) params.set('cursor', cursor);

    let data: { servers?: RegistryEntry[]; metadata?: { nextCursor?: string } };
    try {
      const resp = await engineFetch(`${REGISTRY_BASE}/servers?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = (await resp.json()) as typeof data;
    } catch (e) {
      console.warn(`MCP registry fetch failed on page ${pages}: ${(e as Error).message}`);
      break;
    }

    const entries = data.servers ?? [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const record = extractServer(entry);
      if (record) servers[record.name] = record;
    }

    pages += 1;
    const nextCursor = data.metadata?.nextCursor;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  console.info(`MCP registry cache refreshed: ${Object.keys(servers).length} servers from ${pages} pages`);
  return servers;
}

const GOOGLE_README_URL = 'https://raw.githubusercontent.com/google/mcp/main/README.md';
const GOOGLE_ICON_URL = 'https://github.com/google.png?size=64';
const ENTRY_RE = /\[\*\*(.+?)\*\*\]\((.+?)\)(?:[,\s]*(.+))?/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse Google's MCP server catalog out of its README markdown (remote + open-source sections). */
export function parseGoogleReadme(text: string): Record<string, RegistryServer> {
  const servers: Record<string, RegistryServer> = {};
  let section: 'remote' | 'open-source' | null = null;

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.toLowerCase().includes('remote mcp servers') && stripped.startsWith('#')) {
      section = 'remote';
      continue;
    }
    if (stripped.toLowerCase().includes('open-source mcp servers') && stripped.startsWith('#')) {
      section = 'open-source';
      continue;
    }
    if (stripped.startsWith('#') && section !== null) {
      // Hit a new top-level section (e.g. Examples, Resources), stop parsing.
      if (!stripped.toLowerCase().startsWith('### **')) section = null;
      continue;
    }
    if (section === null) continue;

    const m = ENTRY_RE.exec(stripped);
    if (!m) continue;

    const title = m[1].trim();
    const url = m[2].trim();
    const descRaw = (m[3] ?? '').trim().replace(/\.+$/, '');

    const slug = slugify(title);
    const key = `google/${slug}`;

    const isGithub = url.includes('github.com') || url.includes('go.dev');
    const repoUrl = isGithub ? url : '';
    const websiteUrl = isGithub ? '' : url;

    const remoteType = section === 'remote' ? 'google-cloud-remote' : 'open-source';
    const description = descRaw || (section === 'remote' ? `Google Cloud managed MCP server for ${title}` : `Google open-source MCP server for ${title}`);

    servers[key] = {
      name: key,
      title,
      description,
      version: '',
      websiteUrl,
      repositoryUrl: repoUrl,
      remoteUrl: '',
      remoteType,
      iconUrl: GOOGLE_ICON_URL,
      environmentVariables: [],
      keywords: ['google', section],
      license: 'Apache-2.0',
      stars: null,
      source: 'google',
    };
  }

  return servers;
}

/** Fetch and parse Google's MCP server catalog from their GitHub README. */
export async function fetchGoogleServers(): Promise<Record<string, RegistryServer>> {
  try {
    const resp = await engineFetch(GOOGLE_README_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const servers = parseGoogleReadme(text);
    console.info(`Google MCP catalog: parsed ${Object.keys(servers).length} servers`);
    return servers;
  } catch (e) {
    console.warn(`Google MCP catalog fetch failed: ${(e as Error).message}`);
    return {};
  }
}

/** Batch-fetch GitHub star counts for servers with GitHub repos. Uses an in-memory cache so stars
 * accumulate across refresh cycles even when rate-limited (60 req/hr unauthenticated, 5000 with
 * GITHUB_TOKEN). */
export async function fetchGithubStars(servers: Record<string, RegistryServer>): Promise<void> {
  const needed: string[] = [];
  for (const srv of Object.values(servers)) {
    const gh = extractGhRepo(srv.repositoryUrl);
    if (gh && !(gh in starsCache) && !needed.includes(gh)) needed.push(gh);
  }

  if (needed.length === 0) {
    console.info(`GitHub stars: all ${Object.keys(starsCache).length} repos cached, 0 to fetch`);
    applyStars(servers);
    return;
  }

  const toFetch = needed.slice(0, GITHUB_BATCH);
  console.info(`GitHub stars: fetching ${toFetch.length} repos (${Object.keys(starsCache).length} cached, ${needed.length} pending)`);

  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

  let rateLimited = false;
  let fetched = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (rateLimited) return;
      const idx = cursor;
      cursor += 1;
      if (idx >= toFetch.length) return;
      const repo = toFetch[idx];
      try {
        const resp = await engineFetch(`https://api.github.com/repos/${repo}`, { headers });
        if (resp.status === 200) {
          const body = (await resp.json()) as { stargazers_count?: number };
          starsCache[repo] = body.stargazers_count ?? 0;
          fetched += 1;
        } else if (resp.status === 403 || resp.status === 429) {
          rateLimited = true;
          console.warn('GitHub API rate-limited, stopping star fetch');
        } else if (resp.status === 404) {
          starsCache[repo] = 0;
          fetched += 1;
        }
      } catch (e) {
        console.debug(`GitHub stars fetch failed for ${repo}: ${(e as Error).message}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(GITHUB_CONCURRENT, toFetch.length) }, () => worker());
  await Promise.all(workers);

  console.info(`GitHub stars: fetched ${fetched} new, ${Object.keys(starsCache).length} total cached`);
  applyStars(servers);
}

export function applyStars(servers: Record<string, RegistryServer>): void {
  for (const srv of Object.values(servers)) {
    const gh = extractGhRepo(srv.repositoryUrl);
    srv.stars = gh ? (starsCache[gh] ?? null) : null;
  }
}

async function refreshOnce(): Promise<void> {
  try {
    const [community, google] = await Promise.all([fetchAllServers(), fetchGoogleServers()]);
    const merged = { ...community, ...google };
    await fetchGithubStars(merged);
    cache = merged;
    cacheUpdatedAt = Date.now() / 1000;
  } catch (e) {
    console.error('MCP registry refresh error:', e);
  }
}

/** Background loop that refreshes the cache on startup and then hourly. Mirrors p_refresh_loop's
 * fire-then-sleep shape via a self-rescheduling setTimeout (not setInterval, so a slow refresh
 * can't overlap with the next tick). */
function scheduleNext(): void {
  if (stopped) return;
  refreshTimer = setTimeout(() => {
    refreshInFlight = refreshOnce().finally(() => {
      scheduleNext();
    });
  }, REFRESH_INTERVAL_MS);
}

/** Start the registry's background refresh: one immediate refresh, then hourly. Idempotent-ish
 * (calling twice without stop() in between leaks a timer, same caller-discipline main.ts already
 * follows for skillRegistry's start/stop). */
export function startMcpRegistry(): void {
  stopped = false;
  refreshInFlight = refreshOnce().finally(() => {
    scheduleNext();
  });
}

export async function stopMcpRegistry(): Promise<void> {
  stopped = true;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (refreshInFlight) {
    try {
      await refreshInFlight;
    } catch {
      // best-effort
    }
    refreshInFlight = null;
  }
}
