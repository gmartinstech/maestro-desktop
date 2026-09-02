// engine/src/main.ts -- ENG-1 entry point.
//
// After this ticket the engine is the ONLY thing the frontend/shell talks to (see the plan's
// ENG-1 entry: "This is the strangler fig"). Boot order: load the route table (split.ts), spawn
// the Python backend so 'proxy'-mode routes have somewhere to go, then bind the HTTP/WS server
// (server.ts) in front of it.

import { loadRouteTable, resolveMode } from './split';
import { buildServer } from './server';
import { getSharedBrowserScreencastRegistry } from './browser/screencastServer';
import { closeAllLoginCaptures } from './browser/cookies';
import { spawnPythonBackend, type PythonBackend } from './pythonBackend';
import { initAuthToken } from './auth/token';
import { installTokenScrubber } from './auth/scrubber';
import { manager as terminalManager, startTerminalIdleSweep } from './apps/terminal/manager';
import { initSkills } from './apps/skills/skills';
import { startSkillRegistry, stopSkillRegistry } from './apps/skillRegistry/skillRegistry';
import { initToolsLib } from './apps/toolsLib/store';
import { startMcpRegistry, stopMcpRegistry } from './apps/mcpRegistry/registry';
import { initOutputsApp, shutdownOutputsApp } from './apps/outputs/outputs';
import * as workflowScheduler from './apps/workflows/scheduler';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveSettings } from './settings/store';
import { refreshMaestroCatalog } from './settings/applyMaestroDefaults';
import { refreshMaestroAccessTokenIfNeeded, MAESTRO_REFRESH_INTERVAL_MS } from './settings/keycloakAuth';
import { isRunning as nineRouterIsRunning, ensureRunning as nineRouterEnsureRunning } from './router/process';
import { syncCustomProviders, syncGeminiApiKey, syncOpenaiApiKey, syncOpenrouterApiKey } from './router/sync';
import { UPLOAD_DIR } from './settings/uploads';

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

