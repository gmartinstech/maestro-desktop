// engine/src/apps/web/ddg.ts -- SUB-8's port of backend/apps/agents/tools/{search_ddg,
// search_ddg_lite}.py: DuckDuckGo web search, html endpoint primary, lite endpoint fallback.
//
// The html endpoint is the richer parse; lite covers the two ways html dies: a 202 throttle and
// silent markup drift. Only when BOTH endpoints throttle does this raise DDGRateLimited, so free
// search isn't a single point of failure.
//
// html.duckduckgo.com / lite.duckduckgo.com are on engine/src/net/http.ts's ALWAYS_ALLOWED_HOSTS
// (this ticket added them) -- our own hardcoded outbound call, not a user-configured host.

import { engineFetch } from '../../net/http';

export const HTTP_TIMEOUT_MS = 30_000;
export const LITE_TIMEOUT_MS = 12_000;
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LITE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Both DuckDuckGo endpoints answered with the throttle challenge (HTTP 202). Distinct from
 * "genuinely zero hits" so the caller can fail over to another backend instead of reporting an
 * empty search to the user. */
export class DDGRateLimited extends Error {
  constructor(query: string) {
    super(`DuckDuckGo rate-limited both endpoints for query: ${query}`);
    this.name = 'DDGRateLimited';
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function unescapeHtml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X';
      const num = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return NAMED_ENTITIES[ent] ?? whole;
  });
}

/** Naive but effective HTML to plain-text conversion -- mirrors search_ddg.py's strip_html(). */
export function stripHtml(rawHtml: string): string {
  let text = rawHtml.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = unescapeHtml(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

async function postForm(url: string, query: string, userAgent: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await engineFetch(url, {
      method: 'POST',
      headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query }).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const LITE_LINK_RE = /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;
const LITE_SNIPPET_RE = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;

function pLiteStrip(text: string): string {
  return unescapeHtml(text.replace(/<[^>]+>/g, '')).trim();
}

/** Formats lite's result rows -- links and snippets appear in document order and pair positionally.
 * Mirrors search_ddg_lite.py's parse_lite_results(). */
export function parseLiteResults(body: string, numResults: number): string {
  const links: Array<[string, string]> = [];
  for (const m of body.matchAll(LITE_LINK_RE)) links.push([m[1], m[2]]);
  const snippets: string[] = [];
  for (const m of body.matchAll(LITE_SNIPPET_RE)) snippets.push(pLiteStrip(m[1]));

  const entries: string[] = [];
  for (let i = 0; i < Math.min(links.length, numResults); i++) {
    const [url, rawTitle] = links[i];
    const title = pLiteStrip(rawTitle);
    let entry = `[${i + 1}] ${title}\n    ${unescapeHtml(url)}`;
    if (snippets[i]) entry += `\n    ${snippets[i]}`;
    entries.push(entry);
  }
  return entries.join('\n\n');
}

/** None (null) = throttled (202), string = parsed results (may be empty on no hits). Mirrors
 * search_ddg_lite.py's search_ddg_lite(). */
export async function searchDdgLite(query: string, numResults: number): Promise<string | null> {
  const resp = await postForm('https://lite.duckduckgo.com/lite/', query, LITE_USER_AGENT, LITE_TIMEOUT_MS);
  if (resp.status === 202) return null;
  if (!resp.ok) throw new Error(`DDG lite endpoint HTTP ${resp.status}`);
  const body = await resp.text();
  return parseLiteResults(body, numResults);
}

const RESULT_BLOCK_RE = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/g;
const LINK_RE_A = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
const LINK_RE_B = /<a[^>]*href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/;
const SNIPPET_RE = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/;

/** Mirrors search_ddg.py's own body-parsing loop (the part after the initial POST). Exported
 * separately so it's testable against a fixture body with no network call. */
export function parseDdgHtmlResults(body: string, numResults: number): string[] {
  const entries: string[] = [];
  for (const blockMatch of body.matchAll(RESULT_BLOCK_RE)) {
    if (entries.length >= numResults) break;
    const block = blockMatch[1];

    const linkMatch = LINK_RE_A.exec(block) ?? LINK_RE_B.exec(block);
    if (!linkMatch) continue;

    const rawUrl = unescapeHtml(linkMatch[1]);
    // Drop sponsored rows: DDG ads point at its own y.js click-tracker instead of a real uddg=
    // redirect, so they'd otherwise show up as junk "duckduckgo.com/y.js?ad_..." results.
    if (rawUrl.includes('/y.js?') || rawUrl.includes('ad_provider=') || rawUrl.includes('ad_domain=')) continue;

    const title = stripHtml(linkMatch[2]).trim();

    const snippetMatch = SNIPPET_RE.exec(block);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';

    // DDG wraps URLs in a redirect; extract the real one.
    const realUrlMatch = /uddg=([^&]+)/.exec(rawUrl);
    const url = realUrlMatch ? decodeURIComponent(realUrlMatch[1]) : rawUrl;

    let entry = `[${entries.length + 1}] ${title}\n    ${url}`;
    if (snippet) entry += `\n    ${snippet}`;
    entries.push(entry);
  }
  return entries;
}

/** Query DuckDuckGo's html endpoint and parse results; lite is the free fallback. Mirrors
 * search_ddg.py's search_ddg(). */
export async function searchDdg(query: string, numResults: number): Promise<string> {
  const resp = await postForm('https://html.duckduckgo.com/html/', query, USER_AGENT, HTTP_TIMEOUT_MS);
  // DDG serves its throttle challenge as 202 (a 2xx), so a bare .ok check sails right past it.
  // Before declaring rate-limited, try the lite frontend; only when BOTH throttle is free search
  // actually dead.
  if (resp.status === 202) {
    const lite = await searchDdgLite(query, numResults);
    if (lite === null) throw new DDGRateLimited(query);
    return lite;
  }
  if (!resp.ok) throw new Error(`DDG html endpoint HTTP ${resp.status}`);

  const body = await resp.text();
  const entries = parseDdgHtmlResults(body, numResults);

  // 200 with zero parsed entries usually means DDG changed its markup out from under the regexes
  // (it has before), not a genuine no-hits; lite's simpler shape is the safety net.
  if (entries.length === 0) {
    const lite = await searchDdgLite(query, numResults);
    if (lite) return lite;
  }
  return entries.join('\n\n');
}
