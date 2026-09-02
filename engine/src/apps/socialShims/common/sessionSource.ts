// engine/src/apps/socialShims/common/sessionSource.ts -- SUB-9, a full port of
// backend/apps/social_shims/session_source.py.
//
// Borrow the user's live browser session (cookies + UA) for a domain. Shared by every social MCP
// shim (reddit/x/tiktok). The shim never stores credentials -- it asks the engine's browser-session
// bridge (gated by the same per-install token every Maestro shim uses) for the cookies the user's
// own logged-in browser already holds, then talks to the site as that browser.
//
// THIS is the file BRW-6 named as SUB-9's job to make engine-aware: it calls
// `GET /api/browser-session/cookies?domain=<domain>` on `127.0.0.1:${MAESTRO_PORT}`, exactly the
// path the Python original called. Under MAESTRO_BROWSER_ENGINE=cdp that path is answered natively
// by engine/src/browser/cookies.ts's handleBrowserLoginHttpRequest (BRW-6's own visible-browser CDP
// capture, registered ahead of split.ts's proxy in server.ts) -- this module needed ZERO knowledge
// of that to become "engine-aware": it was always just an HTTP client of one fixed local URL, and
// the engine now natively answers that URL instead of forwarding to Python's Electron-only
// implementation. Under the default 'electron' browser engine mode the same URL is still answered
// by Python's own readPartitionCookies-backed handler (backend/main.py:652-707), unchanged -- this
// module works identically either way, by construction.

import { encodeQuery, requestJson } from './httpJson';

const CACHE_TTL_S = 60.0;

// Fallback only; the bridge returns the real spoofed Chrome UA the browser card uses.
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class SessionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionUnavailable';
  }
}

interface CachedSession {
  ts: number;
  cookieHeader: string;
  userAgent: string;
}

const cache = new Map<string, CachedSession>();

function bridgeUrl(domain: string): string {
  const port = process.env.MAESTRO_PORT || '8324';
  return `http://127.0.0.1:${port}/api/browser-session/cookies?${encodeQuery({ domain })}`;
}

interface CookiesResponse {
  error?: unknown;
  cookies?: Array<{ name?: string; value?: string }>;
  userAgent?: string;
}

/** Return (cookieHeader, userAgent) for domain from the live browser session. Throws
 * SessionUnavailable with a human-actionable message when the bridge is unreachable or the user
 * isn't logged in (no cookies for the domain). now()/cacheOverride are injectable for tests. */
export async function getSession(domain: string, now: () => number = () => Date.now() / 1000): Promise<[string, string]> {
  const nowS = now();
  const hit = cache.get(domain);
  if (hit && nowS - hit.ts < CACHE_TTL_S) return [hit.cookieHeader, hit.userAgent];

  const authToken = process.env.MAESTRO_AUTH_TOKEN || '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let result;
  try {
    result = await requestJson({ method: 'GET', url: bridgeUrl(domain), headers, timeoutMs: 20_000 });
  } catch (e) {
    throw new SessionUnavailable(`Session bridge unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (result.status >= 400) {
    throw new SessionUnavailable(`Session bridge error (HTTP ${result.status}); is the Maestro dashboard open?`);
  }
  const data = (typeof result.body === 'object' && result.body !== null ? result.body : {}) as CookiesResponse;
  if (data.error) throw new SessionUnavailable(String(data.error));
  const cookies = data.cookies ?? [];
  if (cookies.length === 0) {
    throw new SessionUnavailable(`Not logged in to ${domain}. Open ${domain} in the Maestro browser, sign in, then retry.`);
  }
  const cookieHeader = cookies
    .filter((c) => c.name)
    .map((c) => `${c.name}=${c.value ?? ''}`)
    .join('; ');
  const userAgent = data.userAgent || DEFAULT_UA;
  cache.set(domain, { ts: nowS, cookieHeader, userAgent });
  return [cookieHeader, userAgent];
}

/** Pull a single cookie's value from the borrowed session (e.g. x's ct0 CSRF token, tiktok's msToken). */
export async function cookieValue(domain: string, name: string): Promise<string> {
  const [cookieHeader] = await getSession(domain);
  for (const pair of cookieHeader.split(';')) {
    const [k, v] = pair.trim().split('=', 2);
    if (k === name) return v ?? '';
  }
  return '';
}

/** Drop the cached session so the next call re-borrows fresh cookies. */
export function invalidate(domain: string): void {
  cache.delete(domain);
}

/** Exported for tests only -- clears every cached session between test cases. */
export function resetSessionCacheForTest(): void {
  cache.clear();
}
