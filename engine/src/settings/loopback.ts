// engine/src/settings/loopback.ts -- ENG-5: who owns port 20128's OAuth redirect callback.
//
// Keycloak's registered redirect URI for the Maestro client is fixed at
// http://127.0.0.1:20128/callback (keycloakAuth.ts's MAESTRO_KEYCLOAK_REDIRECT_URI) -- that value
// itself is NOT changed by this ticket, only who answers on it. Two cases, both real, both handled:
//
//   1. 9Router IS running: it already owns port 20128 (backend/apps/nine_router/process.py /
//      engine/src/router/process.ts binds it) and backend/apps/agents/9router_gpt5_patch.js's
//      patchOauthCallbackExchange() already intercepts the /callback hit and forwards it
//      server-to-server into MAESTRO_PORT's /api/subscriptions/callback -- which, whether that
//      lands on the Python backend (still spawned by this engine for every 'proxy'-mode route) or
//      a future native engine handler, already does the right thing UNMODIFIED. This module must
//      never bind 20128 itself in this case: doing so would either fail with EADDRINUSE (if 9Router
//      grabs the port first) or, worse, silently steal the port out from under 9Router's own
//      startup (if this module grabs it first), breaking the existing, working path. See
//      engine/src/main.ts's own MAESTRO_PORT wiring, added alongside this file, for the other half
//      of "still correctly accept 9Router's proxied callback" -- without that env var reaching
//      9Router's spawned env, the patch's forward target silently falls back to the wrong port.
//
//   2. 9Router is NOT running: nobody owns port 20128 at all, so Keycloak's redirect would hit a
//      closed port and the browser would show a connection-refused error -- exactly the gap this
//      ticket exists to close. startMaestroLoopbackListener() below binds a ONE-SHOT listener
//      (same shape as router/oauth.ts's startCodexCallbackListener for the 1455/1457 Codex case):
//      scoped to a single login attempt with a timeout, not a permanent daemon. That scoping is
//      deliberate, not incidental -- 9Router's own supervision (ENG-6) can start it at ANY later
//      moment for an unrelated reason (an agent turn routed through it), and a listener that stayed
//      bound forever would then make 9Router's OWN bind attempt fail. A short-lived, self-closing
//      listener means the window where this module holds the port is bounded to "the user is
//      actively completing a Maestro sign-in right now", which is the only time it matters anyway.
//
// isNineRouterRunning is checked immediately before every bind attempt (not cached, not checked
// once at engine boot) precisely because "is 9Router up" is not a boot-time constant here -- see
// case 2's own reasoning above.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isRunning as nineRouterIsRunning } from '../router/process';
import { completeMaestroLoginCallback, type MaestroCallbackOutcome } from './keycloakAuth';

// The callback-completion function is injectable (default: the real completeMaestroLoginCallback,
// which really talks to Keycloak and the OS credential store) so loopback.test.ts can exercise the
// bind + HTTP request/response cycle in full -- including the "unknown state" and "success" shapes
// -- with a fake outcome and zero real network/keyring I/O, while
// loopback.integration-check.ts (this ticket's GATE (b)) uses the real one to prove the plumbing
// actually reaches Keycloak's token endpoint end to end.
export type CompleteCallbackFn = (params: { code?: string; state?: string; error?: string }) => Promise<MaestroCallbackOutcome>;

export const MAESTRO_LOOPBACK_PORT = 20128;
export const MAESTRO_LOOPBACK_PATH = '/callback';

function htmlPage(heading: string, message: string): string {
  return (
    '<html><body style="background:#1a1a1a;color:#fff;display:flex;align-items:center;' +
    'justify-content:center;height:100vh;font-family:sans-serif"><div style="text-align:center">' +
    `<h2>${heading}</h2><p style="color:#888">${message}</p></div></body></html>`
  );
}

const P_SUCCESS_HTML = htmlPage('Connected!', 'You can close this tab, and any other login tab still open.');

function failureHtmlFor(outcome: Extract<MaestroCallbackOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'error':
      return htmlPage('Authorization failed', outcome.detail ?? 'error');
    case 'unknown_state':
      return htmlPage('Session expired', 'Please try connecting again.');
    case 'exchange_failed':
    case 'no_access_token':
    default:
      return htmlPage('Connection failed', 'Sign-in failed. Please try again.');
  }
}

export interface LoopbackListener {
  readonly port: number;
  /** Closes the listener early (e.g. engine shutdown). Safe to call more than once. */
  close(): Promise<void>;
}

export interface LoopbackDeps {
  isNineRouterRunning: () => Promise<boolean>;
}
const defaultLoopbackDeps: LoopbackDeps = { isNineRouterRunning: nineRouterIsRunning };

