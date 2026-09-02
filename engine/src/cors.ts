// engine/src/cors.ts -- SUB-10's fix for a real, verified gap every prior native-porting ticket's
// gate run never actually exercised: backend/main.py wraps the WHOLE app in Starlette's
// CORSMiddleware, which answers every OPTIONS preflight itself -- the request never reaches a
// route handler at all. In 'proxy' mode this was invisible (an OPTIONS request just proxies
// through to Python, which answers it correctly), so every earlier SUB/AGT/ENG ticket's native
// handler (settings/handler.ts included, its own header explicitly named this a known gap) never
// needed to answer OPTIONS itself. e2e/contract/http.spec.ts's own "OPTIONS preflight on a gated
// route is CORS-sane" test only ever targets the bare /api/settings path, so this gap was never
// caught until THIS ticket ran the contract suite with 'settings' (and everything else) genuinely
// native + MAESTRO_ENGINE_SKIP_BACKEND=1 -- with no Python to fall back to, the preflight landed on
// settings/handler.ts's own 405 catch-all instead of a 200.
//
// Fixed the same way auth is: a cross-cutting hook in server.ts that runs ahead of the
// native/proxy dispatch, for every path -- not a per-handler concern. Mirrors backend/main.py's
// CORSMiddleware config byte-for-byte (same allow_origin_regex, same allow_credentials/methods/
// headers/max_age=600), including its exact "disallowed origin" failure shape (a bare 400, no CORS
// headers echoed) -- see backend/main.py:84-97.

import type { FastifyReply, FastifyRequest } from 'fastify';

// backend/main.py's allow_origin_regex, copied verbatim (the explicit allow_origins list there is
// a strict subset of what this regex already matches -- http://localhost:3000, 127.0.0.1:3000, and
// tauri.localhost all match one of the three alternatives below -- so one regex check reproduces
// both).
const ALLOWED_ORIGIN_RE = /^(file:\/\/.*|http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+|http:\/\/tauri\.localhost)$/;

// Starlette's CORSMiddleware, given allow_methods=["*"], precomputes this exact sorted set rather
// than literally emitting "*" on the wire -- reproduced verbatim so a real browser (and this
// repo's own contract test, which asserts the header `toContain('GET')`) sees the same shape.
const ALLOW_METHODS = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT';

/** Answers an OPTIONS preflight exactly the way backend/main.py's CORSMiddleware does, for ANY
 * path -- called ahead of split.ts's native/proxy dispatch in server.ts, same architectural level
 * as the auth hook. Returns true when it answered the request (always true for OPTIONS); false for
 * any other method, leaving the reply untouched for the caller's normal dispatch to continue. */
export function handleCorsPreflight(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.method.toUpperCase() !== 'OPTIONS') return false;

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !ALLOWED_ORIGIN_RE.test(origin)) {
    // Starlette's own preflight_response() for a disallowed origin: a bare 400, no CORS headers
    // echoed at all -- the browser's console shows a CORS failure rather than silently granting
    // the origin anything.
    reply.code(400).send('Disallowed CORS origin');
    return true;
  }

  const requestedHeaders = request.headers['access-control-request-headers'];
  reply
    .code(200)
    .header('Access-Control-Allow-Origin', origin)
    .header('Access-Control-Allow-Credentials', 'true')
    .header('Access-Control-Allow-Methods', ALLOW_METHODS)
    // allow_headers=["*"]: Starlette echoes back exactly what the preflight asked to send, which
    // is what actually permits e.g. `Authorization` on the real follow-up request.
    .header('Access-Control-Allow-Headers', typeof requestedHeaders === 'string' ? requestedHeaders : '*')
    .header('Access-Control-Max-Age', '600')
    .header('Content-Length', '0')
    .send();
  return true;
}
