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
import { handleCorsPreflight } from './cors';
import { handleHealthHttpRequest } from './apps/health/health';
import { handleServiceHttpRequest } from './apps/service/service';
import { handleBrowserScreencastUpgrade } from './browser/screencastServer';
import { handleBrowserLoginHttpRequest } from './browser/cookies';
// ENG-7 moved the raw node:http proxy plumbing into engine/src/net/ -- the one directory the
// provider-egress ESLint rule exempts from the node:http/fetch import ban (see that file's
// header for why this mechanism can't just become an engineFetch() call).
import { proxyHttpRequest, proxyWebSocketUpgrade } from './net/localProxy';
import { handleSettingsHttpRequest } from './settings/handler';
import { handleDevHttpRequest } from './apps/dev/dev';
import { handleModesHttpRequest } from './apps/modes/modes';
import { handleDashboardLayoutHttpRequest } from './apps/dashboardLayout/dashboardLayout';
import { handleSkillsHttpRequest } from './apps/skills/http';
import { handleSkillRegistryHttpRequest } from './apps/skillRegistry/http';
import { handleToolsHttpRequest } from './apps/toolsLib/http';
import { handleMcpRegistryHttpRequest } from './apps/mcpRegistry/http';
import { handleAgentsHttpRequest } from './agents/http';
import { handleDashboardsHttpRequest } from './apps/dashboards/dashboards';
import { handleSwarmHttpRequest } from './apps/swarm/swarm';
import { handleOutputsHttpRequest } from './apps/outputs/outputs';
import { handleOutputVersionsHttpRequest } from './apps/outputs/versionsRoutes';
import { handleWorkflowsHttpRequest } from './apps/workflows/http';
import { handleWebHttpRequest } from './apps/web/web';
import { handleAgentsWsUpgrade } from './agents/ws';
import { handleTerminalWsUpgrade } from './apps/terminal/ws';
import { handleAnthropicProxyHttpRequest } from './agents/proxy/anthropicProxy';
import { handleOpenaiPassthroughHttpRequest } from './agents/proxy/openaiPassthrough';
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
    // SUB-10: CORS preflight is answered here, ahead of EVERY path's native/proxy dispatch --
    // backend/main.py's CORSMiddleware wraps the whole app the same way, so a native route must
    // not need to reimplement this itself (see cors.ts's own header for the gap this closes).
    if (handleCorsPreflight(request, reply)) return;

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
      } else if (name === 'dev') {
        // SUB-10: full native, its one route dev.ts's own header names -- backend/main.py's bare
        // GET /api/dev/token, not a SubApp. MAESTRO_ENGINE_ROUTES=dev:native (not in split.ts's
        // DEFAULT_ROUTES), same convention every other SUB-ported name uses.
        if (await handleDevHttpRequest(pathname, request, reply)) return;
      } else if (name === 'modes') {
        // SUB-1: full native, every route modes.ts's own header names.
        if (await handleModesHttpRequest(pathname, request, reply)) return;
      } else if (name === 'dashboard_layout') {
        // SUB-1: full native (2 routes) -- see dashboardLayout.ts's header: this SubApp is
        // unmounted/dead in the real Python backend today, so this only activates via an
        // explicit MAESTRO_ENGINE_ROUTES opt-in, never via a DEFAULT_ROUTES default.
        if (await handleDashboardLayoutHttpRequest(pathname, request, reply)) return;
      } else if (name === 'skills') {
        // SUB-2: full native, every route apps/skills/http.ts's own header names.
        if (await handleSkillsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'skill-registry') {
        // SUB-2: full native (backend/apps/skill_registry/skill_registry.py's whole router) --
        // note the route-table NAME is the hyphenated "skill-registry" (matching the actual
        // /api/skill-registry URL prefix Python's SubApp("skill-registry", ...) produces), not the
        // underscored Python module/package name -- MAESTRO_ENGINE_ROUTES=skill-registry:native.
        if (await handleSkillRegistryHttpRequest(pathname, request, reply)) return;
      } else if (name === 'tools') {
        // SUB-4: full native, every route apps/toolsLib/http.ts's own header names (the deliberate
        // scope cuts documented there fall through to proxy instead of 501ing, same convention
        // 'settings'/'agents' already use).
        if (await handleToolsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'mcp-registry') {
        // SUB-4: full native, every route apps/mcpRegistry/http.ts's own header names -- note the
        // route-table NAME is the hyphenated "mcp-registry" (matching the actual /api/mcp-registry
        // URL prefix Python's SubApp("mcp-registry", ...) produces), same convention SUB-2
        // established for skill-registry -- MAESTRO_ENGINE_ROUTES=mcp-registry:native.
        if (await handleMcpRegistryHttpRequest(pathname, request, reply)) return;
      } else if (name === 'agents') {
        // AGT-6: partial native, same convention as 'settings' above -- an /api/agents/* subpath
        // this ticket didn't port falls through to proxy instead of 501ing (see agents/http.ts's
        // own header for the exact list and why).
        if (await handleAgentsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'anthropic-proxy') {
        // AGT-7: full native (every method under /v1/* plus the bare-path healthcheck) -- see
        // agents/proxy/anthropicProxy.ts's own header. Only takes effect via
        // MAESTRO_ENGINE_ROUTES=anthropic-proxy:native (not in DEFAULT_ROUTES), same convention
        // as 'agents' above.
        if (await handleAnthropicProxyHttpRequest(pathname, request, reply)) return;
      } else if (name === 'openai-passthrough') {
        // AGT-7: full native -- see agents/proxy/openaiPassthrough.ts's own header. Also only
        // takes effect via MAESTRO_ENGINE_ROUTES, same convention as 'anthropic-proxy' above.
        if (await handleOpenaiPassthroughHttpRequest(pathname, request, reply)) return;
      } else if (name === 'dashboards') {
        // SUB-3: full native, every route apps/dashboards/dashboards.ts's own header names
        // (the one documented scope cut -- generate-name's aux-LLM call -- falls back to the
        // exact heuristic branch the Python original's own except-Exception already uses, so it
        // never 501s or proxies partway through a route).
        if (await handleDashboardsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'swarm') {
        // SUB-3: full native, every route apps/swarm/swarm.ts's own header names.
        if (await handleSwarmHttpRequest(pathname, request, reply)) return;
      } else if (name === 'outputs') {
        // SUB-5: partial native (same convention as 'settings'/'agents' above) -- every CRUD +
        // workspace + persistent-runtime route apps/outputs/outputs.ts's own header names; the one
        // remaining documented scope cut (vibe-code's LLM call) answers inline with a clear
        // "not yet available" message rather than 501ing. Only takes effect via
        // MAESTRO_ENGINE_ROUTES=outputs:native (not in DEFAULT_ROUTES), same convention 'dashboards'/
        // 'swarm' established.
        if (await handleOutputsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'output_versions') {
        // SUB-5: full native -- backend/apps/outputs/versions_routes.py's `/api/output_versions`
        // surface, apps/outputs/versionsRoutes.ts's own header names every route. A separate
        // route-table name from 'outputs' (matching Python's own separate SubApp), so it needs its
        // own MAESTRO_ENGINE_ROUTES=output_versions:native flip alongside outputs:native.
        if (await handleOutputVersionsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'workflows') {
        // SUB-7: full native, every route apps/workflows/http.ts's own header names (~3.3k LOC,
        // 35 routes -- the largest route surface in the app). Only takes effect via
        // MAESTRO_ENGINE_ROUTES=workflows:native (not in DEFAULT_ROUTES), same convention
        // 'dashboards'/'swarm'/'outputs' established.
        if (await handleWorkflowsHttpRequest(pathname, request, reply)) return;
      } else if (name === 'web') {
        // SUB-8: full native, both routes apps/web/web.ts's own header names (POST /search,
        // POST /fetch). Only takes effect via MAESTRO_ENGINE_ROUTES=web:native (not in
        // DEFAULT_ROUTES), same convention 'dashboards'/'swarm'/'outputs'/'workflows'
        // established. Its browser tier replaces Electron's `/ws/electron-main` bridge with a
        // direct, in-process call into BRW-5's CDP tier -- see web.ts's own module doc.
        if (await handleWebHttpRequest(pathname, request, reply)) return;
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
      // AGT-6: partial native, same convention as the HTTP branch above -- 'agents' has exactly
      // one WS shape (/ws/agents/{session_id}); anything under that name NOT matching it falls
      // through to proxy rather than 501ing, mirroring agents/http.ts's own fallthrough.
      if (name === 'agents') {
        if (handleAgentsWsUpgrade(req, socket, head)) return;
      } else if (name === 'terminal') {
        // SUB-6: 'terminal' has no /api/terminal HTTP surface at all (see apps/terminal/ws.ts's
        // own header) -- only takes effect via MAESTRO_ENGINE_ROUTES=terminal:native, same
        // convention as 'agents' above; the one WS shape is /ws/terminal/{workspace_id}.
        if (handleTerminalWsUpgrade(req, socket, head)) return;
      } else {
        writeUpgradeRejection(socket, 501, 'Not Implemented');
        return;
      }
    }
    if (config.backendPort === null) {
      writeUpgradeRejection(socket, 502, 'Bad Gateway');
      return;
    }
    proxyWebSocketUpgrade(req, socket, head, config.backendPort, host);
  });

  return fastify;
}
