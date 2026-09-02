// engine/src/apps/socialShims/reddit/redditHttp.ts -- SUB-9, a full port of
// backend/apps/reddit_mcp_shim/reddit_http.py.
//
// Talks to Reddit as the user's own logged-in browser: borrow the session cookies (SUB-9's
// sessionSource.ts, itself engine-native per BRW-6) and call the classic www.reddit.com JSON API
// (reads take a .json suffix, writes carry the account's modhash), no OAuth app and no API key.
// Rate-limited and self-healing on a 401/403 by re-borrowing the session.

import { encodeQuery, requestJson } from '../common/httpJson';
import { getSession, invalidate } from '../common/sessionSource';
import * as rateLimit from './rateLimit';

export const DOMAIN = 'reddit.com';
const WWW = 'https://www.reddit.com';
const MODHASH_TTL_S = 300.0;

let cachedModhash = '';
let modhashExpiresAt = 0.0;

export class RedditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedditError';
  }
}

/** Exported for tests only -- clears the module-level modhash cache between test cases. */
export function resetModhashCacheForTest(): void {
  cachedModhash = '';
  modhashExpiresAt = 0.0;
}

function resetModhash(): void {
  modhashExpiresAt = 0.0;
}

interface RedditMeResponse {
  data?: { modhash?: string };
}

/** Return the logged-in account's modhash (Reddit's per-session write token), cached briefly. */
export async function modhash(force = false): Promise<string> {
  const now = Date.now() / 1000;
  if (!force && cachedModhash && now < modhashExpiresAt) return cachedModhash;
  const me = (await send('GET', '/api/me.json', { action: 'read', retried: false })) as RedditMeResponse;
  const mh = me?.data?.modhash || '';
  if (!mh) {
    invalidate(DOMAIN);
    throw new RedditError('Not logged in to Reddit. Open reddit.com in the Maestro browser, sign in, then retry.');
  }
  cachedModhash = mh;
  modhashExpiresAt = now + MODHASH_TTL_S;
  return mh;
}

export interface ApiOptions {
  params?: Record<string, unknown>;
  form?: Record<string, unknown>;
  action?: string;
}

/** Authenticated www.reddit.com call: reads get a .json suffix, writes carry the modhash. */
export async function api(method: string, path: string, options: ApiOptions = {}): Promise<unknown> {
  return send(method, path, { params: options.params, form: options.form, action: options.action ?? 'read', retried: false });
}

interface SendOptions {
  params?: Record<string, unknown>;
  form?: Record<string, unknown>;
  action: string;
  retried: boolean;
}

async function send(method: string, path: string, options: SendOptions): Promise<unknown> {
  await rateLimit.acquire(options.action);
  const [cookie, ua] = await getSession(DOMAIN);
  const headers: Record<string, string> = { Cookie: cookie, 'User-Agent': ua, Accept: 'application/json' };
  let url: string;
  let body: string | undefined;

  if (method === 'GET') {
    const p = path.endsWith('.json') ? path : `${path}.json`;
    const qs = { raw_json: 1, ...(options.params ?? {}) };
    const query = encodeQuery(qs);
    url = `${WWW}${p}${query ? `?${query}` : ''}`;
  } else {
    url = `${WWW}${path}`;
    if (options.params) {
      const q = encodeQuery(options.params);
      if (q) url += `?${q}`;
    }
    const formBody: Record<string, unknown> = { api_type: 'json', ...(options.form ?? {}) };
    formBody.uh = await modhash();
    body = encodeQuery(formBody);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  let status: number;
  let rawBody: unknown;
  let respHeaders: Record<string, string>;
  try {
    const result = await requestJson({ method, url, headers, body, timeoutMs: 30_000 });
    status = result.status;
    rawBody = result.body;
    respHeaders = result.headers;
  } catch (e) {
    throw new RedditError(`Reddit unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  rateLimit.noteResponse(status, respHeaders);
  if ((status === 401 || status === 403) && !options.retried) {
    invalidate(DOMAIN);
    resetModhash();
    return send(method, path, { ...options, retried: true });
  }
  if (status === 429) {
    throw new RedditError('Reddit is rate-limiting this account; slow down and retry shortly.');
  }
  if (status >= 400) {
    const text = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    throw new RedditError(`Reddit HTTP ${status}: ${text.slice(0, 300)}`);
  }
  return rawBody;
}
