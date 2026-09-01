// engine/src/server.ts -- ENG-1's HTTP/WS front door.
//
// Binds a Fastify server on a configurable port. Every request's routing name (split.ts) decides
// its fate: 'native' gets a 501 placeholder for now (later tickets fill in real handlers -- see
// the plan's per-ticket route-table flips); 'proxy' gets forwarded byte-for-byte to the spawned
// Python backend on its internal loopback port, HTTP and WebSocket upgrades alike, so the response
// the caller sees is indistinguishable from talking to Python directly. That transparency is what
// ENG-1's gate proves (e2e/contract's suite passing through the engine, unmodified).
//
// Fastify's own body parsing is disabled for every content type (see the '*' content-type parser
// below) so a proxied request's body reaches the backend as the exact bytes the client sent --
// this route never interprets or re-serializes anything it forwards.

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createHttpAuthHook, wsRequestAuthOk } from './auth/middleware';
import { handleHealthHttpRequest } from './apps/health/health';
import { handleServiceHttpRequest } from './apps/service/service';
import { handleBrowserScreencastUpgrade } from './browser/screencastServer';
import { handleBrowserLoginHttpRequest } from './browser/cookies';
// ENG-7 moved the raw node:http proxy plumbing into engine/src/net/ -- the one directory the
// provider-egress ESLint rule exempts from the node:http/fetch import ban (see that file's
// header for why this mechanism can't just become an engineFetch() call).
import { proxyHttpRequest, proxyWebSocketUpgrade } from './net/localProxy';
import { handleSettingsHttpRequest } from './settings/handler';
import { resolveMode, routeNameFromPath, type RouteTable } from './split';

export interface EngineConfig {
  /** Port the engine's own HTTP/WS server binds. */
  port: number;
  /** Bind host, defaults to loopback-only. */
  host?: string;
  /** The split.ts ownership table (already resolved from MAESTRO_ENGINE_ROUTES). */
  routes: RouteTable;
  /** Internal loopback port of the spawned Python backend, or null when nothing was spawned
   * (e.g. MAESTRO_ENGINE_SKIP_BACKEND=1) -- any 'proxy'-mode request then answers 502. */
  backendPort: number | null;
  /** Per-install bearer token (auth/token.ts) gating every request/upgrade this port accepts,
   * except the exempt paths auth/middleware.ts mirrors from backend/auth.py. */
  authToken: string;
}

// Large enough for image/attachment-bearing agent messages without becoming a memory-exhaustion
// footgun; the whole request body is buffered once (see the content-type parser below) before
// being forwarded, so this is also the hard ceiling on a single proxied request's size.
const P_PROXY_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

