// engine/src/settings/handler.ts -- ENG-3 ported the core GET/PUT/PATCH /api/settings surface;
// SUB-10 ("Python is dark") ports every remaining /api/settings/* subpath ENG-3's own header
// deliberately left unhandled: maestro/token-status, maestro/login/start, app-theme-override,
// dismiss-mcp-suggestion, default-system-prompt, reset-*, upload-files, summarize-file,
// browse-directories -- and the apply_maestro_defaults' 9Router reconciliation ENG-3's header also
// named as out of its scope. See backend/apps/settings/settings.py for the Python original this
// whole file mirrors route-for-route.
//
// A subpath this file still doesn't recognize (there are none left, by design -- see the
// "unreachable" comment on the final `return false` below) falls through to proxy, same convention
// every other partial-native handler in this codebase (agents/http.ts, outputs/outputs.ts, ...)
// uses for its own documented scope cuts.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { coerceSettings, DEFAULT_SYSTEM_PROMPT, type AppSettings } from './models';
import { loadSettings, saveSettings } from './store';
import { applyMaestroDefaults } from './applyMaestroDefaults';
import { maestroTokenStatus } from './tokenStatus';
import { startMaestroLogin, MAESTRO_KEYCLOAK_REDIRECT_URI } from './keycloakAuth';
import { startMaestroLoopbackListener } from './loopback';
import { isRunning as nineRouterIsRunning, ensureRunning as nineRouterEnsureRunning } from '../router/process';
import { syncCustomProviders, syncGeminiApiKey, syncOpenaiApiKey, syncOpenrouterApiKey } from '../router/sync';
import { browseDirectories, parseMultipartFiles, readUploadedFileForSummary, saveUploadedFile } from './uploads';

// Written only by their own dedicated flows (OAuth connects, analytics registration) -- a full
// PUT from a stale renderer snapshot, or a PATCH diff, must never revert or forge them. Mirrors
// backend/apps/settings/settings.py's SERVER_OWNED_FIELDS exactly.
const SERVER_OWNED_FIELDS: readonly (keyof AppSettings)[] = [
  'connection_mode',
  'maestro_bearer_token',
  'maestro_proxy_url',
  'user_id',
  'signin_method',
  'installation_id',
  'analytics_token',
  'timezone',
  'locale',
  'claude_subscription_token',
  'openai_subscription_token',
  'gemini_subscription_token',
];

// A preferences reset (the iOS "Reset All Settings" analogue): everything back to defaults EXCEPT
// the things a "reset my preferences" click must never silently sever -- your connections
// (server-owned subscription fields AND your pasted provider credentials) and your identity. Hard-
// erase is a separate flow. Mirrors settings.py's RESET_PRESERVE_FIELDS exactly.
const RESET_PRESERVE_FIELDS: readonly (keyof AppSettings)[] = [
  ...SERVER_OWNED_FIELDS,
  'anthropic_api_key',
  'openai_api_key',
  'google_api_key',
  'openrouter_api_key',
  'provedor_ia_token',
  'custom_providers',
  'user_name',
  'user_email',
  'analytics_opt_in',
  'first_opened_at',
];

function restoreServerOwnedFields(next: AppSettings, current: AppSettings): void {
  for (const field of SERVER_OWNED_FIELDS) {
    (next as unknown as Record<string, unknown>)[field] = current[field];
  }
}

