// engine/src/apps/service/telemetryClient.ts -- ENG-7's port of backend/apps/service/client.py's
// sync()/submit() public surface: the one place operational-state payloads leave the process.
//
// This is the concrete reason engine/src/net/http.ts exists as a chokepoint, not a formality: this
// module makes a REAL outbound HTTP call (to whatever MAESTRO_TELEMETRY_URL is configured to,
// off by default) whenever a frontend UI event or a periodic state sync fires. Every call routes
// through engineFetch(), so a MAESTRO_TELEMETRY_URL pointed at a non-allowlisted host (a
// misconfigured env var, or an attempt to point telemetry at an arbitrary host) fails closed --
// the request never leaves the process -- rather than silently phoning home to whatever the env
// var says. Same off-by-default posture as client.py's p_base_url(): no MAESTRO_TELEMETRY_URL, no
// network calls, full stop.
//
// SCOPED for this ticket: ports the fire-and-forget submit path (sync/submit + best-effort spool
// on failure) and the identity envelope. Does NOT port p_pulse_loop's periodic 9Router
// cost-sampling (backend/apps/service/service.py:61-111) -- that needs ENG-6's 9Router native
// supervision, a sibling ticket in this same phase, and AGT's agent_manager session tracking,
// neither of which this ticket's file list covers. See service.ts's own header for the same gap on
// the read side (usage-summary/cost-breakdown).

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { platform, release } from 'node:os';
import { resolveDataRoot } from '../../auth/token';
import { loadSettings } from '../../settings/store';
import { engineFetch } from '../../net/http';
import * as spool from './spool';
import { APP_VERSION } from './version';

const P_DEFAULT_SYNC_PATH = '/api/service/sync';

export function spoolPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'settings', 'service_spool.jsonl');
}

function baseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = (env.MAESTRO_TELEMETRY_URL ?? '').trim();
  return base ? base.replace(/\/+$/, '') : null;
}

export function telemetryConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return baseUrl(env) !== null;
}

function envelope(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const { settings } = loadSettings(env);
  const out: Record<string, unknown> = { install_id: settings.installation_id ?? 'unknown' };
  if (settings.user_id || settings.user_email) out.user_id = settings.user_id ?? settings.user_email;
  out.os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'Darwin' : 'Linux';
  out.os_version = release();
  out.device_type = 'desktop';
  const timezone = (env.MAESTRO_TIMEZONE ?? '').trim() || settings.timezone;
  if (timezone) out.timezone = timezone;
  const locale = (env.MAESTRO_LOCALE ?? '').trim() || settings.locale;
  if (locale) out.locale = locale;
  out.app_version = APP_VERSION;
  out.install_method = env.MAESTRO_INSTALL_METHOD ?? 'dev';
  return out;
}

// Honours the user opt-out. Mirrors client.py's p_is_enabled -- "diagnostic" always flows;
// "state"/"session"/event payloads honour analytics_opt_in. Engine's settings model (ENG-3) has no
// service_diagnostics_mode field yet (backend's finer-grained "minimal" mode), so this only checks
// analytics_opt_in, which is client.py's own fallback branch when that mode is unset.
function isEnabled(kind: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (kind === 'diagnostic') return true;
  try {
    return loadSettings(env).settings.analytics_opt_in;
  } catch {
    return true;
  }
}

function retryable(status: number | null): boolean {
  return status === null || status >= 500 || status === 408 || status === 429;
}

async function post(path: string, body: unknown, env: NodeJS.ProcessEnv): Promise<number | null> {
  const base = baseUrl(env);
  if (base === null) return null;
  try {
    const res = await engineFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.status;
  } catch {
    // Network failure OR the host failed engineFetch's allowlist check -- either way, this is a
    // best-effort fire-and-forget path (mirrors client.py's p_post catching every exception), so
    // it degrades to "spool and retry later" rather than throwing into the request handler.
    return null;
  }
}

/** Fire-and-forget sync to the configured telemetry endpoint. Never throws. */
export function sync(data: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): void {
  if (!isEnabled('state', env)) return;
  if (!telemetryConfigured(env)) return;
  const body = {
    client_state: envelope(env),
    d: data,
    t: Date.now() / 1000,
    submission_id: randomUUID(),
  };
  void deliverOrSpool(P_DEFAULT_SYNC_PATH, body, env);
}

async function deliverOrSpool(path: string, body: unknown, env: NodeJS.ProcessEnv): Promise<void> {
  const status = await post(path, body, env);
  if (retryable(status)) {
    try { spool.enqueue(spoolPath(env), `s:${path}`, body); } catch { /* best-effort */ }
  }
}

/** Drains up to `batchSize` spooled entries, retrying delivery; acknowledges what succeeds.
 * Returns the number of entries removed from the spool. Never throws. */
export async function drainSpool(batchSize = 50, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const path = spoolPath(env);
  const entries = spool.drain(path, batchSize);
  if (entries.length === 0) return 0;
  const succeeded: number[] = [];
  for (const entry of entries) {
    const sepIdx = entry.kind.indexOf(':');
    const routePath = sepIdx === -1 ? '' : entry.kind.slice(sepIdx + 1);
    if (!routePath) { succeeded.push(entry.id); continue; }
    const status = await post(routePath, entry.payload, env);
    if (status !== null && status >= 200 && status < 300) {
      succeeded.push(entry.id);
    } else if (!retryable(status)) {
      succeeded.push(entry.id); // rejected, not retryable -- drop rather than block the spool forever
    } else {
      break; // still retryable (offline/5xx); stop here, oldest-first order preserved for next drain
    }
  }
  if (succeeded.length) spool.acknowledge(path, succeeded);
  return succeeded.length;
}
