// engine/src/apps/socialShims/common/httpJson.ts -- SUB-9, a small shared transport helper used by
// every social MCP shim's low-level HTTP module (sessionSource.ts, browserAction.ts, discord's
// discordApi.ts, reddit's redditHttp.ts, tiktok's tiktokHttp.ts). The Python originals were
// stdlib-only (urllib.request) because each shim runs as its own fast-starting subprocess; the TS
// port keeps the same "no heavy client" shape but goes through engineFetch (net/http.ts) instead of
// a raw fetch/http/https import -- required by the provider-egress lint rule and
// scripts/check-provider-egress.mjs, which ban a bare `fetch`/`node:http` anywhere in engine/src
// outside that one chokepoint. This module is the one place all five callers funnel through, so an
// egress audit of the social shims has one file to read, mirroring net/http.ts's own "one chokepoint"
// framing for the engine at large.
//
// Every shim's HTTP module handles its own status-code interpretation (retry-on-401, 429 backoff,
// etc.) -- this helper only does the transport mechanics (encode, send, decode, never throw on a
// non-2xx status) so that logic stays in the caller, matching how urllib.request.urlopen raising
// HTTPError still let each caller read e.code/e.read() itself.

import { engineFetch } from '../../../net/http';

export interface JsonHttpResult {
  status: number;
  /** Parsed JSON body if the response text parsed as JSON, else the raw text (mirrors the Python
   * originals' `try: json.loads(...) except JSONDecodeError: return text` fallback). An empty body
   * becomes `{}` here, matching every caller except tiktokHttp.ts, which needs to tell "genuinely
   * empty" apart from "parsed to an empty object" -- see `rawText` below for that one case. */
  body: unknown;
  /** The exact, unparsed response text (empty string for a body-less response) -- present so a
   * caller that needs to distinguish "empty" from "valid JSON" (tiktokHttp.ts's own antibot/empty
   * detection, which the Python original does on raw text before ever attempting json.loads) can,
   * without every other caller needing to re-derive it from `body`. */
  rawText: string;
  headers: Record<string, string>;
}

export interface JsonHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Pre-encoded request body (a JSON string or a URL-encoded form string); content-type is the
   * caller's responsibility, same division of concerns as urllib.request.Request(data=..., headers=...). */
  body?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** One HTTP round trip through engineFetch, never throwing on a non-2xx status (network failure,
 * DNS, and egress-block still throw -- callers wrap this in their own try/catch for those). */
export async function requestJson(req: JsonHttpRequest): Promise<JsonHttpResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await engineFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const text = await resp.text();
    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = {};
    }
    return { status: resp.status, body, rawText: text, headers };
  } finally {
    clearTimeout(timeout);
  }
}

/** Build a `key=value&...` query string, dropping null/undefined values -- same
 * `urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})` shape every Python
 * original uses at every call site. */
export function encodeQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) usp.append(k, String(v));
  }
  return usp.toString();
}
