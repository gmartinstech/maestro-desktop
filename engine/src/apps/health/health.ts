// engine/src/apps/health/health.ts -- ENG-7's native port of backend/apps/health/health.py.
//
// Trivial by design (the plan doc's own anchor count: "health 1" route) -- one GET returning a
// plain-text "OK", used as the readiness probe by pythonBackend.ts's own waitForHealth(), the
// Tauri sidecar, and the golden smoke's in-page fetch (docs/plans/2026-08-31-txm-tauri-typescript-
// migration.md's CTR-2 gate: `GET /api/health/check` returns 200 from inside the webview).
// Exempt from auth (auth/middleware.ts's AUTH_EXEMPT_PREFIXES already lists '/api/health') so a
// probe never needs a token.
//
// Mirrors health.py's exact response shape: "OK" body, status 200, explicit
// Content-Type: text/plain and Content-Length: 2 headers (Fastify would compute an equivalent
// Content-Length on its own, but setting it explicitly keeps this a byte-for-byte port rather than
// "close enough").

import type { FastifyReply, FastifyRequest } from 'fastify';

const P_OK_BODY = 'OK';

// Handles GET /api/health/check; returns false (reply left untouched) for any other path so the
// caller can fall back to proxying at Python -- same convention as
// settings/handler.ts's handleSettingsHttpRequest.
export async function handleHealthHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (pathname !== '/api/health/check') return false;
  if (request.method.toUpperCase() !== 'GET') {
    reply.code(405).send({ error: 'method_not_allowed', detail: `${request.method} not supported on /api/health/check` });
    return true;
  }
  reply
    .code(200)
    .header('Content-Type', 'text/plain')
    .header('Content-Length', String(Buffer.byteLength(P_OK_BODY, 'utf8')))
    .send(P_OK_BODY);
  return true;
}
