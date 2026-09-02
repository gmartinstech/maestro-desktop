// engine/src/router/sync.ts -- ENG-6, a faithful TypeScript port of
// backend/apps/nine_router/sync.py + backend/apps/nine_router/sync_custom.py (merged into one
// file per this ticket's file list). Mirrors the user's stored Gemini / OpenAI / OpenRouter keys,
// the OpenAI-passthrough lane, and custom OpenAI-compatible providers into 9Router as
// Maestro-managed connections/nodes. Talks to the already-running 9Router over HTTP; never spawns
// the subprocess (that's process.ts's job).

import * as proc from './process';
// ENG-7: every HTTP call this file makes targets 9Router's own loopback port (proc.NINE_ROUTER_*),
// always-allowed by the provider-egress allowlist -- routed through engineFetch like every other
// outbound call in engine/src, mechanical swap, no behavior change.
import { engineFetch } from '../net/http';

// API-key auth (provider="gemini", authType="apikey") and OAuth hit different Google quotas: OAuth uses the Code Assist free tier (aggressively rate-limited; 429s on Gemini 3 Pro/Flash even for paid users), while an AI Studio API key uses generativelanguage.googleapis.com (independent and far higher). We mirror google_api_key into 9Router so the API-key path is preferred when a key is set.
export const NINE_ROUTER_KEYED_NAME = 'AI Studio (Maestro-managed)';
export const NINE_ROUTER_OPENAI_KEYED_NAME = 'OpenAI (Maestro-managed)';
export const NINE_ROUTER_OPENROUTER_KEYED_NAME = 'OpenRouter (Maestro-managed)';

// Reserved prefix that registry.py's gpt-5.*-api router_model_ids depend on. Changing this breaks model resolution for OpenAI own-key users.
export const NINE_ROUTER_OPENAI_KEYED_PREFIX = 'cp-openai';

// We mirror settings.custom_providers[] with prefix `cp-<slug>` so they don't collide with the user's primary OpenAI key.
export const NINE_ROUTER_CUSTOM_NAME_SUFFIX = ' (Maestro-managed)';

const MAESTRO_NAME = 'Maestro';

/** The settings.custom_providers[] wire shape (snake_case, matching the on-disk settings JSON
 * the Python backend/engine settings store persists -- not a TS-idiomatic field-naming choice,
 * a deliberate mirror of the external contract). */
export interface CustomProviderInput {
  name: string;
  base_url: string;
  api_key: string;
}

/** Everything sync.ts's own HTTP calls need, injected so ported tests can supply a fake fetch and
 * fake isRunning()/cliAuthHeaders() the same way test_router_sync_guards.py's FakeNr/FakeAsyncClient
 * stand in for `nr()` and `nr().httpx.AsyncClient` in the Python original. */
export interface RouterHttpDeps {
  isRunning: () => Promise<boolean>;
  cliAuthHeaders: () => Promise<Record<string, string>>;
  fetch: typeof fetch;
}

const defaultDeps: RouterHttpDeps = {
  isRunning: () => proc.isRunning(),
  cliAuthHeaders: () => proc.cliAuthHeaders(),
  fetch: engineFetch,
};

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Return the 9Router connection we manage for this provider, if any. */
export async function findKeyedConnection(provider: string, name: string, deps: RouterHttpDeps = defaultDeps): Promise<Record<string, unknown> | null> {
  try {
    const headers = await deps.cliAuthHeaders();
    const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers`, { headers });
    if (!res.ok) return null;
    const data = await readJson(res);
    const conns = data !== null && typeof data === 'object' ? (data as Record<string, unknown>).connections : null;
    if (!Array.isArray(conns)) return null;
    for (const c of conns) {
      if (
        c !== null &&
        typeof c === 'object' &&
        (c as Record<string, unknown>).provider === provider &&
        (c as Record<string, unknown>).authType === 'apikey' &&
        (c as Record<string, unknown>).name === name
      ) {
        return c as Record<string, unknown>;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Create/update/delete a Maestro-managed apikey connection. Silent if 9Router is down. */
export async function syncApikeyProvider(provider: string, apiKey: string | null | undefined, name: string, label: string, deps: RouterHttpDeps = defaultDeps): Promise<void> {
  if (!(await deps.isRunning())) return;

  const existing = await findKeyedConnection(provider, name, deps);
  try {
    const headers = { ...(await deps.cliAuthHeaders()), 'Content-Type': 'application/json' };
    if (apiKey) {
      const payload = {
        provider,
        authType: 'apikey',
        name,
        apiKey,
        // Priority 0 = highest. OAuth connections default to 1, so keyed connections are preferred when both exist.
        priority: 0,
      };
      if (existing) {
        await deps.fetch(`${proc.NINE_ROUTER_API}/providers/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
        console.info(`9Router: updated ${label} API-key connection`);
      } else {
        const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers`, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (res.status < 300) {
          console.info(`9Router: created ${label} API-key connection`);
        } else {
          console.warn(`9Router: failed to create ${label} API-key connection: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
    } else if (existing) {
      await deps.fetch(`${proc.NINE_ROUTER_API}/providers/${existing.id}`, { method: 'DELETE', headers });
      console.info(`9Router: removed ${label} API-key connection`);
    }
  } catch (e) {
    console.warn(`9Router ${label} API-key sync failed: ${e}`);
  }
}

