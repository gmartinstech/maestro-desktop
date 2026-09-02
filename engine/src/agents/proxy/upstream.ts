// engine/src/agents/proxy/upstream.ts -- AGT-7, ports backend/apps/agents/proxy/
// anthropic_proxy.py's p_pick_upstream + its P_HOP_HEADERS constant.

import type { AppSettings } from '../../settings/models';
import { NINE_ROUTER_URL } from '../../router/process';
import { isClaudeModel } from './requestScrub';

// Hop-by-hop headers or auth we replace with the upstream-specific value.
export const HOP_HEADERS: ReadonlySet<string> = new Set([
  'host', 'content-length', 'authorization', 'x-api-key', 'connection', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

export interface UpstreamTarget {
  /** Base URL WITHOUT a trailing /v1 -- caller appends `/v1/{rest}`, same as the Python original. */
  baseUrl: string;
  authHeaders: Readonly<Record<string, string>>;
}

/** Resolves (base_url_without_v1, auth_headers) for a given model.
 *
 * Routing for Claude-family models:
 *   1. Direct Anthropic API key set -> api.anthropic.com (preferred when the user has their own
 *      key, avoids the 8h OAuth expiry pain).
 *   2. Fallback -> 9Router (cc/ OAuth subscription, may 401 if expired).
 * Everything non-Claude goes to 9Router for translation.
 *
 * `nineRouterUrl` defaults to the real, fixed loopback 9Router URL (router/process.ts's own
 * NINE_ROUTER_URL, port 20128) -- a caller-supplied override exists ONLY so tests (and this
 * ticket's own live gate script) can redirect the loopback leg to a throwaway fake server instead
 * of a real, possibly-already-running 9Router process on the same machine; production callers
 * never pass it. */
export function pickUpstream(
  model: string | null | undefined,
  settings: Pick<AppSettings, 'anthropic_api_key'>,
  nineRouterUrl: string = NINE_ROUTER_URL,
): UpstreamTarget {
  if (isClaudeModel(model)) {
    const ak = (settings.anthropic_api_key ?? '').trim();
    if (ak) {
      return {
        baseUrl: 'https://api.anthropic.com',
        authHeaders: { 'x-api-key': ak, 'anthropic-version': '2023-06-01' },
      };
    }
  }
  return { baseUrl: nineRouterUrl, authHeaders: { 'x-api-key': '9router' } };
}

/** Copies request headers minus hop-by-hop/auth ones, then layers the upstream's own auth on
 * top. The CLI carries our install token as x-api-key; never forward it upstream (leak + shadows
 * real upstream auth) -- filtered out via HOP_HEADERS same as every other hop header. */
export function buildForwardHeaders(
  requestHeaders: Iterable<[string, string | string[] | undefined]>,
  authHeaders: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of requestHeaders) {
    if (HOP_HEADERS.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  Object.assign(out, authHeaders);
  return out;
}
