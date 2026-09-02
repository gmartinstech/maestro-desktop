// engine/src/apps/web/localFetch.ts -- SUB-8's port of backend/apps/agents/tools/web.py's
// WebFetchTool, the fast local-fetch tier `/api/web/fetch`'s cascade tries first (try_local in
// web.py): a direct HTTP GET (SSRF-guarded, arbitrary host) of the actual page, faster than any of
// the LLM-grounded tiers and returning the page's real text rather than a summary.
//
// One deliberate, named scope cut vs. the Python original: WebFetchTool prefers `trafilatura`
// (a Python main-content extraction library) for HTML pages, falling back to a regex strip only
// when trafilatura fails. No npm equivalent is wired in here -- this port always takes the
// regex-strip branch (ddg.ts's stripHtml, itself a port of search_ddg.py's own strip_html, the
// exact fallback the Python original already falls back to on JS-heavy/paywalled pages). This is
// weaker main-content extraction (nav/footer/ads survive) but never wrong, and the cascade's
// length-based thin-read check below still falls through to the browser/grounded tiers exactly
// the way the Python original's own thin-read check does.

import { safeFetch, SSRFBlocked } from './ssrfGuard';
import { USER_AGENT, stripHtml } from './ddg';

const P_MAX_OUTPUT_BYTES = 250 * 1024; // ~250 KB covers ~95% of articles/wikis/docs.
const P_TIMEOUT_MS = 32_000; // just above WebFetchTool's own 30s httpx ceiling

function truncate(text: string, limit: number = P_MAX_OUTPUT_BYTES): string {
  if (text.length > limit) return `${text.slice(0, limit)}\n... (output truncated)`;
  return text;
}

export interface LocalFetchDeps {
  safeFetchImpl?: typeof safeFetch;
}

/** Fetch a URL directly and return its extracted plain text, formatted the same way
 * WebFetchTool.execute()'s return text is (a "Contents of <url>:" header, optionally a "(Looking
 * for: ...)" hint, then the body). Never throws -- every failure mode (SSRF block, HTTP error,
 * network error) is folded into the returned string, exactly like the Python original. */
export async function localFetchText(url: string, prompt: string | null, deps: LocalFetchDeps = {}): Promise<string> {
  const safeFetchImpl = deps.safeFetchImpl ?? safeFetch;
  let resp: Response;
  try {
    resp = await safeFetchImpl(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT }, timeoutMs: P_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof SSRFBlocked) return `Refused to fetch ${url}: ${err.message}`;
    const msg = err instanceof Error ? err.message : String(err);
    return `Error fetching ${url}: ${msg}`;
  }
  if (!resp.ok) return `HTTP error ${resp.status} fetching ${url}`;

  const contentType = resp.headers.get('content-type') ?? '';
  const rawText = await resp.text();
  const isHtml = contentType.includes('html') || rawText.trim().startsWith('<!');
  const text = truncate(isHtml ? stripHtml(rawText) : rawText);

  let header = `Contents of ${url}:`;
  if (prompt) header += `\n(Looking for: ${prompt})`;
  return `${header}\n\n${text}`;
}
