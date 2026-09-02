// engine/src/settings/handler.ts -- ENG-3's native handler for the core /api/settings surface
// (GET/PUT/PATCH on the bare path), wired into server.ts ahead of its generic native/proxy
// branch. Every OTHER /api/settings/* subpath (maestro/token-status, maestro/login/start,
// app-theme-override, dismiss-mcp-suggestion, default-system-prompt, reset-*, upload-files,
// summarize-file, browse-directories -- see backend/apps/settings/settings.py) is deliberately
// left unhandled here (returns false, meaning "fall through to proxy"): those depend on 9Router
// sync, OAuth, file I/O, and an LLM client, none of which is this ticket's scope (the settings
// STORE). split.ts's per-name route table can't express "native for this path, proxy for that
// one" on its own -- one name owns its whole /api/<name> tree -- so this handler is the seam that
// makes a single name partially native without turning split.ts into a full path router.
//
// Also NOT ported here (later tickets' job): apply_maestro_defaults' custom_providers/9Router
// reconciliation. A PUT/PATCH through this engine persists exactly what it's given (plus the
// server-owned-field restore below) -- it does not re-derive or sync a Maestro provider entry the
// way Python's apply_settings_update does.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { coerceSettings, type AppSettings } from './models';
import { loadSettings, saveSettings } from './store';

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

// Handles GET/PUT/PATCH on the bare /api/settings path; returns false (reply left untouched) for
// any other path or method so the caller can fall back to proxying at Python.
export async function handleSettingsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (pathname !== '/api/settings') return false;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    reply.code(200).send(loadSettings().settings);
    return true;
  }

  if (method === 'PUT') {
    const body = parseJsonObjectBody(request);
    if (body === null) {
      reply.code(400).send({ error: 'bad_request', detail: 'body must be a JSON object' });
      return true;
    }
    const current = loadSettings().settings;
    const next = coerceSettings(body);
    restoreServerOwnedFields(next, current);
    saveSettings(next);
    reply.code(200).send({ ok: true, settings: next });
    return true;
  }

  if (method === 'PATCH') {
    const changes = parseJsonObjectBody(request);
    if (changes === null) {
      reply.code(400).send({ error: 'bad_request', detail: 'body must be a JSON object' });
      return true;
    }
    const current = loadSettings().settings;
    const merged = coerceSettings({ ...current, ...changes });
    restoreServerOwnedFields(merged, current);
    saveSettings(merged);
    reply.code(200).send({ ok: true, settings: merged });
    return true;
  }

  reply.code(405).send({ error: 'method_not_allowed', detail: `${method} not supported on /api/settings` });
  return true;
}