function writeUpgradeRejection(socket: Socket, status: number, statusText: string): void {
  try { socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`); } catch { /* socket already gone */ }
  socket.destroy();
}

export function buildServer(config: EngineConfig): FastifyInstance {
  const host = config.host ?? '127.0.0.1';
  const fastify = Fastify({ logger: false, bodyLimit: P_PROXY_BODY_LIMIT_BYTES });

  // Disable Fastify's default per-content-type body parsing (JSON, urlencoded, ...) entirely: a
  // proxy must forward the exact bytes it received, never a parsed-then-reserialized copy (that
  // would silently normalize key order, number formatting, etc. and break "byte-identical").
  // removeAllContentTypeParsers() first because a bare '*' parser only catches content types with
  // no explicit parser already registered -- Fastify ships default JSON/urlencoded parsers out of
  // the box, which would otherwise still intercept and re-encode exactly the bodies this matters
  // most for.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));

  // Cross-cutting auth: runs ahead of the native/proxy branch below for every HTTP request this
  // port accepts, same as backend/main.py's p_auth_middleware wraps every route Python serves --
  // see auth/middleware.ts's module doc for why this isn't a split.ts route-table entry.
  fastify.addHook('onRequest', createHttpAuthHook(() => config.authToken));

  fastify.all('*', async (request: FastifyRequest, reply: FastifyReply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];

    // BRW-6: browser-session cookie capture (interactive login) is native to the engine under
    // MAESTRO_BROWSER_ENGINE=cdp -- there is no Electron webview/main-bridge to ask under Tauri or
    // a headless engine, which is exactly what Python's existing browser_session_* handlers
    // (backend/main.py:652-707) depend on. Checked here, ahead of split.ts's name-based routing,
    // same convention as the browser-screencast upgrade special-case below: it has no
    // MAESTRO_ENGINE_ROUTES entry of its own, and falls through to the normal proxy (today's
    // behavior, unmodified) for any /api/browser-session/* subpath this handler doesn't own (e.g.
    // /action) or whenever the switch is off/unset.
    if (process.env.MAESTRO_BROWSER_ENGINE === 'cdp' && pathname.startsWith('/api/browser-session/')) {
      if (await handleBrowserLoginHttpRequest(pathname, request, reply)) return;
    }

    const name = routeNameFromPath(pathname);
    const mode = resolveMode(config.routes, name);

    if (mode === 'native') {
      // ENG-3: "settings" is native's first real handler, but only for the core GET/PUT/PATCH
      // /api/settings surface (settings/handler.ts) -- every other /api/settings/* subpath
      // still needs Python (9Router sync, OAuth, uploads, ...), so an unhandled settings path
      // deliberately falls through to the proxy branch below instead of 501ing, same as any
      // name this table doesn't mention at all.
      if (name === 'settings') {
        if (await handleSettingsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'health') {
        // ENG-7: health has exactly one route (health.ts's own header notes the plan doc's
        // anchor count) -- an unhandled /api/health/* subpath still falls through to proxy,
        // same "partial native" convention settings established, though in practice every real
        // health path is the one this handles.
        if (await handleHealthHttpRequest(pathname, request, reply)) return;
      } else if (name === 'service') {
        if (await handleServiceHttpRequest(pathname, request, reply)) return;
      } else {
        // Placeholder only for every other native-configured name -- a later ticket fills in
        // real behavior for it (see the plan's per-ticket route-table flips).
        reply.code(501).send({ error: 'not_implemented', route: name, detail: `"${name}" is configured native but the engine has no native handler for it yet` });
        return;
      }
    }

    if (config.backendPort === null) {
      reply.code(502).send({ error: 'bad_gateway', detail: 'no backend process is running to proxy to (MAESTRO_ENGINE_SKIP_BACKEND is set)' });
      return;
    }

    const body = (request.body as Buffer | undefined) ?? Buffer.alloc(0);
    reply.hijack();
    await proxyHttpRequest(request.raw, reply.raw, body, config.backendPort, host);
  });

  fastify.server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // Attached unconditionally, before anything else touches the socket -- see the identical
    // comment inside proxyWebSocketUpgrade on why a raw net.Socket with no 'error' listener
    // crashes the whole process, and why the auth-rejection destroy() below hits this exact path.
    socket.on('error', () => socket.destroy());

    // Cross-cutting auth, same as the onRequest hook above -- gates every upgrade this port
    // accepts before native/proxy routing decides anything. See auth/middleware.ts's
    // wsRequestAuthOk doc for why a bad/missing token destroys the raw socket (observed by the
    // client as abnormal closure code 1006) instead of writing a 401/403 upgrade response.
    if (!wsRequestAuthOk(req, config.authToken)) {
      socket.destroy();
      return;
    }

    const pathname = (req.url ?? '/').split('?')[0];

    // BRW-4: MAESTRO_BROWSER_ENGINE=cdp gives the canvas browser card its own WS endpoint,
    // native to the engine and outside split.ts's proxy/native table entirely -- it has no
    // backend/Python equivalent to proxy to (see screencastServer.ts's header) and no
    // /api/<name> sibling of its own to flip via MAESTRO_ENGINE_ROUTES. Checked ahead of the
    // name-based dispatch below: routeNameFromPath would read this path as name
    // "browser-screencast", absent from every table, defaulting to 'proxy' per split.ts --
    // which would forward it at the Python backend, which has no such route.
    if (pathname === '/ws/browser-screencast' && process.env.MAESTRO_BROWSER_ENGINE === 'cdp') {
      handleBrowserScreencastUpgrade(req, socket, head).catch((err: unknown) => {
        try { socket.destroy(); } catch { /* already gone */ }
        // eslint-disable-next-line no-console
        console.error('[engine] browser-screencast upgrade failed:', err);
      });
      return;
    }

    const name = routeNameFromPath(pathname);
    const mode = resolveMode(config.routes, name);

    if (mode === 'native') {
      writeUpgradeRejection(socket, 501, 'Not Implemented');
      return;
    }
    if (config.backendPort === null) {
      writeUpgradeRejection(socket, 502, 'Bad Gateway');
      return;
    }
    proxyWebSocketUpgrade(req, socket, head, config.backendPort, host);
  });

  return fastify;
}
