// engine/src/agents/providers/registry.ts -- AGT-1, a faithful TypeScript port of
// backend/apps/agents/providers/registry.py: the model-resolution gate. Always resolve a model
// through here, never hardcode a model id.
//
// Pricing/tier scoring lives in pricing.ts (ported alongside, same ticket); openrouter.py and
// thinking_params_for.py are NOT ported yet (out of this ticket's scope -- registry.py only
// re-exports their names for external importers' convenience, it doesn't call most of them
// itself). The one thing registry.py's own code actually reads off openrouter.py is the
// `OPENROUTER_VALUE_PREFIX = "or:"` string constant, inlined below with the same value; a real
// openrouter.ts port (fetch_openrouter_models / get_direct_pricing / get_openrouter_pricing /
// invalidate_openrouter_cache) is deferred to whichever later AGT ticket needs it.
//
// This is a 1:1 port, not a rewrite: every comment carried over from registry.py describes a real,
// live routing decision (which 9Router lane a model id rides, why a model was pulled, why the
// OpenAI API-key path detours through our own openai-passthrough) and is preserved here verbatim or
// near-verbatim -- losing these turns a deliberate decision into a mystery bug later.

import { cliAuthHeaders } from '../../router/process';
import { engineFetch } from '../../net/http';

// Inlined from backend/apps/agents/providers/openrouter.py -- see module doc above for why the
// rest of that file isn't ported here.
export const OPENROUTER_VALUE_PREFIX = 'or:';

// Full set of model-id prefixes that force routing through 9Router.
export const NINEROUTER_MODEL_PREFIXES = ['cc/', 'cx/', 'gc/', 'ag/', 'gemini/', 'openrouter/'] as const;

/** A single model-picker entry. Mirrors registry.py's untyped dict shape (`value`, `label`,
 * `context_window`, `model_id`, `router_model_id`, `api`, `subscription_only`, `reasoning`,
 * `route` ("cc"|"api"|"openrouter"|undefined)) field-for-field; kept as a plain interface (not a
 * class) the way the Python original is kept as a plain dict, not a pydantic model -- this is
 * registry data, not a request/response shape. 9Router prefixes: cc/ Claude sub (dashes), cx/
 * Codex sub (dots), gc/ Gemini CLI. */
export interface BuiltinModelEntry {
  value: string;
  label: string;
  context_window: number;
  model_id?: string;
  router_model_id?: string;
  api: string;
  subscription_only?: boolean;
  reasoning?: boolean;
  route?: 'cc' | 'api' | 'openrouter';
}

