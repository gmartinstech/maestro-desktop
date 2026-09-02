// engine/src/main.ts -- ENG-1 entry point.
//
// After this ticket the engine is the ONLY thing the frontend/shell talks to (see the plan's
// ENG-1 entry: "This is the strangler fig"). Boot order: load the route table (split.ts), spawn
// the Python backend so 'proxy'-mode routes have somewhere to go, then bind the HTTP/WS server
// (server.ts) in front of it.

import { loadRouteTable } from './split';
import { buildServer } from './server';
import { getSharedBrowserScreencastRegistry } from './browser/screencastServer';
import { closeAllLoginCaptures } from './browser/cookies';
import { spawnPythonBackend, type PythonBackend } from './pythonBackend';
import { initAuthToken } from './auth/token';
import { installTokenScrubber } from './auth/scrubber';

const P_DEFAULT_PORT = 8420;

function enginePort(): number {
  const raw = process.env.MAESTRO_ENGINE_PORT;
  if (!raw) return P_DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`MAESTRO_ENGINE_PORT must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const host = process.env.MAESTRO_ENGINE_HOST ?? '127.0.0.1';
  const port = enginePort();
  const routes = loadRouteTable();

  // Per-install bearer token: generated (or reused from disk) BEFORE the port binds, mirroring
  // backend/main.py's own ordering comment -- by the time any request lands, the token file
  // exists. Installing the log scrubber right after means nothing logged from here on (including
  // the Python backend's own boot output below) can leak it. See auth/token.ts's module doc for
  // why this must also run before spawnPythonBackend(): whichever process runs init first mints
  // the token file the other one reads.
  const authToken = initAuthToken();
  installTokenScrubber(() => authToken);

  // MAESTRO_ENGINE_ROUTES unset (or sparse) means every name defaults to 'proxy' (split.ts), so
  // the backend is spawned by default. The one escape hatch is explicit: MAESTRO_ENGINE_SKIP_BACKEND=1
  // for a future all-native engine (SUB-10's "Python is dark") or for a test that only cares about
  // the 'native' 501-placeholder path and doesn't want a Python process at all. Detecting "the
  // table covers every possible name as native" automatically would need the complete SubApp name
  // universe, which is SUB-10's job, not this skeleton's -- spawning a backend nothing ends up
  // proxying to is wasted memory, never a correctness bug, so defaulting to "spawn" is the safe
  // choice until that day comes.
  const skipBackend = process.env.MAESTRO_ENGINE_SKIP_BACKEND === '1';
  let backend: PythonBackend | null = null;
  if (!skipBackend) {
    backend = await spawnPythonBackend();
    console.log(`[engine] python backend ready on 127.0.0.1:${backend.port}`);
    // ENG-5: backend/main.py sets this same env var (from its own --port) before anything that
    // needs it spawns; here it's the engine's job instead, since this engine -- not Python -- is
    // now what spawns 9Router. Without it, backend/apps/agents/9router_gpt5_patch.js's OAuth
    // callback proxy (see engine/src/settings/loopback.ts's own module doc, case 1) forwards the
    // Maestro Keycloak /callback hit at its `|| '8324'` fallback instead of this backend's real
    // (randomly-chosen) port whenever 9Router is running -- silently breaking sign-in. Must be set
    // before 9Router is ever spawned (router/process.ts's env spread of `...process.env` is what
    // carries it down to 9Router's child env), which is always after this point in boot.
    process.env.MAESTRO_PORT = String(backend.port);
  } else {
    console.log('[engine] MAESTRO_ENGINE_SKIP_BACKEND=1 -- not spawning a Python backend; every proxy-mode route will answer 502');
  }

  const fastify = buildServer({ port, host, routes, backendPort: backend?.port ?? null, authToken });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[engine] received ${signal}, shutting down`);
    try { await fastify.close(); } catch { /* best-effort */ }
    // BRW-4: any external browser this process launched for the canvas card must not outlive it
    // -- an orphaned msedge.exe/chrome.exe is exactly the failure mode launcher.ts's own
    // integration-check gate checks for after every close(). Only reachable if the switch was
    // ever on, so this is a no-op (empty registry) on the default 'electron' path.
    if (process.env.MAESTRO_BROWSER_ENGINE === 'cdp') {
      try { await getSharedBrowserScreencastRegistry().closeAll(); } catch { /* best-effort */ }
      // BRW-6: same hygiene concern as the screencast registry above, for whatever visible
      // login-capture browser(s) are still open (a user mid-2FA when the engine restarts).
      try { await closeAllLoginCaptures(); } catch { /* best-effort */ }
    }
    backend?.close();
    process.exit(0);
  };
  process.on('SIGINT', (s) => { void shutdown(s); });
  process.on('SIGTERM', (s) => { void shutdown(s); });

  const address = await fastify.listen({ port, host });
  console.log(`[engine] listening on ${address}`);
}

main().catch((err: unknown) => {
  console.error('[engine] fatal error during boot:', err);
  process.exit(1);
});
