// engine/src/agents/manager/configureProviderEnv.ts -- AGT-1, a faithful TypeScript port of
// backend/apps/agents/manager/configure_provider_env.py: configure the SDK environment for the
// run's provider route (set ANTHROPIC/OPENAI/GOOGLE auth env vars -- direct key, Maestro Pro proxy,
// OpenRouter, or 9Router -- and pin subagent models), ensuring 9Router is up where the route needs
// it. subConns is the active-connection list for subagent-model fallback (empty today).
//
// DI-for-testability, matching the pattern engine/src/router/process.ts and engine/src/settings/
// already establish in this codebase: every real I/O dependency (9Router liveness/connections, the
// install auth token, the current wall time) is injectable with a real-implementation default, so
// ported tests can force branches deterministically the same way the Python tests patch module
// attributes with `unittest.mock.patch.object`.
//
// Scope note: this ticket ports registry.py + pricing.py + this file only. guard_maestro_session.py
// itself, error_classify.py, handle_run_error.py, and ws_manager.py are NOT ported here (separate
// concerns, no AGT-1 dependency on them) -- but configure_provider_env.py's custom-provider branch
// DOES call guard_maestro_session() inline, and every dependency THAT check actually needs
// (maestroTokenStatus/needsLogin from settings/tokenStatus.ts, the two Maestro name/slug constants)
// is already ported, so that one check is reproduced faithfully below rather than stubbed out.

import {
  isRunning as routerIsRunning,
  ensureRunning as routerEnsureRunning,
  hasPersistedConnections as routerHasPersistedConnections,
} from '../../router/process';
import { getAuthToken as realGetAuthToken } from '../../auth/token';
import { normalizeOpenaiCompatBaseUrl as realNormalizeOpenaiCompatBaseUrl } from '../../router/sync';
import { maestroTokenStatus, needsLogin } from '../../settings/tokenStatus';
import type { AppSettings } from '../../settings/models';
import {
  CUSTOM_VALUE_PREFIX,
  NINEROUTER_MODEL_PREFIXES,
  findBuiltinModel,
  findCustomProviderForValue,
} from '../providers/registry';

/** The minimal shape configure_provider_env's callers need from an agent session -- just the
 * picked model id. The full AgentSession model (backend/apps/agents/core/models.py) is not ported
 * yet (AGT-2's "WS manager + session models" ticket owns that); this stands in for it so this
 * function's real signature doesn't have to wait on that port. */
export interface AgentSessionLike {
  model: string;
}

/** A provider connection entry, as returned by router/process.ts's getProviders(). */
export interface ProviderConnection {
  provider?: string;
  isActive?: boolean;
}

export type ProviderEnv = Record<string, string>;

/** Mirrors Python's `options_kwargs: Dict` call convention exactly: the caller passes an object,
 * this function mutates its `env` key in place -- kept this way (rather than just returning the
 * env dict) so a future port of AgentLaunch.py, which builds this same options dict up across
 * several steps, can carry the identical calling contract forward unchanged. */
export interface OptionsKwargs {
  env?: ProviderEnv;
  [key: string]: unknown;
}

// backend/apps/settings/maestro.py's two constants, inlined -- same "leaf module, no upward
// dependency" discipline engine/src/settings/models.ts and engine/src/router/sync.ts already
// document for their own local copies of these same two constants.
const MAESTRO_NAME = 'Maestro';
const MAESTRO_SLUG = 'maestro';

/** Raised before the CLI spawns when the selected model routes through Maestro on a dead token.
 * Carries the token STATE only ("expired" / "missing"), never the token, and never any part of
 * it -- mirrors backend/apps/agents/core/MaestroSessionExpiredError.py field-for-field. */
export class MaestroSessionExpiredError extends Error {
  readonly state: string;
  constructor(state: string) {
    // Wording matters: the string reaches logs (and, in the Python original, an error classifier's regex), so it must read as auth, never as a bad model.
    super(`Maestro session is not authenticated (token ${state}); unauthorized until the user signs in again`);
    this.name = 'MaestroSessionExpiredError';
    this.state = state;
  }
}

/** True when a `custom/<slug>/<model>` picker value belongs to the managed Maestro entry. */
function routesThroughMaestro(modelValue: string, settings: AppSettings): boolean {
  const cp = findCustomProviderForValue(settings, modelValue);
  if (cp !== undefined) {
    return (cp.name ?? '').trim().toLowerCase() === MAESTRO_NAME.toLowerCase();
  }
  // A cleared token leaves no entry to match, so fall back to the slug the picker value carries.
  if (!modelValue.startsWith(CUSTOM_VALUE_PREFIX)) return false;
  return modelValue.slice(CUSTOM_VALUE_PREFIX.length).split('/', 1)[0] === MAESTRO_SLUG;
}