// Fastify's own body parsers are disabled engine-wide (server.ts, so proxied bodies forward
// byte-for-byte) -- request.body always arrives as a raw Buffer here, parsed by hand instead.
function parseJsonObjectBody(request: FastifyRequest): Record<string, unknown> | null {
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rawBody(request: FastifyRequest): Buffer {
  const raw = request.body;
  return Buffer.isBuffer(raw) ? raw : Buffer.alloc(0);
}

// Off the request path, exactly like settings.py's own p_boot_and_sync_keys: ensure_running() can
// take several minutes on a first install (npm pull), and would freeze a settings save if awaited
// inline. Fire-and-forget; failures are logged, never surfaced to the caller who already got their
// 200. Deliberately does NOT port invalidate_openrouter_cache() on an openrouter-key change --
// registry.ts's own header already defers that cache (no engine-side cache exists yet to
// invalidate), a narrow, named scope cut, not a silent drop.
function scheduleNineRouterSync(next: AppSettings, changed: { google: boolean; openai: boolean; openrouter: boolean; customProviders: boolean; anyKeyedAdded: boolean }): void {
  if (!(changed.google || changed.openai || changed.openrouter || changed.customProviders)) return;
  void (async () => {
    try {
      if (changed.anyKeyedAdded && !(await nineRouterIsRunning())) {
        await nineRouterEnsureRunning();
      }
      if (changed.google) await syncGeminiApiKey(next.google_api_key ?? null);
      if (changed.openai) await syncOpenaiApiKey(next.openai_api_key ?? null);
      if (changed.openrouter) await syncOpenrouterApiKey(next.openrouter_api_key ?? null);
      if (changed.customProviders) await syncCustomProviders(next.custom_providers ?? []);
    } catch (e) {
      console.warn(`[engine] background 9Router settings sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}

/** Port of settings.py's apply_settings_update: restore server-owned fields, re-derive the Maestro
 * provider entry, persist, then (off the request path) reconcile 9Router connections for whatever
 * credential fields actually changed. Returns the saved object. */
function applySettingsUpdate(next: AppSettings): AppSettings {
  const old = loadSettings().settings;
  restoreServerOwnedFields(next, old);
  applyMaestroDefaults(next);
  saveSettings(next);

  const customProvidersChanged = JSON.stringify(next.custom_providers ?? []) !== JSON.stringify(old.custom_providers ?? []);
  const changed = {
    google: (next.google_api_key ?? null) !== (old.google_api_key ?? null),
    openai: (next.openai_api_key ?? null) !== (old.openai_api_key ?? null),
    openrouter: (next.openrouter_api_key ?? null) !== (old.openrouter_api_key ?? null),
    customProviders: customProvidersChanged,
    anyKeyedAdded:
      (Boolean(next.google_api_key) && !old.google_api_key) ||
      (Boolean(next.openai_api_key) && !old.openai_api_key) ||
      (Boolean(next.openrouter_api_key) && !old.openrouter_api_key) ||
      (Boolean(next.custom_providers?.length) && !old.custom_providers?.length),
  };
  scheduleNineRouterSync(next, changed);
  return next;
}

function sendJson(reply: FastifyReply, status: number, body: unknown): true {
  reply.code(status).send(body);
  return true;
}

function badRequest(reply: FastifyReply, detail: string): true {
  return sendJson(reply, 400, { error: 'bad_request', detail });
}

// Handles the whole /api/settings subtree; returns false (reply left untouched) for anything this
// file doesn't recognize so the caller can fall back to proxying at Python (unreachable today --
// every GET/PUT/PATCH/POST subpath settings.py defines is handled below -- kept as the safety net
// every other partial-native handler in this codebase relies on, in case a later Python-side route
// addition lands here before its engine port does).
export async function handleSettingsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  // Exact-segment match, not a bare prefix -- '/api/settings-meta/...' is a DIFFERENT top-level
  // route (a separate name in split.ts's routing table, server.ts never dispatches it here) and
  // must not be swallowed by a loose `startsWith('/api/settings')` check.
  if (pathname !== '/api/settings' && !pathname.startsWith('/api/settings/')) return false;
  const sub = pathname.slice('/api/settings'.length); // '', '/maestro/token-status', ...
  const method = request.method.toUpperCase();

  if (sub === '') {
    // Python's own store.load_settings() runs apply_maestro_defaults on EVERY load (store.py
    // line ~183), so GET /api/settings there always reflects the derived Maestro custom_providers
    // entry -- this engine's store.ts deliberately does not carry that mutation (a store-wide
    // change with a huge blast radius across every other already-native subsystem that also calls
    // loadSettings(); see this ticket's own status-ledger note on why that's a documented, narrower
    // scope cut, not silently skipped). Applied here, in-memory only, so at least THIS route's own
    // response shape matches Python's -- never persisted by a bare GET, matching apply_maestro_
    // defaults' own "runs on every load, does not need every load to save" contract.
    if (method === 'GET') return sendJson(reply, 200, applyMaestroDefaults(loadSettings().settings));

    if (method === 'PUT') {
      const body = parseJsonObjectBody(request);
      if (body === null) return badRequest(reply, 'body must be a JSON object');
      const next = applySettingsUpdate(coerceSettings(body));
      return sendJson(reply, 200, { ok: true, settings: next });
    }

    if (method === 'PATCH') {
      const changes = parseJsonObjectBody(request);
      if (changes === null) return badRequest(reply, 'body must be a JSON object');
      const current = loadSettings().settings;
      const merged = applySettingsUpdate(coerceSettings({ ...current, ...changes }));
      return sendJson(reply, 200, { ok: true, settings: merged });
    }

    return sendJson(reply, 405, { error: 'method_not_allowed', detail: `${method} not supported on /api/settings` });
  }

  if (sub === '/maestro/token-status' && method === 'GET') {
    return sendJson(reply, 200, maestroTokenStatus(loadSettings().settings));
  }

  if (sub === '/maestro/login/start' && method === 'POST') {
    // Mint the authorize URL + register the pending (state -> code_verifier) entry (keycloakAuth.ts's
    // own header names this exact wiring as "a later ticket's job" -- this is that ticket). Also
    // arms the one-shot loopback listener (loopback.ts) so a callback has somewhere to land when
    // 9Router isn't already holding port 20128 -- nothing in main.ts's boot sequence starts this
    // proactively (a real, verified gap: grepped the whole tree, zero callers of
    // startMaestroLoopbackListener outside its own test file, before this change), so it must be
    // armed per login attempt, right here, or a from-cold-boot sign-in with 9Router down would hang
    // forever on a closed port. Best-effort: a bind failure (something else holds 20128, or
    // 9Router happens to already be up and will proxy it instead per loopback.ts's own case 1)
    // never blocks minting the URL itself.
    void startMaestroLoopbackListener().catch(() => { /* logged inside startMaestroLoopbackListener */ });
    const { authorizeUrl } = startMaestroLogin(MAESTRO_KEYCLOAK_REDIRECT_URI);
    return sendJson(reply, 200, { authorize_url: authorizeUrl });
  }

  if (sub === '/app-theme-override') {
    if (method === 'GET') return sendJson(reply, 200, { mode: loadSettings().settings.app_template_theme_override });
    if (method === 'PUT') {
      const body = parseJsonObjectBody(request);
      const mode = body?.mode;
      if (body === null || (mode !== null && mode !== 'light' && mode !== 'dark' && mode !== undefined)) {
        return badRequest(reply, 'mode must be "light", "dark", or null');
      }
      const current = loadSettings().settings;
      current.app_template_theme_override = (mode as 'light' | 'dark' | null | undefined) ?? null;
      saveSettings(current);
      return sendJson(reply, 200, { ok: true, mode: current.app_template_theme_override });
    }
  }

  if (sub === '/dismiss-mcp-suggestion' && method === 'PUT') {
    const body = parseJsonObjectBody(request);
    const ids = body?.ids;
    if (body === null || !Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      return badRequest(reply, 'ids must be an array of strings');
    }
    const current = loadSettings().settings;
    const now = new Date().toISOString();
    for (const id of ids as string[]) current.dismissed_mcp_suggestions[id] = now;
    saveSettings(current);
    return sendJson(reply, 200, { ok: true, settings: current });
  }

  if (sub === '/default-system-prompt' && method === 'GET') {
    return sendJson(reply, 200, { default_system_prompt: DEFAULT_SYSTEM_PROMPT });
  }

  if (sub === '/reset-system-prompt' && method === 'POST') {
    const current = loadSettings().settings;
    current.default_system_prompt = DEFAULT_SYSTEM_PROMPT;
    saveSettings(current);
    return sendJson(reply, 200, { ok: true, settings: current });
  }

  if (sub === '/reset-to-defaults' && method === 'POST') {
    const old = loadSettings().settings;
    const fresh = coerceSettings({});
    for (const field of RESET_PRESERVE_FIELDS) {
      (fresh as unknown as Record<string, unknown>)[field] = old[field];
    }
    saveSettings(fresh);
    return sendJson(reply, 200, { ok: true, settings: fresh });
  }

  if (sub === '/browse-directories' && method === 'GET') {
    const url = new URL(request.url ?? '/', 'http://internal');
    const result = browseDirectories(url.searchParams.get('path') ?? '');
    if ('status' in result) return sendJson(reply, result.status, { detail: result.detail });
    return sendJson(reply, 200, result);
  }

  if (sub === '/upload-files' && method === 'POST') {
    const contentType = String(request.headers['content-type'] ?? '');
    const parts = parseMultipartFiles(contentType, rawBody(request), 'files');
    const results = parts.map((part) => saveUploadedFile(part.filename, part.data));
    return sendJson(reply, 200, { files: results });
  }

  if (sub === '/summarize-file' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    const path = body?.path;
    if (body === null || typeof path !== 'string' || !path) return badRequest(reply, 'path is required');
    const read = readUploadedFileForSummary(path);
    if (!read.ok) return sendJson(reply, read.status, { detail: read.detail });
    const targetTokens = typeof body.target_tokens === 'number' ? body.target_tokens : 4_000;
    if (Math.floor(read.contents.length / 4) <= Math.max(1, targetTokens)) {
      // Short enough already -- matches settings.py's own early return, no LLM call needed.
      return sendJson(reply, 200, { path, tokens: Math.floor(read.contents.length / 4), size: read.contents.length, summarized: false });
    }
    // Deliberate, named scope cut (same posture as outputs.ts's /vibe-code and dashboards.ts's
    // generate-name): actually compressing an oversize file needs an aux-model LLM call
    // (resolve_aux_model + a chat-completions client through 9Router/the configured provider),
    // which no SUB ticket has wired as a reusable, injectable client yet. Answering honestly with
    // a non-200 here (rather than a fabricated "summarized: true" with the file unchanged) is what
    // lets the frontend's existing summarizeOversize() catch block show its already-written
    // "Could not shrink the file" message instead of silently reporting success on an unshrunk file.
    return sendJson(reply, 501, {
      detail: 'File summarization is not yet available in this build (SUB-10 scope cut: needs aux-model + LLM client wiring, same gap outputs.ts/vibe-code and dashboards.ts/generate-name already document).',
    });
  }

  return sendJson(reply, 405, { error: 'method_not_allowed', detail: `${method} not supported on ${pathname}` });
}
