// engine/src/auth/middleware.ts -- the engine's own per-install-token auth check, wired into
// server.ts ahead of the native/proxy branch (see buildServer()) so it gates every request that
// reaches the engine's own port, regardless of how split.ts later routes it -- auth is
// cross-cutting, not a per-subsystem concern split.ts's route table owns.
//
// Mirrors backend/auth.py + backend/main.py's p_auth_middleware / p_ws_auth_ok as closely as
// TypeScript/Fastify allows: same exempt paths, same accepted credential shapes, same
// constant-time compare. The one deliberate divergence is the WS rejection code -- see the note
// on wsRequestAuthOk below and e2e/contract/ws.spec.ts's P_BAD_TOKEN_CLOSE_CODE.

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Mirrors backend/auth.py's P_AUTH_EXEMPT_EXACT (and e2e/contract/run.ts's hand-mirrored copy of
// the same list) -- "frozen contract, update here first" convention: if backend's list changes,
// this drifts from live behavior until someone updates it, and the http.spec.ts sweep is the
// signal, not a silent pass.
export const AUTH_EXEMPT_EXACT: ReadonlySet<string> = new Set([
  '/api/subscriptions/callback',
  '/api/tools/oauth/callback',
  '/api/tools/oauth/cloud-claim',
  '/api/version',
  '/api/tools/google-oauth-token',
  '/api/dev/token',
]);

export const AUTH_EXEMPT_PREFIXES: readonly string[] = [
  '/api/health',
  '/api/openai-passthrough',
  '/docs',
  '/openapi',
  '/redoc',
  '/favicon',
];

export function isPathExempt(path: string): boolean {
  if (AUTH_EXEMPT_EXACT.has(path)) return true;
  return AUTH_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

export function extractBearer(headerValue: string | undefined | null): string {
  if (!headerValue) return '';
  if (headerValue.startsWith('Bearer ')) return headerValue.slice('Bearer '.length).trim();
  if (headerValue.startsWith('bearer ')) return headerValue.slice('bearer '.length).trim();
  return '';
}

// secrets.compare_digest's guarantee (constant time) only holds for equal-length inputs -- a
// length mismatch returning early leaks nothing an attacker doesn't already know (the value
// didn't match), same tradeoff backend/auth.py accepts.
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

type HeaderMap = Record<string, string | string[] | undefined>;

function firstHeader(headers: HeaderMap, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export interface AuthCandidateSources {
  headers: HeaderMap;
  query?: Record<string, string | string[] | undefined>;
}

// Validates a request against the per-install token via any of: Authorization Bearer,
// x-maestro-token, x-api-key (the bundled Claude Code CLI's path -- it's launched with
// ANTHROPIC_API_KEY=<token>, which the CLI sends back as x-api-key on its own requests), or
// ?token=<token> (the App Builder iframe path, which can't set headers on a browser-driven GET).
// Mirrors backend/auth.py's request_matches_token, folding in the x-api-key branch
// backend/main.py's p_auth_middleware checks as a separate step -- functionally identical, one
// unified candidate list here instead of two call sites.
export function requestMatchesToken(sources: AuthCandidateSources, token: string): boolean {
  if (!token) return false;
  const candidates: string[] = [];

  const bearer = extractBearer(firstHeader(sources.headers, 'authorization'));
  if (bearer) candidates.push(bearer);

  const maestroHeader = firstHeader(sources.headers, 'x-maestro-token');
  if (maestroHeader) candidates.push(maestroHeader.trim());

  const apiKey = firstHeader(sources.headers, 'x-api-key');
  if (apiKey) candidates.push(apiKey.trim());

  const qp = sources.query?.token;
  const qpToken = Array.isArray(qp) ? qp[0] : qp;
  if (qpToken) candidates.push(qpToken);

  return candidates.some((c) => constantTimeEqual(c, token));
}

// WS Origin allowlist -- mirrors backend/auth.py's P_ORIGIN_ALLOWLIST_DEV / is_origin_allowed.
const ORIGIN_ALLOWLIST_DEV: ReadonlySet<string> = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'file://',
  'null',
]);

export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (origin === null || origin === undefined) return true;
  if (ORIGIN_ALLOWLIST_DEV.has(origin)) return true;
  if (origin.startsWith('file://')) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
  return false;
}

// Fastify onRequest hook -- runs ahead of buildServer()'s native/proxy branch, so it gates every
// request the same way whether split.ts ends up routing it natively or proxying it downstream.
// OPTIONS preflights are exempt outright (browsers never send Authorization on them), matching
// backend/main.py's p_auth_middleware.
export function createHttpAuthHook(getToken: () => string) {
  return async function httpAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.method === 'OPTIONS') return;
    const pathname = (request.raw.url ?? '/').split('?')[0];
    if (isPathExempt(pathname)) return;

    const ok = requestMatchesToken(
      {
        headers: request.headers as HeaderMap,
        query: request.query as Record<string, string | string[] | undefined>,
      },
      getToken(),
    );
    if (!ok) {
      reply.code(401).send({ error: 'unauthorized', detail: 'missing or invalid token' });
    }
  };
}

// Validates a WS upgrade request (headers + query string) against the token and origin
// allowlist, the same rules p_ws_auth_ok applies. NOTE ON THE REJECTION CODE: backend/main.py's
// p_ws_auth_ok calls websocket.close(code=4401) BEFORE .accept(), and its own inline comment
// claims "the client receives a 403 on handshake" -- neither is what actually reaches the wire.
// Per the ASGI spec (which uvicorn implements), a close sent pre-accept is a handshake
// REJECTION, not a WS close frame, so code=4401 never gets written; a plain WS client instead
// sees the TCP connection drop mid-handshake, observed as close code 1006 (CLOSE_ABNORMAL) --
// confirmed live against the backend before this was written (see e2e/contract/ws.spec.ts's
// P_BAD_TOKEN_CLOSE_CODE and its DISCREPANCY comment). server.ts replicates that REAL behavior
// by destroying the raw socket on a false return here, never writing an HTTP response or WS
// close frame -- not by fabricating a 4401 close frame the backend itself never actually sends.
export function wsRequestAuthOk(req: IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? '/', 'http://internal');
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  const tokenOk = requestMatchesToken({ headers: req.headers as HeaderMap, query }, token);
  const originOk = isOriginAllowed(req.headers.origin ?? null);
  return tokenOk && originOk;
}
