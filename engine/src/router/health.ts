// engine/src/router/health.ts -- ENG-6, a faithful TypeScript port of
// backend/apps/nine_router/subscription_health.py: boot-time subscription health probe that
// catches a provider login that died while the app was closed (refresh-token rotation, the
// "Breaking codex" class) so the UI can offer reconnect BEFORE the user burns a failed turn
// discovering it. Probes SUBSCRIPTION lanes only (1 token of sub quota, never a billable API
// key), and only a definitive auth-shaped 401/403 counts as dead: transient 429/5xx/timeouts stay
// silent so the pill can never cry wolf. Kill switch: MAESTRO_BOOT_HEALTH=0.

import * as proc from './process';
// ENG-7: every HTTP call this file makes targets 9Router's own loopback port (proc.NINE_ROUTER_*),
// always-allowed by the provider-egress allowlist -- routed through engineFetch like every other
// outbound call in engine/src, mechanical swap, no behavior change.
import { engineFetch } from '../net/http';

export const PREFIX_BY_PROVIDER: Record<string, string> = {
  claude: 'cc/',
  codex: 'cx/',
  'gemini-cli': 'gemini/',
  antigravity: 'ag/',
};
export const LABEL_BY_PROVIDER: Record<string, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  'gemini-cli': 'Gemini',
  antigravity: 'Gemini (Antigravity)',
};
const AUTH_DEAD_MARKERS = ['authentication', 'expired', 'sign in', 'signing in', 'invalid_grant', 'unauthorized', 'invalid authentication'];
const PROBE_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 300_000;

let probeLock: Promise<void> = Promise.resolve();
let cachedResult: { provider: string; label: string }[] | null = null;
let cachedAt = 0;

export function healthProbeEnabled(): boolean {
  return process.env.MAESTRO_BOOT_HEALTH !== '0';
}

/** Dead ONLY on a definitive auth failure; anything ambiguous reads healthy (silence beats a false reconnect prompt). */
export function classifyAuthDead(statusCode: number, bodyText: string): boolean {
  if (statusCode !== 401 && statusCode !== 403) return false;
  const low = bodyText.toLowerCase();
  return AUTH_DEAD_MARKERS.some((m) => low.includes(m));
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await engineFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pickProbeModel(prefix: string): Promise<string | null> {
  try {
    const res = await engineFetch(`${proc.NINE_ROUTER_URL}/v1/models`);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Record<string, unknown>[] };
    for (const m of data.data ?? []) {
      const id = m.id;
      if (typeof id === 'string' && id.startsWith(prefix)) return id;
    }
  } catch {
    return null;
  }
  return null;
}

/** True = auth dead, False = healthy, null = inconclusive (never reported). */
async function probeOne(model: string): Promise<boolean | null> {
  try {
    const res = await fetchWithTimeout(`${proc.NINE_ROUTER_URL}/v1/messages`, PROBE_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'x-api-key': '9router', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status < 400) return false;
    return classifyAuthDead(res.status, (await res.text().catch(() => '')) ?? '') ? true : null;
  } catch {
    return null;
  }
}

/** Probe each active subscription connection with a 1-token turn; returns [{provider, label}] for
 * the definitively auth-dead ones. Cached for 5 minutes; concurrent callers share one run. */
export async function probeSubscriptionHealth(connections: Record<string, unknown>[]): Promise<{ provider: string; label: string }[]> {
  if (!healthProbeEnabled() || !(await proc.isRunning())) return [];
  const runAfter = probeLock.then(async () => {
    if (cachedResult !== null && performance.now() - cachedAt < CACHE_TTL_MS) return cachedResult;
    const subs = connections.filter((c) => c && typeof c === 'object' && Object.prototype.hasOwnProperty.call(PREFIX_BY_PROVIDER, c.provider as string) && c.isActive === true);
    const dead: { provider: string; label: string }[] = [];
    for (const c of subs) {
      const provider = String(c.provider);
      const model = await pickProbeModel(PREFIX_BY_PROVIDER[provider]);
      if (!model) continue;
      const verdict = await probeOne(model);
      if (verdict === true) {
        dead.push({ provider, label: LABEL_BY_PROVIDER[provider] });
        console.info(`[sub-health] ${provider}: auth dead (reconnect needed)`);
      }
    }
    cachedResult = dead;
    cachedAt = performance.now();
    return dead;
  });
  probeLock = runAfter.then(
    () => undefined,
    () => undefined,
  );
  return runAfter;
}