/** Raise MaestroSessionExpiredError when this run would go out on a token that cannot work. */
function guardMaestroSession(modelValue: string, settings: AppSettings): void {
  if (!routesThroughMaestro(modelValue, settings)) return;
  const status = maestroTokenStatus(settings);
  // `opaque` (a static API key, not a JWT) is never treated as dead: only the gateway may judge it.
  if (needsLogin(status)) throw new MaestroSessionExpiredError(status.state);
}

/** Dependencies routerAvailable()/configureProviderEnv() need for their real I/O, injected so
 * ported tests can force any branch directly -- the same role Python's tests fill via
 * `patch.object(nine_router, "is_running", ...)` etc. */
export interface ConfigureProviderEnvDeps {
  isRouterRunning: () => Promise<boolean>;
  ensureRouterRunning: () => Promise<void>;
  hasPersistedConnections: () => boolean;
  getAuthToken: () => string;
  normalizeOpenaiCompatBaseUrl: (url: string) => string;
  maestroPort: () => string;
}

export const defaultConfigureProviderEnvDeps: ConfigureProviderEnvDeps = {
  isRouterRunning: () => routerIsRunning(),
  ensureRouterRunning: () => routerEnsureRunning(),
  hasPersistedConnections: () => routerHasPersistedConnections(),
  getAuthToken: () => realGetAuthToken(),
  normalizeOpenaiCompatBaseUrl: realNormalizeOpenaiCompatBaseUrl,
  maestroPort: () => process.env.MAESTRO_PORT ?? '8324',
};

/** True when 9Router is up, reviving it first if it died. A dead router must never masquerade
 * as "no provider configured": detection shares the dispatch path's lazy-start, so a crashed or
 * orphaned router self-heals on the very next send instead of erroring the turn. Revival is
 * gated on EVIDENCE of a provider (a settings key, proxy mode, or an active connection in the
 * router's on-disk db) so a zero-config user keeps the clean no-provider message instead of us
 * booting a router with nothing to route. */
export async function routerAvailable(
  globalSettings: AppSettings,
  deps: ConfigureProviderEnvDeps = defaultConfigureProviderEnvDeps,
): Promise<boolean> {
  if (await deps.isRouterRunning()) return true;
  const evidence = Boolean(
    globalSettings.anthropic_api_key
    || globalSettings.openai_api_key
    || globalSettings.google_api_key
    || globalSettings.openrouter_api_key
    || (globalSettings.custom_providers ?? []).length > 0
    || deps.hasPersistedConnections(),
  );
  if (!evidence) return false;
  console.info('[MCP-DEBUG] 9Router down at provider detection; reviving before concluding');
  await deps.ensureRouterRunning();
  return deps.isRouterRunning();
}

/** Configure the SDK environment for the run's provider route. Mutates `optionsKwargs.env` in
 * place; throws (never returns a value) when no route can be configured. */