// Tracks the live listener so a fresh attempt can reclaim the port from a still-bound prior one
// instead of failing to bind and leaving a fresh sign-in attempt's redirect unanswered -- mirrors
// router/oauth.ts's codexListenerServer for the exact same reason.
let activeListenerServer: Server | null = null;

async function closeActiveListener(): Promise<void> {
  if (activeListenerServer === null) return;
  const server = activeListenerServer;
  activeListenerServer = null;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function handleRequest(req: IncomingMessage, res: ServerResponse, onServed: () => void, completeCallback: CompleteCallbackFn): void {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}`);
  if (req.method !== 'GET' || url.pathname !== MAESTRO_LOOPBACK_PATH) {
    res.writeHead(404, { 'Content-Length': '0', Connection: 'close' });
    res.end();
    return;
  }
  void (async () => {
    const outcome = await completeCallback({
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error: url.searchParams.get('error') ?? undefined,
    });
    const body = outcome.ok ? P_SUCCESS_HTML : failureHtmlFor(outcome);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(body);
    onServed();
  })();
}

/** Binds the raw one-shot listener unconditionally -- no 9Router check here; that gate lives in
 * startMaestroLoopbackListener below. Split out so a test can exercise the bind + request-handling
 * behavior directly without needing to fake "9Router is down" through the isRunning() seam too. */
export function bindMaestroLoopbackListener(timeoutMs = 300_000, completeCallback: CompleteCallbackFn = completeMaestroLoginCallback): Promise<LoopbackListener> {
  return new Promise((resolveBind, rejectBind) => {
    let servedResolve: (() => void) | null = null;
    const served = new Promise<void>((r) => { servedResolve = r; });

    const server = createServer((req, res) => handleRequest(req, res, () => servedResolve?.(), completeCallback));

    const onBindError = (err: unknown): void => {
      server.removeAllListeners();
      rejectBind(err instanceof Error ? err : new Error(String(err)));
    };
    server.once('error', onBindError);
    server.listen(MAESTRO_LOOPBACK_PORT, '127.0.0.1', () => {
      server.removeListener('error', onBindError);
      // A genuinely unexpected bind-time error after listen() succeeded (e.g. an OS-level socket
      // fault mid-request) must not crash the whole engine process -- log and let this one
      // listener's own close() below tear it down same as a normal timeout.
      server.on('error', (err) => console.warn(`[engine] Maestro loopback listener error: ${(err as Error).message}`));
      activeListenerServer = server;

      void (async () => {
        try {
          await Promise.race([served, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
          // Give the served HTML a moment before closing the socket, mirroring the Codex listener's
          // identical grace window.
          await new Promise((r) => setTimeout(r, 2000));
        } finally {
          if (activeListenerServer === server) activeListenerServer = null;
          server.close();
        }
      })();

      resolveBind({
        port: MAESTRO_LOOPBACK_PORT,
        close: async () => {
          if (activeListenerServer === server) activeListenerServer = null;
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

/** The real entry point: binds the Maestro OAuth loopback listener on port 20128, but ONLY when
 * 9Router is not currently running -- see module doc's case 1/2 split. Returns null (not an error)
 * when 9Router already owns the port; that is the expected, correctly-handled coexistence case,
 * not a failure. Also returns null (with a warning logged) if the bind itself fails for any other
 * reason (something else entirely holds 20128) -- callers should treat both null cases the same
 * way: the local listener isn't available, but the 9Router-mediated path might still work. */
export async function startMaestroLoopbackListener(
  timeoutMs = 300_000,
  deps: LoopbackDeps = defaultLoopbackDeps,
  completeCallback: CompleteCallbackFn = completeMaestroLoginCallback,
): Promise<LoopbackListener | null> {
  // Reclaim from a still-bound prior attempt of our own (e.g. the user retried sign-in) before
  // re-checking 9Router -- a stale listener of ours must not itself look like "the port is held by
  // something else" to the bind attempt below.
  await closeActiveListener();

  if (await deps.isNineRouterRunning()) {
    console.info('[engine] 9Router owns port 20128; the Maestro OAuth callback will arrive proxied through it, not this listener');
    return null;
  }

  try {
    return await bindMaestroLoopbackListener(timeoutMs, completeCallback);
  } catch (e) {
    console.warn(`[engine] Could not start the Maestro OAuth loopback listener on port ${MAESTRO_LOOPBACK_PORT}: ${(e as Error).message}`);
    return null;
  }
}

/** Test-only: force-clears the module-level "currently bound" tracking without waiting on a real
 * close, for a test that constructs its own server directly. Not used by any runtime path. */
export function resetActiveListenerForTests(): void {
  activeListenerServer = null;
}