export const BUILTIN_MODELS: Readonly<Record<string, readonly BuiltinModelEntry[]>> = {
  Anthropic: [
    // Opus 4.8 (released 2026-05-28): Anthropic's flagship, recommended for the most complex work. Adaptive thinking (not extended), effort param defaults to high. 1M ctx, 128k max output, $5/$25. Verified live on the cc sub route (this app runs on it) and the API.
    { value: 'opus-4-8', label: 'Claude Opus 4.8', context_window: 1_000_000,
      model_id: 'claude-opus-4-8', router_model_id: 'cc/claude-opus-4-8', api: 'anthropic', reasoning: true },
    // Opus 4.7: SDK currently strips plaintext thinking deltas (encrypted only) so the live "Thought for Ns" pill loses mid-turn text. Final answer + tokens fine.
    { value: 'opus-4-7', label: 'Claude Opus 4.7', context_window: 1_000_000,
      model_id: 'claude-opus-4-7', router_model_id: 'cc/claude-opus-4-7', api: 'anthropic', reasoning: true },
    // Sonnet 5 (2026-06-30): cheaper near-Opus-4.8 agentic model. cc/ route assumed to pass through like opus-4-8 did; needs a live sub-route check.
    { value: 'sonnet-5', label: 'Claude Sonnet 5', context_window: 1_000_000,
      model_id: 'claude-sonnet-5', router_model_id: 'cc/claude-sonnet-5', api: 'anthropic', reasoning: true },
    { value: 'sonnet', label: 'Claude Sonnet 4.6', context_window: 1_000_000,
      model_id: 'claude-sonnet-4-6', router_model_id: 'cc/claude-sonnet-4-6', api: 'anthropic', reasoning: true },
    { value: 'opus', label: 'Claude Opus 4.6', context_window: 1_000_000,
      model_id: 'claude-opus-4-6', router_model_id: 'cc/claude-opus-4-6', api: 'anthropic', reasoning: true },
    { value: 'haiku', label: 'Claude Haiku 4.5', context_window: 200_000,
      model_id: 'claude-haiku-4-5', router_model_id: 'cc/claude-haiku-4-5-20251001', api: 'anthropic', reasoning: true },
    // cc/ pins the user's Claude sub regardless of connection_mode.
    { value: 'opus-4-8-cc', label: 'Claude Opus 4.8', context_window: 1_000_000,
      model_id: 'claude-opus-4-8', router_model_id: 'cc/claude-opus-4-8', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'opus-4-7-cc', label: 'Claude Opus 4.7', context_window: 1_000_000,
      model_id: 'claude-opus-4-7', router_model_id: 'cc/claude-opus-4-7', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'sonnet-5-cc', label: 'Claude Sonnet 5', context_window: 1_000_000,
      model_id: 'claude-sonnet-5', router_model_id: 'cc/claude-sonnet-5', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'sonnet-cc', label: 'Claude Sonnet 4.6', context_window: 1_000_000,
      model_id: 'claude-sonnet-4-6', router_model_id: 'cc/claude-sonnet-4-6', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'opus-cc', label: 'Claude Opus 4.6', context_window: 1_000_000,
      model_id: 'claude-opus-4-6', router_model_id: 'cc/claude-opus-4-6', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'haiku-cc', label: 'Claude Haiku 4.5', context_window: 200_000,
      model_id: 'claude-haiku-4-5', router_model_id: 'cc/claude-haiku-4-5-20251001', api: 'anthropic', reasoning: true, route: 'cc' },

    // Fable 5 re-added 2026-07-02 after the ban lifted (Eric confirmed access is back); pull both rows again if it errors live.
    { value: 'fable-5-cc', label: 'Claude Fable 5', context_window: 1_000_000,
      model_id: 'claude-fable-5', router_model_id: 'cc/claude-fable-5', api: 'anthropic', reasoning: true, route: 'cc' },
    { value: 'fable-5-api', label: 'Claude Fable 5 (API key)', context_window: 1_000_000,
      model_id: 'claude-fable-5', router_model_id: 'claude-fable-5', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'opus-4-8-api', label: 'Claude Opus 4.8 (API key)', context_window: 1_000_000,
      model_id: 'claude-opus-4-8', router_model_id: 'claude-opus-4-8', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'opus-4-7-api', label: 'Claude Opus 4.7 (API key)', context_window: 1_000_000,
      model_id: 'claude-opus-4-7', router_model_id: 'claude-opus-4-7', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'sonnet-5-api', label: 'Claude Sonnet 5 (API key)', context_window: 1_000_000,
      model_id: 'claude-sonnet-5', router_model_id: 'claude-sonnet-5', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'sonnet-api', label: 'Claude Sonnet 4.6 (API key)', context_window: 1_000_000,
      model_id: 'claude-sonnet-4-6', router_model_id: 'claude-sonnet-4-6', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'opus-api', label: 'Claude Opus 4.6 (API key)', context_window: 1_000_000,
      model_id: 'claude-opus-4-6', router_model_id: 'claude-opus-4-6', api: 'anthropic', reasoning: true, route: 'api' },
    { value: 'haiku-api', label: 'Claude Haiku 4.5 (API key)', context_window: 200_000,
      model_id: 'claude-haiku-4-5', router_model_id: 'claude-haiku-4-5', api: 'anthropic', reasoning: true, route: 'api' },
  ],

  OpenAI: [
    // GPT-5.5 subscription entry PULLED: cx/gpt-5.5 404s on 9Router 0.3.60 (our pin), so a Codex user who picked it (the newest, top OpenAI option) 404'd every turn = "codex is broken". Same treatment as gemini-3.1-pro (no working lane = not offered). The API-key route (gpt-5.5-api below) works; restore a cx entry only after the pin moves and cx/gpt-5.5 resolves.
    { value: 'gpt-5.4', label: 'GPT-5.4',
      context_window: 1_000_000, router_model_id: 'cx/gpt-5.4',
      api: 'codex', subscription_only: true, reasoning: true },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini',
      context_window: 400_000, router_model_id: 'cx/gpt-5.4-mini',
      api: 'codex', subscription_only: true, reasoning: true },
    // gpt-5.3-codex (+ high/xhigh) removed: superseded by GPT-5.5 as OpenAI's recommended Codex model, and high/xhigh were never separate models (just reasoning-effort variants), so they were redundant clutter. API-key entries: route through 9Router's `cp-openai` provider-node (registered by sync_openai_api_key) so 9Router's translator dispatches to our local openai-passthrough proxy. The passthrough renames `max_tokens` -> `max_completion_tokens` before forwarding to api.openai.com, fixing OpenAI's GPT-5 family 400. The bare router_model_id (e.g. "gpt-5.5") still appears in the request body; only the routing prefix changes.
    { value: 'gpt-5.5-api', label: 'GPT-5.5 (API key)',
      context_window: 1_000_000, router_model_id: 'cp-openai/gpt-5.5', model_id: 'gpt-5.5',
      api: 'openai', reasoning: true, route: 'api' },
    { value: 'gpt-5.4-api', label: 'GPT-5.4 (API key)',
      context_window: 1_000_000, router_model_id: 'cp-openai/gpt-5.4', model_id: 'gpt-5.4',
      api: 'openai', reasoning: true, route: 'api' },
    { value: 'gpt-5.4-mini-api', label: 'GPT-5.4 Mini (API key)',
      context_window: 400_000, router_model_id: 'cp-openai/gpt-5.4-mini', model_id: 'gpt-5.4-mini',
      api: 'openai', reasoning: true, route: 'api' },
  ],
  // Google: Gemini 3.x thoughtSignature continuity is bypassed via 9Router's skip_thought_signature_validator (model can't build on prior reasoning, but tools and thinking work). 3-pro / 3-flash route via Antigravity when the AG OAuth lane is active; gc/ otherwise.
  Google: [
    // Gemini 3.5 Flash (GA 2026-05-19) is offered on the API-key route ONLY (see the api entry below). Its gc/ subscription entry was pulled because the pinned 9Router 0.3.60 registry has no gemini-3.5-flash and the gc/ route allowlists (every other shipped Gemini sub model IS in 0.3.60), so gc/ gemini-3.5-flash would 404. Re-add the gc/ entry once 9Router is bumped past 0.3.60 (gated by the WebSearch-translation regression; see CLAUDE.md). gemini-3.1-pro pulled (both sub + api-key rows): Antigravity can't serve it (its -high variant 400s) and the AI Studio key 429s pro-preview hard, so it had no working lane and only sold a dead option.
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite',
      context_window: 1_000_000, router_model_id: 'gc/gemini-3.1-flash-lite-preview',
      api: 'gemini-cli', subscription_only: true, reasoning: true },
    // gemini-3-pro removed 2026-03-09 and gemini-3-flash removed 2026-07-03: gemini-3-flash-preview aged out upstream (API-key route hangs with no fail-fast; only an Antigravity sub still masked it). 3.5-flash / 3.1-flash-lite cover the slots.
    // API-key entries: bypass 9Router, call generativelanguage.googleapis.com.
    { value: 'gemini-3.5-flash-api', label: 'Gemini 3.5 Flash (API key)',
      context_window: 1_000_000, router_model_id: 'gemini-3.5-flash', model_id: 'gemini-3.5-flash',
      api: 'gemini', reasoning: true, route: 'api' },
    { value: 'gemini-3.1-flash-lite-api', label: 'Gemini 3.1 Flash Lite (API key)',
      context_window: 1_000_000, router_model_id: 'gemini-3.1-flash-lite-preview', model_id: 'gemini-3.1-flash-lite-preview',
      api: 'gemini', reasoning: true, route: 'api' },
  ],
};