export async function configureProviderEnv(
  optionsKwargs: OptionsKwargs,
  session: AgentSessionLike,
  resolvedModel: unknown,
  apiType: string | null,
  globalSettings: AppSettings,
  subConns: readonly ProviderConnection[],
  deps: ConfigureProviderEnvDeps = defaultConfigureProviderEnvDeps,
): Promise<void> {
  const resolvedIsNineRouter = typeof resolvedModel === 'string'
    && NINEROUTER_MODEL_PREFIXES.some((p) => (resolvedModel as string).startsWith(p));

  const modelEntry = findBuiltinModel(session.model, globalSettings);
  const isPinnedApiRoute = modelEntry !== undefined && modelEntry.route === 'api';
  const apiRouteProvider = isPinnedApiRoute ? modelEntry?.api : undefined;

  if (isPinnedApiRoute && apiRouteProvider === 'anthropic' && globalSettings.anthropic_api_key) {
    optionsKwargs.env = {
      ANTHROPIC_API_KEY: globalSettings.anthropic_api_key,
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      // Pin subagents so they don't drift back to the proxy.
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    };
    console.info(`[MCP-DEBUG] Using direct Anthropic API key (route=api) for ${session.model}`);
  } else if (isPinnedApiRoute && apiRouteProvider === 'openai' && globalSettings.openai_api_key) {
    // openai-passthrough renames max_tokens->max_completion_tokens before relaying (GPT-5 400s on max_tokens; 9Router 0.3.60, pinned for WebSearch, emits the legacy field).
    const passthroughUrl = `http://127.0.0.1:${deps.maestroPort()}/api/openai-passthrough/v1`;
    optionsKwargs.env = {
      OPENAI_API_KEY: globalSettings.openai_api_key,
      OPENAI_BASE_URL: passthroughUrl,
      ANTHROPIC_API_KEY: deps.getAuthToken() || '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
    };
    console.info(`[MCP-DEBUG] Using direct OpenAI API key (route=api) for ${session.model} via openai-passthrough`);
  } else if (isPinnedApiRoute && apiRouteProvider === 'custom') {
    // Dead provedor-ia session: fail as auth HERE, before 9Router is even consulted, or the missing node surfaces as "that model may not exist" (see guardMaestroSession for the full chain).
    guardMaestroSession(session.model, globalSettings);
    // User OpenAI-compatible endpoint (Ollama/Together/LM Studio) via 9Router's synced provider node.
    if (!(await deps.isRouterRunning())) {
      console.info('[MCP-DEBUG] custom provider selected but 9Router not running; waiting for startup');
      await deps.ensureRouterRunning();
      if (!(await deps.isRouterRunning())) {
        throw new Error(
          '9Router could not start. Custom OpenAI-compatible '
          + 'providers need 9Router to translate the Anthropic '
          + 'protocol, install Node.js and restart the app.',
        );
      }
    }
    const cp = findCustomProviderForValue(globalSettings, session.model);
    const env: ProviderEnv = {
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
      ENABLE_TOOL_SEARCH: 'auto',
    };
    if (cp) {
      // Local servers often run auth-disabled; placeholder key since the OpenAI SDK requires non-empty.
      env.OPENAI_API_KEY = (cp.api_key ?? '').trim() || 'no-auth-required';
      env.OPENAI_BASE_URL = deps.normalizeOpenaiCompatBaseUrl(cp.base_url ?? '');
    }
    // Pin subagents or CLI's default Haiku 4.5 404s on the custom provider.
    if (globalSettings.anthropic_api_key) {
      env.CLAUDE_CODE_SUBAGENT_MODEL = 'claude-sonnet-4-6';
      env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5-20251001';
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
    } else {
      // No Anthropic key: pin subagents to the custom model so they stay on the user's endpoint.
      const resolvedStr = String(resolvedModel);
      env.CLAUDE_CODE_SUBAGENT_MODEL = resolvedStr;
      env.ANTHROPIC_SMALL_FAST_MODEL = resolvedStr;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = resolvedStr;
    }
    optionsKwargs.env = env;
    console.info(`[MCP-DEBUG] Using custom provider for ${session.model} -> ${String(resolvedModel)}`);
  } else if (isPinnedApiRoute && apiRouteProvider === 'gemini' && globalSettings.google_api_key) {
    // Local anthropic-proxy scrubs JSON-Schema fields Gemini rejects ($schema, additionalProperties, propertyNames, exclusiveMinimum, nested const) that 9Router 0.3.60 misses.
    const proxyUrl = `http://127.0.0.1:${deps.maestroPort()}/api/anthropic-proxy`;
    optionsKwargs.env = {
      GEMINI_API_KEY: globalSettings.google_api_key,
      GOOGLE_API_KEY: globalSettings.google_api_key,
      ANTHROPIC_API_KEY: deps.getAuthToken() || '9router',
      ANTHROPIC_BASE_URL: proxyUrl,
    };
    console.info(`[MCP-DEBUG] Using direct Google API key (route=api) for ${session.model} via local proxy`);
  } else if (apiType === 'openrouter' && globalSettings.openrouter_api_key) {
    // OpenRouter via 9Router; with no Anthropic key/sub, fall back to OR's resold Claude for subagents (incl. WebSearch delegation) so they stay on the same OR billing.
    if (!(await deps.isRouterRunning())) {
      console.info('[MCP-DEBUG] OpenRouter selected but 9Router not running; waiting for startup');
      await deps.ensureRouterRunning();
      if (!(await deps.isRouterRunning())) {
        throw new Error(
          '9Router could not start. OpenRouter routing requires '
          + 'Node.js, install it and restart the app, or pick a '
          + 'model that uses a direct API key (Anthropic, OpenAI, '
          + 'or Google AI Studio).',
        );
      }
    }
    const env: ProviderEnv = {
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
    };
    if (globalSettings.anthropic_api_key) {
      env.CLAUDE_CODE_SUBAGENT_MODEL = 'claude-sonnet-4-6';
      env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5-20251001';
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
    } else {
      env.CLAUDE_CODE_SUBAGENT_MODEL = 'openrouter/anthropic/claude-sonnet-4.5';
      env.ANTHROPIC_SMALL_FAST_MODEL = 'openrouter/anthropic/claude-haiku-4.5';
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'openrouter/anthropic/claude-haiku-4.5';
    }
    env.ENABLE_TOOL_SEARCH = 'auto';
    optionsKwargs.env = env;
    console.info(`[MCP-DEBUG] Using OpenRouter for ${session.model}`);
  } else if (apiType === 'anthropic' && !resolvedIsNineRouter && globalSettings.anthropic_api_key) {
    optionsKwargs.env = { ANTHROPIC_API_KEY: globalSettings.anthropic_api_key };
    console.info('[MCP-DEBUG] Using direct Anthropic API key');
  } else if (await routerAvailable(globalSettings, deps)) {
    // Gemini-bound ids go through the local proxy for schema scrubbing; everything else hits 9Router directly.
    const isGeminiBound = typeof resolvedModel === 'string'
      && (resolvedModel.startsWith('gemini/') || resolvedModel.startsWith('gc/') || resolvedModel.startsWith('ag/'));
    let env: ProviderEnv;
    if (isGeminiBound) {
      const baseUrl = `http://127.0.0.1:${deps.maestroPort()}/api/anthropic-proxy`;
      env = {
        ANTHROPIC_API_KEY: deps.getAuthToken() || '9router',
        ANTHROPIC_BASE_URL: baseUrl,
      };
    } else {
      env = {
        ANTHROPIC_API_KEY: '9router',
        ANTHROPIC_BASE_URL: 'http://localhost:20128',
      };
    }
    // Pin subagents to whichever lane the user has, else CLI's default Haiku 4.5 hits 9Router with no Claude route and 401s. NOTE: callers pass subConns=[] today so this is inert (latent regression from the run/ split; pyright caught the dangling _conns ref in the Python original).
    const active = new Set(subConns.filter((c) => c.isActive).map((c) => c.provider));
    let subModel: string | undefined;
    let smallModel: string | undefined;
    if (globalSettings.anthropic_api_key) {
      subModel = 'claude-sonnet-4-6';
      smallModel = 'claude-haiku-4-5-20251001';
    } else if (active.has('claude') || active.has('anthropic')) {
      subModel = 'cc/claude-sonnet-4-6';
      smallModel = 'cc/claude-haiku-4-5-20251001';
    } else if (active.has('antigravity')) {
      subModel = 'ag/gemini-3-flash';
      smallModel = 'ag/gemini-3-flash';
    } else if (active.has('gemini-cli')) {
      subModel = 'gc/gemini-2.5-flash';
      smallModel = 'gc/gemini-2.5-flash';
    } else if (active.has('codex')) {
      subModel = 'cx/gpt-5.4-mini';
      smallModel = 'cx/gpt-5.4-mini';
    }
    if (subModel) env.CLAUDE_CODE_SUBAGENT_MODEL = subModel;
    if (smallModel) {
      env.ANTHROPIC_SMALL_FAST_MODEL = smallModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = smallModel;
    }
    console.info(`[MCP-DEBUG] 9Router direct, subagent_model=${subModel}, small_fast=${smallModel}`);
    // auto eagerly loads tools when the schema budget fits; without it tengu_defer_all_bn4 defers 16 tools unloadable off Anthropic networks. Don't use --bare (strips system prompt).
    env.ENABLE_TOOL_SEARCH = 'auto';
    optionsKwargs.env = env;
    console.info(`[MCP-DEBUG] Using 9Router (api_type=${apiType})`);
  } else {
    // routerAvailable() above already attempted a revival; reaching here means it truly can't start.
    if (apiType !== 'anthropic' || resolvedIsNineRouter) {
      throw new Error(
        `9Router is not running; cannot use ${session.model}. `
        + 'Install Node.js and restart the app, or switch to a model '
        + 'with a direct API key.',
      );
    }
    throw new Error('No AI provider configured. Set an API key or connect a subscription.');
  }
}