/** Mirror google_api_key into 9Router; bypasses Code Assist's tight quota. */
export async function syncGeminiApiKey(apiKey: string | null | undefined, deps: RouterHttpDeps = defaultDeps): Promise<void> {
  await syncApikeyProvider('gemini', apiKey, NINE_ROUTER_KEYED_NAME, 'Gemini', deps);
}

/** Mirror openrouter_api_key into 9Router; supplies bearer for openrouter/ routes. */
export async function syncOpenrouterApiKey(apiKey: string | null | undefined, deps: RouterHttpDeps = defaultDeps): Promise<void> {
  await syncApikeyProvider('openrouter', apiKey, NINE_ROUTER_OPENROUTER_KEYED_NAME, 'OpenRouter', deps);
}

/** Create / update / delete the openai-compatible node + connection pair we use to ferry OpenAI
 * requests through openai-passthrough.
 *
 * Why not the built-in `openai` provider type: 9Router 0.3.60 hardcodes
 * `https://api.openai.com/v1` for the `openai` provider and ignores any `baseUrl` field on the
 * connection. Only the `openai-compatible-*` provider-node type honors `baseUrl` (verified
 * statically against 9Router's compiled bundle). So we register our OpenAI lane AS an
 * openai-compatible node; same upstream protocol, different routing.
 *
 * Why we route through openai-passthrough at all: OpenAI's GPT-5 family rejects the legacy
 * `max_tokens` parameter with HTTP 400, but every 9Router version (including 0.4.20) emits
 * `max_tokens` in its Anthropic->OpenAI translator. The passthrough renames it to
 * `max_completion_tokens` for `gpt-5*` models before forwarding to api.openai.com. Pre-fix: every
 * gpt-5.* own-key session 400'd silently.
 *
 * Companion change: the registry entries `gpt-5.*-api` are routed via the `cp-openai/<model>`
 * prefix (NINE_ROUTER_OPENAI_KEYED_PREFIX above) so 9Router's translator dispatches to this
 * provider-node instead of the built-in `openai` provider. */