// --------------------------------------------------------------------------- Model resolution (used by the live claude_agent_sdk path) ---------------------------------------------------------------------------

export const CUSTOM_VALUE_PREFIX = 'custom/';

/** Mirror nine_router._custom_provider_slug; duplicated here to avoid importing from
 * router/sync.ts (circular: sync.ts imports from settings, same reason the Python original gives
 * for not importing nine_router). */
export function customProviderSlugForLookup(name: string): string {
  const s = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'custom';
}

/** Minimal settings shape find_custom_provider_for_value / find_builtin_model / get_context_window
 * need -- deliberately not the full AppSettings so this module doesn't have to wait on a settings
 * port; any object with a `custom_providers` array (the real engine/src/settings/models.ts
 * AppSettings included) satisfies this. */
// `models` rows are kept as loosely-typed records (matching engine/src/settings/models.ts's own
// `Record<string, unknown>[]` for the equivalent AppSettings field, so a real AppSettings value is
// structurally assignable here without a cast) -- read through with the small helper below rather
// than a narrower inline shape.
export interface CustomProviderLike {
  name?: string;
  api_key?: string;
  base_url?: string;
  models?: readonly Record<string, unknown>[];
}
function modelRowField(row: Record<string, unknown>, key: 'value' | 'id'): string | undefined {
  const v = row[key];
  return typeof v === 'string' ? v : undefined;
}
export interface SettingsWithCustomProviders {
  custom_providers?: readonly CustomProviderLike[];
  anthropic_api_key?: string | null;
  openai_api_key?: string | null;
  google_api_key?: string | null;
}