// SUB-10: port of settings.py's settings_lifespan boot half (9Router reconciliation + Maestro
// catalog refresh) plus its two background loops (maestro_refresh_loop, p_upload_dir_gc_loop).
// Returns the two interval handles so main()'s shutdown() can clear them; the one-shot boot work
// runs before either interval is armed. Every step is best-effort (matches the Python original's
// own broad except-and-log posture) -- a failure here must never crash engine boot.
async function startSettingsLifespan(): Promise<{ maestroRefreshTimer: NodeJS.Timeout; uploadGcTimer: NodeJS.Timeout }> {
  try {
    const settings = loadSettings().settings;
    const needsRouter = Boolean(
      settings.google_api_key || settings.openai_api_key || settings.openrouter_api_key || settings.custom_providers?.length,
    );
    if (needsRouter) {
      try {
        await nineRouterEnsureRunning();
      } catch (e) {
        console.warn(`[engine] settings: 9Router boot failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Reconcile, don't just add: a cleared/never-set key also REMOVES the managed connection
    // 9Router persists across restarts. Only acts when 9Router is already up (each sync no-ops if
    // not) -- mirrors settings.py's identical comment.
    if (await nineRouterIsRunning()) {
      await syncGeminiApiKey(settings.google_api_key ?? null);
      await syncOpenaiApiKey(settings.openai_api_key ?? null);
      await syncOpenrouterApiKey(settings.openrouter_api_key ?? null);
    }
    // Ask the gateway what it serves before pushing the node, so a model added server-side is
    // routable this launch instead of next release. Mutates `settings` in-memory only (matches
    // Python's own boot-task scoping -- this isn't persisted to disk here, same as the Python
    // original never saves inside settings_lifespan either).
    await refreshMaestroCatalog(settings);
    await syncCustomProviders(settings.custom_providers ?? []);
  } catch (e) {
    console.warn(`[engine] settings: boot-time 9Router sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // maestro_scheduler.py's maestro_refresh_loop: silently rotate the Maestro access token off its
  // refresh token every 30 minutes, well before its ~12h death, so a user who opens the app every
  // few hours never sees the sign-in prompt. The Keycloak round trip happens OUTSIDE any lock and
  // only the token field is re-read-and-saved immediately after, matching the Python original's
  // own comment on why a stale in-memory snapshot must never be the thing that gets saved back.
  const maestroRefreshTimer = setInterval(() => {
    void (async () => {
      try {
        const probe = loadSettings().settings;
        if (await refreshMaestroAccessTokenIfNeeded(probe)) {
          const current = loadSettings().settings;
          current.provedor_ia_token = probe.provedor_ia_token;
          saveSettings(current);
        }
      } catch (e) {
        console.warn(`[engine] settings: background Maestro token refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, MAESTRO_REFRESH_INTERVAL_MS);
  maestroRefreshTimer.unref();

  // p_upload_dir_gc_loop: daily GC of UPLOAD_DIR so a dropped attachment doesn't sit in the OS
  // temp dir forever. 7-day retention makes resume-after-restart work, matching settings.py's own
  // comment; errors are swallowed (a locked/in-use file must never crash this loop).
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const uploadGcTimer = setInterval(() => {
    try {
      const cutoff = Date.now() - 7 * ONE_DAY_MS;
      if (existsSync(UPLOAD_DIR)) {
        for (const entry of readdirSync(UPLOAD_DIR)) {
          const p = join(UPLOAD_DIR, entry);
          try {
            const st = statSync(p);
            if (st.isFile() && st.mtimeMs < cutoff) unlinkSync(p);
          } catch {
            // best-effort, matches p_upload_dir_gc_loop's own broad except
          }
        }
      }
    } catch {
      // best-effort
    }
  }, ONE_DAY_MS);
  uploadGcTimer.unref();

  return { maestroRefreshTimer, uploadGcTimer };
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

  // SUB-6: terminal.py's terminal_lifespan sweeper task -- started unconditionally, same as the
  // Python SubApp is always mounted regardless of whether 'terminal' is ever flipped native. A safe
  // no-op until then: the manager's session map stays empty, so sweepIdle() has nothing to do.
  startTerminalIdleSweep();

  // SUB-2: unlike terminal's always-safe no-op above, skills_lifespan's built-in seeding writes
  // real files under ~/.claude/skills/ and skill_registry_lifespan's refresh loop makes real
  // outbound GitHub requests -- neither is a no-op when unused, so both are gated on their own
  // route actually being native (matching BRW's screencast/login-capture gating below), not
  // started unconditionally the way terminal's idle sweep is. Running skills' seed redundantly
  // alongside Python's own (when 'skills' is proxy, the default) would just be wasted, racy I/O
  // with no consumer; running skill-registry's hourly network fetch with nothing native to serve
  // it to would be worse than wasted -- and either the engine or the Python backend, not both,
  // should ever be writing the same on-disk index/cache at once.
  if (resolveMode(routes, 'skills') === 'native') {
    initSkills();
  }
  if (resolveMode(routes, 'skill-registry') === 'native') {
    startSkillRegistry();
  }
  // SUB-4: same gating reasoning as skills/skill-registry above -- tools_lib_lifespan's
  // ensureDefaultPermissions()/reclassifyExistingTools() write real files under DATA_ROOT/tools,
  // and mcp_registry's refresh loop makes real hourly outbound requests (registry.
  // modelcontextprotocol.io + Google's README + GitHub stars). Neither is a safe no-op when unused.
  if (resolveMode(routes, 'tools') === 'native') {
    initToolsLib();
  }
  if (resolveMode(routes, 'mcp-registry') === 'native') {
    startMcpRegistry();
  }
  // SUB-5: same gating reasoning as skills/tools above -- outputs_lifespan's boot half registers
  // a real liveness marker and reaps orphaned app-runtime subprocesses left by a previous session,
  // neither a safe no-op when unused. handleOutputsHttpRequest also calls this (idempotent, see
  // its own pStarted guard) as a safety net for whenever a request arrives before this line ran.
  if (resolveMode(routes, 'outputs') === 'native') {
    initOutputsApp();
  }
  // SUB-7: workflows_lifespan's boot half (storage.init() + scheduler.start(), which itself runs
  // markStuckRunsFailed()/reconcileOnStartup() before the tick loop) -- gated the same way as
  // skills/tools/mcp-registry/outputs above, not started unconditionally: the reconcile walk
  // read/writes real workflow records under DATA_ROOT/workflows and (via captureMissed) creates
  // real MissedRun rows, neither a safe no-op when 'workflows' is proxy (the default) and Python
  // owns that data instead. start() is idempotent (see scheduler.ts's own guard), so this is safe
  // to also be reached lazily by http.ts's own ensureStarted() on first request -- whichever runs
  // first wins, the other is a no-op.
  if (resolveMode(routes, 'workflows') === 'native') {
    void workflowScheduler.start();
  }
  // SUB-10: settings_lifespan's boot half -- gated the same way as skills/tools/outputs/workflows
  // above (a real 9Router boot + real background token-refresh network calls are not a safe no-op
  // when 'settings' is proxy, the default, and Python owns this lifespan instead). Fire-and-forget,
  // off the request path, mirroring settings.py's own p_boot_router_then_sync/maestro_refresh_loop/
  // p_upload_dir_gc_loop -- none of these block server startup.
  let maestroRefreshTimer: NodeJS.Timeout | null = null;
  let uploadGcTimer: NodeJS.Timeout | null = null;
  if (resolveMode(routes, 'settings') === 'native') {
    void startSettingsLifespan().then((timers) => {
      maestroRefreshTimer = timers.maestroRefreshTimer;
      uploadGcTimer = timers.uploadGcTimer;
    });
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
    // SUB-6: every shell must die with the engine, same as terminal.py's terminal_lifespan finally
    // block -- on Windows a killed parent leaves its descendants running, so a missed reap strands
    // pwsh.exe processes across restarts. A no-op if 'terminal' was never flipped native. AWAITED,
    // not fire-and-forget: node-pty's Windows kill() is not synchronous (can take several seconds
    // when its internal console-list helper fails -- see ptySession.ts's header for the real,
    // reproduced orphan this closes), and `process.exit(0)` a few lines below would otherwise abort
    // a still-pending kill mid-flight, leaking the real pwsh.exe process.
    try {
      const killed = await terminalManager.stopAll();
      if (killed > 0) console.log(`[engine] terminal: reaped ${killed} shells on shutdown`);
    } catch (err) {
      console.error('[engine] terminal: stopAll failed during shutdown:', err);
    }
    // SUB-2: mirrors skill_registry_lifespan's `p_refresh_task.cancel()` -- a no-op if
    // startSkillRegistry() was never called (route wasn't native) since stopSkillRegistry() only
    // clears state that would already be null/false in that case.
    try {
      stopSkillRegistry();
    } catch (err) {
      console.error('[engine] skill-registry: stop failed during shutdown:', err);
    }
    // SUB-4: mirrors mcp_registry_lifespan's `p_refresh_task.cancel()` -- a no-op if
    // startMcpRegistry() was never called.
    try {
      await stopMcpRegistry();
    } catch (err) {
      console.error('[engine] mcp-registry: stop failed during shutdown:', err);
    }
    // SUB-5: mirrors outputs_lifespan's finally block -- every per-app subprocess (bash run.sh +
    // its vite/uvicorn descendants) must die here, before backend?.close() below, or it reparents
    // and squats on .env-pinned ports across restarts. AWAITED for the same reason terminal's
    // stopAll() above is: a full descendant-tree kill isn't necessarily synchronous, and
    // process.exit(0) a few lines down would abort a still-pending one.
    try {
      await shutdownOutputsApp();
    } catch (err) {
      console.error('[engine] outputs: shutdown failed:', err);
    }
    // SUB-7: mirrors workflows_lifespan's finally block (`await scheduler.stop()`) -- a no-op if
    // the loop was never started (route never native, never lazily hit either).
    try {
      await workflowScheduler.stop();
    } catch (err) {
      console.error('[engine] workflows: scheduler stop failed during shutdown:', err);
    }
    // SUB-10: mirrors settings_lifespan's implicit teardown (Python's own background tasks are
    // just cancelled when the process dies -- there's no explicit finally block to mirror, only
    // "stop scheduling more work"). Both are no-ops (null) if 'settings' was never native.
    if (maestroRefreshTimer) clearInterval(maestroRefreshTimer);
    if (uploadGcTimer) clearInterval(uploadGcTimer);
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