export async function syncOpenaiCompatNode(apiKey: string | null | undefined, deps: RouterHttpDeps = defaultDeps): Promise<void> {
  if (!(await deps.isRunning())) return;
  const port = process.env.MAESTRO_PORT ?? '8324';
  const baseUrl = `http://127.0.0.1:${port}/api/openai-passthrough/v1`;
  const managedName = `OpenAI${NINE_ROUTER_CUSTOM_NAME_SUFFIX}`;

  let existingNodes: Record<string, unknown>[];
  try {
    const headers = await deps.cliAuthHeaders();
    const res = await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes`, { headers });
    const data = res.ok ? await readJson(res) : null;
    existingNodes = (data !== null && typeof data === 'object' ? (data as Record<string, unknown>).nodes : null) as Record<string, unknown>[] ?? [];
  } catch (e) {
    console.warn(`9Router OpenAI-compat node list failed: ${e}`);
    return;
  }
  const existingNode = existingNodes.find((n) => n.prefix === NINE_ROUTER_OPENAI_KEYED_PREFIX) ?? null;

  if (!apiKey) {
    if (existingNode) {
      try {
        const headers = await deps.cliAuthHeaders();
        await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes/${existingNode.id}`, { method: 'DELETE', headers });
        console.info('9Router: removed OpenAI compat node (key cleared)');
      } catch (e) {
        console.warn(`9Router OpenAI compat delete failed: ${e}`);
      }
    }
    return;
  }

  const nodePayload = {
    name: managedName,
    prefix: NINE_ROUTER_OPENAI_KEYED_PREFIX,
    apiType: 'chat',
    baseUrl,
    type: 'openai-compatible',
  };
  let nodeId: string | undefined = existingNode ? (existingNode.id as string) : undefined;
  try {
    const headers = { ...(await deps.cliAuthHeaders()), 'Content-Type': 'application/json' };
    if (existingNode) {
      await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes/${existingNode.id}`, { method: 'PUT', headers, body: JSON.stringify(nodePayload) });
      console.info(`9Router: updated OpenAI compat node ${NINE_ROUTER_OPENAI_KEYED_PREFIX}`);
    } else {
      const res = await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes`, { method: 'POST', headers, body: JSON.stringify(nodePayload) });
      if (res.status >= 300) {
        console.warn(`9Router: failed to create OpenAI compat node: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return;
      }
      const created = (await readJson(res)) as { node?: { id?: string } } | null;
      nodeId = created?.node?.id;
      if (!nodeId) return;
      console.info(`9Router: created OpenAI compat node ${NINE_ROUTER_OPENAI_KEYED_PREFIX} (${nodeId})`);
    }
  } catch (e) {
    console.warn(`9Router OpenAI compat node sync failed: ${e}`);
    return;
  }

  try {
    const existingConn = await findKeyedConnection(nodeId as string, managedName, deps);
    const connPayload = { provider: nodeId, authType: 'apikey', name: managedName, apiKey, priority: 0 };
    const headers = { ...(await deps.cliAuthHeaders()), 'Content-Type': 'application/json' };
    if (existingConn) {
      const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers/${existingConn.id}`, { method: 'PUT', headers, body: JSON.stringify(connPayload) });
      if (res.status >= 300) {
        console.warn(`9Router: failed to update OpenAI compat connection: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    } else {
      const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers`, { method: 'POST', headers, body: JSON.stringify(connPayload) });
      if (res.status >= 300) {
        console.warn(`9Router: failed to create OpenAI compat connection: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    }
  } catch (e) {
    console.warn(`9Router OpenAI compat connection sync failed: ${e}`);
  }
}

/** Mirror openai_api_key into 9Router as an `openai-compatible` provider node pointed at our
 * local /api/openai-passthrough proxy. See syncOpenaiCompatNode's doc for the full why. */
export async function syncOpenaiApiKey(apiKey: string | null | undefined, deps: RouterHttpDeps = defaultDeps): Promise<void> {
  await syncOpenaiCompatNode(apiKey, deps);
}

/** Slugify a user-supplied custom-provider name for use as a 9Router prefix. Always returns a
 * non-empty alnum-and-dash string. */
export function customProviderSlug(name: string): string {
  const s = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'custom';
}

/** Append `/v1` when the user supplied a host without an API path.
 *
 * 9Router forwards openai-compatible nodes to `<baseUrl>/chat/completions` verbatim. Ollama, LM
 * Studio, llama.cpp, vLLM, and every other OpenAI-compatible server exposes the API under `/v1`,
 * so a user pasting `http://host:11434` (which is what Ollama prints on launch) ends up routed to
 * `/chat/completions` and 404s. Path-bearing URLs are left alone, so `https://api.together.xyz/v1`,
 * `https://openrouter.ai/api/v1`, or anything custom is untouched. */
export function normalizeOpenaiCompatBaseUrl(url: string): string {
  const s = (url ?? '').trim().replace(/\/+$/, '');
  if (!s) return s;
  let path: string;
  try {
    path = new URL(s).pathname;
  } catch {
    return s;
  }
  if (!path || path === '/') return `${s}/v1`;
  return s;
}

/** True when `token` is an unverified JWT whose `exp` claim has already passed. Not a JWT (a
 * static API key) reads as not-expired -- mirrors backend/apps/settings/maestro_token_status.py's
 * `opaque` state, which is deliberately never treated as dead. A narrow, purpose-built port of
 * just the "expired" check that syncCustomProviders needs; the fuller MaestroTokenStatus state
 * machine (missing/expiring/valid, tied to AppSettings) belongs to ENG-3/ENG-4's settings +
 * credential-store work, not this ticket. */
function isExpiredMaestroToken(token: string): boolean {
  const cleaned = (token || '').trim();
  if (!cleaned) return false;
  const parts = cleaned.split('.');
  if (parts.length !== 3) return false;
  try {
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, 'base64url').toString('utf-8')) as Record<string, unknown>;
    const exp = claims.exp;
    if (typeof exp !== 'number') return false;
    return exp - Date.now() / 1000 <= 0;
  } catch {
    return false;
  }
}

/** Mirror settings.custom_providers into 9Router as openai-compatible nodes.
 *
 * Idempotent: existing managed nodes (identified by name suffix) are PUT-updated in place,
 * missing ones are POST-created, and any managed node whose prefix is no longer in `providers` is
 * deleted (which cascades to its connection). Silent no-op when 9Router isn't running. */
export async function syncCustomProviders(providers: CustomProviderInput[], deps: RouterHttpDeps = defaultDeps): Promise<void> {
  if (!(await deps.isRunning())) return;

  let existingNodes: Record<string, unknown>[];
  try {
    const headers = await deps.cliAuthHeaders();
    const res = await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes`, { headers });
    const data = res.ok ? await readJson(res) : null;
    existingNodes = (data !== null && typeof data === 'object' ? (data as Record<string, unknown>).nodes : null) as Record<string, unknown>[] ?? [];
  } catch (e) {
    console.warn(`9Router custom-provider node list failed: ${e}`);
    return;
  }

  const managed = existingNodes.filter((n) => typeof n.name === 'string' && (n.name as string).endsWith(NINE_ROUTER_CUSTOM_NAME_SUFFIX));
  const managedByPrefix = new Map<string, Record<string, unknown>>();
  for (const n of managed) if (n.prefix) managedByPrefix.set(n.prefix as string, n);
  // A prefix is 9Router's routing key, so two nodes sharing one is not a duplicate record but a
  // coin flip over which baseUrl a request gets. Matching only on our own name suffix meant a node
  // left by an OLDER build (a pre-rebrand managed suffix, pointing at plain http://) was invisible
  // here, so we POSTed a second node with the SAME prefix and the stale one kept winning --
  // "[404]: unknown route" on every call. Adopt whatever already holds the prefix instead.
  const allByPrefix = new Map<string, Record<string, unknown>[]>();
  for (const n of existingNodes) {
    if (n.prefix) {
      const list = allByPrefix.get(n.prefix as string) ?? [];
      list.push(n);
      allByPrefix.set(n.prefix as string, list);
    }
  }

  const seenPrefixes = new Set<string>();
  for (const cp of providers ?? []) {
    const name = cp.name ?? '';
    const baseUrl = cp.base_url ?? '';
    let apiKey = cp.api_key ?? '';
    if (!name.trim() || !baseUrl.trim()) continue;
    // Local OpenAI-compat servers (LM Studio, Ollama, etc.) reject a blank Bearer header even with auth disabled. Substitute a placeholder; real auth deployments always have api_key set.
    apiKey = apiKey.trim() || 'no-auth-required';
    // A definitively-expired Maestro JWT is dead weight: handing it to 9Router only gives it a bearer to keep replaying at the gateway (a 401 per model/health poll, against a 10/min failed-auth throttle). Signing in again rewrites the token, which re-diffs custom_providers and re-syncs this node.
    if (name.trim().toLowerCase() === MAESTRO_NAME.toLowerCase() && isExpiredMaestroToken(apiKey)) {
      console.info('9Router: skipping Maestro node (token expired, sign-in needed)');
      continue;
    }
    const slug = customProviderSlug(name);
    const prefix = `cp-${slug}`;
    seenPrefixes.add(prefix);
    const managedName = `${name.trim()}${NINE_ROUTER_CUSTOM_NAME_SUFFIX}`;

    // Prefer our own node, else adopt any other holder of this prefix (the PUT below renames it
    // and corrects its baseUrl, so the stale record becomes the managed one instead of a rival).
    const samePrefix = allByPrefix.get(prefix) ?? [];
    const node = managedByPrefix.get(prefix) ?? samePrefix[0] ?? null;
    const rivals = node ? samePrefix.filter((n) => n.id && n.id !== node.id) : [];
    const nodePayload = {
      name: managedName,
      prefix,
      apiType: 'chat',
      baseUrl: normalizeOpenaiCompatBaseUrl(baseUrl),
      type: 'openai-compatible',
    };
    let nodeId: string | undefined;
    try {
      const headers = { ...(await deps.cliAuthHeaders()), 'Content-Type': 'application/json' };
      if (node) {
        await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes/${node.id}`, { method: 'PUT', headers, body: JSON.stringify(nodePayload) });
        nodeId = node.id as string;
        console.info(`9Router: updated custom node ${prefix}`);
        // Only ever nodes sharing THIS prefix, so the cp-openai node that syncOpenaiCompatNode owns
        // is untouched (reaping it once killed every gpt-* request with "No credentials"). Leaving
        // a rival in place is not cosmetic: the prefix is the routing key, so requests keep landing
        // on whichever one wins.
        for (const rival of rivals) {
          try {
            await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes/${rival.id}`, { method: 'DELETE', headers });
            console.info(`9Router: removed a duplicate node for prefix ${prefix} left by an older build`);
          } catch (e) {
            console.warn(`9Router: could not remove duplicate node for ${prefix}: ${e}`);
          }
        }
      } else {
        const res = await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes`, { method: 'POST', headers, body: JSON.stringify(nodePayload) });
        if (res.status >= 300) {
          console.warn(`9Router: failed to create custom node ${prefix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          continue;
        }
        const created = (await readJson(res)) as { node?: { id?: string } } | null;
        nodeId = created?.node?.id;
        if (!nodeId) continue;
        console.info(`9Router: created custom node ${prefix} (${nodeId})`);
      }
    } catch (e) {
      console.warn(`9Router custom node ${prefix} sync failed: ${e}`);
      continue;
    }

    try {
      const existingConn = await findKeyedConnection(nodeId as string, managedName, deps);
      const connPayload = { provider: nodeId, authType: 'apikey', name: managedName, apiKey, priority: 0 };
      const headers = { ...(await deps.cliAuthHeaders()), 'Content-Type': 'application/json' };
      if (existingConn) {
        // PUT, not PATCH: 9Router answers PATCH /providers/<id> with 405, and this call never
        // checked the status, so a rotated key silently never reached the router. The connection
        // kept whatever bearer it was first created with and every request failed
        // "[401]: jwt expired" once that one aged out -- invisible in the logs.
        const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers/${existingConn.id}`, { method: 'PUT', headers, body: JSON.stringify(connPayload) });
        if (res.status >= 300) {
          console.warn(`9Router: failed to update custom connection ${prefix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      } else {
        const res = await deps.fetch(`${proc.NINE_ROUTER_API}/providers`, { method: 'POST', headers, body: JSON.stringify(connPayload) });
        if (res.status >= 300) {
          console.warn(`9Router: failed to create custom connection ${prefix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.warn(`9Router custom connection ${prefix} sync failed: ${e}`);
    }
  }

  // Drop managed nodes no longer in settings; DELETE cascades to connections.
  // NEVER sweep on an EMPTY list: a corrupt/defaulted settings load at boot would hand us [] and mass-reap every custom connection (the accidental-disconnect class). Cost of the guard: deleting your LAST custom provider leaves one stale node in 9Router, invisible to the picker (models come from settings) and overwritten on the next add.
  if (seenPrefixes.size === 0) {
    const remaining = [...managedByPrefix.keys()].filter((p) => p !== NINE_ROUTER_OPENAI_KEYED_PREFIX);
    if (remaining.length > 0) {
      console.info(`9Router: skipping orphan sweep (empty provider list, ${remaining.length} managed nodes kept)`);
    }
    return;
  }
  for (const [prefix, node] of managedByPrefix) {
    // cp-openai wears the same managed suffix but belongs to syncOpenaiCompatNode; reaping it here killed every gpt-*-api request with "No credentials".
    if (seenPrefixes.has(prefix) || prefix === NINE_ROUTER_OPENAI_KEYED_PREFIX) continue;
    try {
      const headers = await deps.cliAuthHeaders();
      await deps.fetch(`${proc.NINE_ROUTER_API}/provider-nodes/${node.id}`, { method: 'DELETE', headers });
      console.info(`9Router: removed orphaned custom node ${prefix}`);
    } catch (e) {
      console.warn(`9Router custom node ${prefix} delete failed: ${e}`);
    }
  }
}