/** Look up the CustomProvider whose slug matches the slug encoded in a
 * `custom/<slug>/<model_id>` picker value. Returns undefined if no match. */
export function findCustomProviderForValue(
  settings: SettingsWithCustomProviders | undefined,
  value: string,
): CustomProviderLike | undefined {
  if (typeof value !== 'string' || !value.startsWith(CUSTOM_VALUE_PREFIX)) return undefined;
  const rest = value.slice(CUSTOM_VALUE_PREFIX.length);
  const slug = rest.split('/', 1)[0];
  if (!slug) return undefined;
  for (const cp of settings?.custom_providers ?? []) {
    if (customProviderSlugForLookup(cp.name ?? '') === slug) return cp;
  }
  return undefined;
}

/** Look up a model entry by its short `value`.
 *
 * OpenRouter entries (prefixed `or:<vendor>/<model>`) and custom-provider
 * entries (prefixed `custom/<slug>/<model_id>`) aren't in BUILTIN_MODELS,
 * they're synthesised on demand so the rest of the routing code can treat
 * them like BUILTIN_MODELS entries. `settings`, when passed, resolves the
 * real `reasoning` flag for a custom-provider entry off its `cp.models` row;
 * without it (every call site but list_models) reasoning stays false, matching
 * prior behavior. */
export function findBuiltinModel(shortName: string, settings?: SettingsWithCustomProviders): BuiltinModelEntry | undefined {
  for (const models of Object.values(BUILTIN_MODELS)) {
    for (const m of models) {
      if (m.value === shortName) return m;
    }
  }
  if (typeof shortName === 'string' && shortName.startsWith(OPENROUTER_VALUE_PREFIX)) {
    const bare = shortName.slice(OPENROUTER_VALUE_PREFIX.length);
    if (bare) {
      return {
        value: shortName,
        label: bare,
        context_window: 128_000,
        model_id: bare,
        router_model_id: `openrouter/${bare}`,
        api: 'openrouter',
        route: 'openrouter',
        reasoning: false,
      };
    }
  }
  if (typeof shortName === 'string' && shortName.startsWith(CUSTOM_VALUE_PREFIX)) {
    const rest = shortName.slice(CUSTOM_VALUE_PREFIX.length);
    const slashIdx = rest.indexOf('/');
    const slug = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const bareModel = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
    if (slug && bareModel) {
      // Routing string `cp-<slug>/<model>` matches the prefix we use when sync_custom_providers registers the provider node.
      const routed = `cp-${slug}/${bareModel}`;
      let reasoning = false;
      for (const cp of settings?.custom_providers ?? []) {
        if (customProviderSlugForLookup(cp.name ?? '') !== slug) continue;
        for (const m of cp.models ?? []) {
          if (modelRowField(m, 'value') === bareModel || modelRowField(m, 'id') === bareModel) {
            reasoning = Boolean(m.reasoning ?? false);
            break;
          }
        }
        break;
      }
      return {
        value: shortName,
        label: bareModel,
        context_window: 128_000,
        model_id: routed,
        router_model_id: routed,
        api: 'custom',
        route: 'api',
        reasoning,
      };
    }
  }
  return undefined;
}

export function getApiType(shortName: string): string {
  return findBuiltinModel(shortName)?.api ?? 'anthropic';
}

/** Dependencies antigravityConnected() needs for its one real I/O step, injected so ported tests
 * can force the outcome directly without a real network call -- same role IsRunningDeps plays in
 * router/process.ts. */
