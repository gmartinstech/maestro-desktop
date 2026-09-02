// engine/src/apps/socialShims/tiktok/tiktokHttp.ts -- SUB-9, a full port of
// backend/apps/tiktok_mcp_shim/tiktok_http.py.
//
// Borrow the user's tiktok.com session, attach device params + msToken, and call the web /api
// surface. Detects TikTok's anti-bot / verify rejections (the signature gate) and raises an
// actionable error pointing at the browser fallback.

import { requestJson } from '../common/httpJson';
import { getSession, invalidate } from '../common/sessionSource';
import { API, DOMAIN } from './tiktokEndpoints';
import * as rateLimit from './rateLimit';
import { signedQuery } from './tiktokSign';

const SIGNATURE_HINT =
  "TikTok blocked this as unsigned/automated (its X-Bogus/X-Gnarly gate). Reads sometimes slip through; signed writes and uploads need a real browser. Use the Maestro browser agent for TikTok actions: it drives your live tiktok.com session, so it's free, undetectable, and can do everything a human can.";

export class TikTokError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TikTokError';
  }
}

function checkAntibot(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  const b = body as Record<string, unknown>;
  const sc = b.statusCode ?? b.status_code;
  if (sc !== 0 && sc !== null && sc !== undefined) {
    const msg = (b.statusMsg ?? b.status_msg ?? '') as string;
    throw new TikTokError(`TikTok statusCode ${String(sc)} ${msg}. ${SIGNATURE_HINT}`.trim());
  }
}

interface RequestOptions {
  params?: Record<string, unknown>;
  form?: Record<string, unknown>;
  action: string;
  retried: boolean;
}

async function request(method: string, path: string, options: RequestOptions): Promise<unknown> {
  await rateLimit.acquire(options.action);
  const [cookie, ua] = await getSession(DOMAIN);
  const url = `${API}/${path}?${await signedQuery(options.params ?? {})}`;
  const headers: Record<string, string> = { Cookie: cookie, 'User-Agent': ua, Accept: 'application/json, text/plain, */*', Referer: 'https://www.tiktok.com/' };
  let body: string | undefined;
  if (options.form !== undefined) {
    body = encodeFormBody(options.form);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  let status: number;
  let rawText: string;
  let respHeaders: Record<string, string>;
  try {
    const result = await requestJson({ method, url, headers, body, timeoutMs: 30_000 });
    status = result.status;
    rawText = result.rawText;
    respHeaders = result.headers;
  } catch (e) {
    throw new TikTokError(`tiktok.com unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  rateLimit.noteResponse(status, respHeaders);
  if ((status === 401 || status === 403) && !options.retried) {
    invalidate(DOMAIN);
    return request(method, path, { ...options, retried: true });
  }
  if (status === 429) throw new TikTokError('tiktok.com is rate-limiting this account; slow down and retry shortly.');
  if (status >= 400) {
    throw new TikTokError(`tiktok.com HTTP ${status}: ${rawText.slice(0, 200)}. ${SIGNATURE_HINT}`);
  }
  const text = rawText.trim();
  if (!text) throw new TikTokError(`TikTok returned an empty response. ${SIGNATURE_HINT}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TikTokError(`TikTok returned a non-JSON page (likely a verify/captcha wall). ${SIGNATURE_HINT}`);
  }
  checkAntibot(parsed);
  return parsed;
}

function encodeFormBody(form: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (v !== null && v !== undefined) usp.append(k, String(v));
  }
  return usp.toString();
}

export function get(path: string, params: Record<string, unknown>, options: { action?: string } = {}): Promise<unknown> {
  return request('GET', path, { params, action: options.action ?? 'read', retried: false });
}

export function post(path: string, params: Record<string, unknown>, form: Record<string, unknown>, options: { action: string }): Promise<unknown> {
  return request('POST', path, { params, form, action: options.action, retried: false });
}