export interface AntigravityProbeDeps {
  fetchProviders: () => Promise<Response>;
}
function defaultFetchProviders(): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  return cliAuthHeaders()
    .then((headers) => engineFetch('http://localhost:20128/api/providers', { headers, signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}
const defaultAntigravityProbeDeps: AntigravityProbeDeps = { fetchProviders: defaultFetchProviders };

// Short TTL cache for antigravityConnected(): the underlying probe can take up to 2s to answer
// (this resolver is itself called eagerly at the top of every Gemini turn), so caching avoids
// re-paying that cost on every turn of a multi-turn session; TTL is short enough that a user
// connecting/disconnecting Antigravity mid-session is picked up quickly. Exported (not module-
// private) the same way antigravity_last_checked/antigravity_last_result are public (not
// p_-prefixed) in the Python original: the test suite reads/writes this cache state directly to
// exercise real TTL hit/expiry behavior.
export const ANTIGRAVITY_CHECK_TTL_MS = 5000;
export const antigravityCache = {
  // -Infinity, not 0: performance.now() is milliseconds since the CURRENT process started, so
  // early in a process's life (including the first ~10s of every test worker) a literal `0`
  // sentinel would collide with a real, very-small `now` and be misread as "checked just now" --
  // exactly the footgun engine/src/router/process.ts's routerState.isRunningLastOk/LastChecked
  // already document and guard against the same way. Python's time.monotonic() sentinel of 0.0
  // doesn't have this problem in practice.
  lastCheckedMs: -Infinity,
  lastResult: false,
};

function monotonicMs(): number {
  return performance.now();
}

/** True if a live Antigravity OAuth lane exists in 9Router. Any hiccup (including a timeout)
 * reads as 'no' so a slow/absent 9Router never blocks model resolution for long, and repeated
 * calls within the TTL window don't re-pay the network round-trip on every turn of a session. */
export async function antigravityConnected(deps: AntigravityProbeDeps = defaultAntigravityProbeDeps): Promise<boolean> {
  const now = monotonicMs();
  if (now - antigravityCache.lastCheckedMs < ANTIGRAVITY_CHECK_TTL_MS) return antigravityCache.lastResult;
  try {
    const res = await deps.fetchProviders();
    antigravityCache.lastCheckedMs = now;
    if (!res.ok) {
      antigravityCache.lastResult = false;
      return false;
    }
    const data = (await res.json()) as unknown;
    const conns: unknown[] = Array.isArray(data)
      ? data
      : (data !== null && typeof data === 'object' && Array.isArray((data as { connections?: unknown }).connections))
        ? ((data as { connections: unknown[] }).connections)
        : [];
    antigravityCache.lastResult = conns.some(
      (c) => c !== null && typeof c === 'object'
        && (c as Record<string, unknown>).provider === 'antigravity'
        && (c as Record<string, unknown>).isActive === true,
    );
    return antigravityCache.lastResult;
  } catch {
    antigravityCache.lastCheckedMs = now;
    antigravityCache.lastResult = false;
    return false;
  }
}

/** Short model name -> id string for the SDK's model option.
 *
 * Python's original is a fully synchronous function (its one I/O call, antigravity_connected(),
 * blocks the thread with a synchronous httpx.get). Node has no synchronous HTTP client, so this
 * port is `async` throughout -- its only behavioral difference from the Python original: callers
 * must `await` it. */
export async function resolveModelIdForSdk(
  shortName: string,
  settings: SettingsWithCustomProviders,
  antigravityConnectedFn: () => Promise<boolean> = antigravityConnected,
): Promise<string> {
  const entry = findBuiltinModel(shortName, settings);
  if (entry === undefined) return shortName;
  if (entry.route === 'cc') return entry.router_model_id ?? entry.model_id ?? shortName;
  if (entry.route === 'api') {
    // OpenAI own-key still rides 9Router (the cp-openai node fixes max_tokens + translates Anthropic->OpenAI), so it MUST keep its cp-openai/ routing prefix or 9Router has no node to dispatch to. Anthropic own-key goes straight to api.anthropic.com and Gemini own-key via the local proxy, both on the bare id.
    if (entry.api === 'openai') return entry.router_model_id ?? entry.model_id ?? shortName;
    return entry.model_id ?? shortName;
  }
  if (entry.route === 'openrouter') return entry.router_model_id ?? shortName;
  if (entry.api === 'anthropic') {
    if (settings.anthropic_api_key) return entry.model_id ?? shortName;
  }
  // Gemini lane order: Antigravity OAuth (for the models it serves), then AI Studio apikey, then Gemini CLI. AG bypasses the thoughtSignature validator that breaks multi-step Gemini turns AND supports real reasoning, so a connected AG sub is preferred over the AI Studio key, which otherwise silently shadowed it. The map is AG's allowlist; pro variants 404/400 on AG and are deliberately absent, so they fall through to the key.
  const ANTIGRAVITY_MAP: Readonly<Record<string, string>> = {
    // gemini-3-pro-preview disabled: AG returns 404 even with active conn. gemini-3.1-pro-preview disabled: AG's `gemini-3.1-pro-high` variant 400s every request with "invalid argument" (the `-high` thinking- budget alias on AG requires a thinking_config the CLI doesn't emit). Falls through to the AI Studio key / gc/ instead. gemini-3-flash-preview key dropped with its registry entry (aged out upstream).
    'gemini-3.1-flash-lite-preview': 'gemini-3-flash',
  };
  if (entry.api === 'gemini-cli') {
    const rid = entry.router_model_id ?? '';
    if (rid.startsWith('gc/')) {
      const suffix = rid.slice('gc/'.length);
      const agSuffix = ANTIGRAVITY_MAP[suffix];
      if (agSuffix && (await antigravityConnectedFn())) return 'ag/' + agSuffix;
      if (settings.google_api_key) return 'gemini/' + suffix;
    }
  }
  return entry.router_model_id ?? entry.model_id ?? shortName;
}

/** Dependencies resolveAuxModel() needs for its 9Router liveness/connections checks, injected for
 * testability. Defaults call the real ported process.ts functions -- same real network I/O the
 * Python original performs. */
export interface ResolveAuxModelDeps {
  isRouterRunning: () => Promise<boolean>;
  getProviders: () => Promise<Record<string, unknown>[]>;
}

/** Pick the cheapest reachable model for one-shot aux LLM calls.
 *
 * primaryApi lets the caller stay on the family the user is already
 * paying for (Codex chat -> Codex aux, OR chat -> OR aux, etc.).
 * Returns [modelId, baseUrl]; baseUrl=null means default Anthropic. */
export async function resolveAuxModel(
  settings: SettingsWithCustomProviders & { openai_api_key?: string | null; openrouter_api_key?: string | null },
  preferredTier: 'haiku' | 'sonnet' = 'haiku',
  primaryApi: string | null = null,
  deps: ResolveAuxModelDeps,
): Promise<[string, string | null]> {
  // Must track the canonical Anthropic entries in BUILTIN_MODELS (sonnet/haiku); a stale id here 404s every aux call (sonnet was pinned to the long-dead 4.0 "20250514" and silently broke).
  const haikuBare = 'claude-haiku-4-5-20251001';
  const sonnetBare = 'claude-sonnet-4-6';
  const orHaiku = 'openrouter/anthropic/claude-haiku-4.5';
  const orSonnet = 'openrouter/anthropic/claude-sonnet-4.5';
  const bare = preferredTier === 'haiku' ? haikuBare : sonnetBare;
  const orAux = preferredTier === 'haiku' ? orHaiku : orSonnet;

  const baseUrl = 'http://localhost:20128';
  let connected = new Set<string>();
  if (await deps.isRouterRunning()) {
    try {
      const connections = await deps.getProviders();
      connected = new Set(
        connections.filter((c) => c.isActive === true).map((c) => c.provider as string),
      );
    } catch {
      connected = new Set();
    }
  }

  if (primaryApi === 'codex') {
    if (connected.has('codex')) return ['cx/gpt-5.4-mini', baseUrl];
    if (settings.openai_api_key) return ['gpt-5.4-mini', 'https://api.openai.com/v1'];
  } else if (primaryApi === 'gemini-cli' || primaryApi === 'gemini') {
    if (connected.has('gemini-cli')) return ['gc/gemini-3.1-flash-lite-preview', baseUrl];
    if (settings.google_api_key) return ['gemini-3.1-flash-lite-preview', 'https://generativelanguage.googleapis.com/v1beta'];
  } else if (primaryApi === 'openrouter') {
    if (connected.has('openrouter')) return [orAux, baseUrl];
  }

  if (settings.anthropic_api_key) return [bare, null];

  if (!(await deps.isRouterRunning())) {
    throw new Error(
      'No AI provider configured for auxiliary LLM call. '
      + 'Set an Anthropic API key or connect a subscription.',
    );
  }

  if (connected.has('claude')) return [preferredTier === 'haiku' ? `cc/${haikuBare}` : `cc/${sonnetBare}`, baseUrl];
  if (connected.has('codex')) return ['cx/gpt-5.4-mini', baseUrl];
  if (connected.has('gemini-cli')) return ['gc/gemini-3.1-flash-lite-preview', baseUrl];
  // OR is metered, hence last; saves OR-only users from "Untitled session" hell.
  if (connected.has('openrouter')) return [orAux, baseUrl];

  throw new Error(
    'No AI provider connected for auxiliary LLM call. '
    + 'Connect at least one subscription in Settings.',
  );
}

/** Look up context window for any model. */
export function getContextWindow(_provider: string, model: string, settings?: SettingsWithCustomProviders): number {
  // Check built-in models first
  for (const models of Object.values(BUILTIN_MODELS)) {
    for (const m of models) {
      if (m.value === model) return m.context_window ?? 128_000;
    }
  }

  // Check custom providers; picker values are `custom/<slug>/<bare_model>`; cp.models[].value stores the bare model id the user typed. Match the bare-model tail against any custom provider's models list.
  if (settings) {
    let bareModel = model;
    if (typeof model === 'string' && model.startsWith(CUSTOM_VALUE_PREFIX)) {
      const rest = model.slice(CUSTOM_VALUE_PREFIX.length);
      const slashIdx = rest.indexOf('/');
      bareModel = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
    }
    for (const cp of settings.custom_providers ?? []) {
      for (const m of cp.models ?? []) {
        if (modelRowField(m, 'value') === bareModel || modelRowField(m, 'id') === bareModel) {
          const cw = m.context_window;
          if (typeof cw === 'number' && cw > 0) return cw;
        }
      }
    }
  }

  return 128_000; // safe default
}

// --------------------------------------------------------------------------- Cost tracking ---------------------------------------------------------------------------

// Python keys this dict by a (provider, model) TUPLE; TS has no tuple-keyed object literal, and a
// composite "provider/model" string key would be ambiguous here (several model ids -- e.g.
// "x-ai/grok-4-0214" -- already contain "/"), so this is nested provider -> model -> [input, output]
// instead. Same data, a collision-safe key shape. [input_cost_per_1M, output_cost_per_1M] NOTE:
// real cost numbers come from 9Router's usage stats. These entries are kept so the table matches
// BUILTIN_MODELS and can be used by any future native-loop path. Subscription-routed models are
// zero-cost to the user, but API rates are recorded here for reference where they exist. Anthropic
// (direct API rates).
export const COST_PER_1M_TOKENS: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  Anthropic: {
    sonnet: [3.0, 15.0],
    'sonnet-5': [3.0, 15.0],
    opus: [5.0, 25.0],
    'opus-4-7': [5.0, 25.0],
    'opus-4-8': [5.0, 25.0],
    'fable-5-api': [10.0, 50.0],
    haiku: [1.0, 5.0],
  },
  // OpenAI; Codex subscription path, user pays nothing per token
  OpenAI: {
    'gpt-5.5': [0.0, 0.0],
    'gpt-5.4': [0.0, 0.0],
    'gpt-5.4-mini': [0.0, 0.0],
  },
  // Google; Gemini CLI subscription path, user pays nothing per token
  Google: {
    'gemini-3.5-flash': [0.0, 0.0],
    'gemini-3.1-flash-lite': [0.0, 0.0],
    'gemini-3-flash': [0.0, 0.0],
    'gemini-2.5-pro': [0.0, 0.0],
    'gemini-2.5-flash': [0.0, 0.0],
  },
  // OpenRouter-backed (approximate)
  xAI: { 'x-ai/grok-4-0214': [3.0, 15.0] },
  Meta: {
    'meta-llama/llama-4-maverick': [0.50, 0.70],
    'meta-llama/llama-4-scout': [0.15, 0.40],
  },
  DeepSeek: {
    'deepseek/deepseek-chat-v3-0324': [0.30, 0.90],
    'deepseek/deepseek-r1': [0.80, 2.40],
  },
  Mistral: {
    'mistralai/mistral-large-2501': [2.0, 6.0],
    'mistralai/mistral-small-3.1-24b-instruct': [0.10, 0.30],
  },
  Qwen: {
    'qwen/qwen3-coder': [0.0, 0.0],
    'qwen/qwen3-235b-a22b': [0.20, 0.70],
  },
  Cohere: { 'cohere/command-a-03-2025': [2.50, 10.0] },
};
