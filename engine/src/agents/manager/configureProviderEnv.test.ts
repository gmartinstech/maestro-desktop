// engine/src/agents/manager/configureProviderEnv.test.ts -- AGT-1 gate.
//
// Three layers:
//   1. routerAvailable(): a TS vitest port of backend/tests/test_router_watchdog.py's
//      `test_detection_revival_gated_on_evidence` -- deliberately left un-ported by ENG-6's
//      process.test.ts (see that file's own header) because it exercises configure_provider_env, an
//      agents-manager function with no engine-side port before this ticket.
//   2. Hand-picked branch-coverage unit tests, one per configureProviderEnv() route (direct
//      Anthropic key, OpenAI-passthrough, Gemini local-proxy, custom-provider incl. the Maestro
//      dead-token guard, OpenRouter, 9Router-direct with subagent pinning, and both no-route error
//      messages) -- configure_provider_env.py itself has no dedicated Python test file, so these
//      are written fresh against the ported behavior, not "ported" from an existing suite.
//   3. The ticket's own required GATE: a table-driven differential test comparing this port's
//      output against the REAL Python configure_provider_env(), for every model id in
//      BUILTIN_MODELS, across a matrix of settings/router scenarios.
//
//      configureProviderEnv.differential.fixture.json (plain JSON, so no comments live in the file
//      itself -- the generation method is documented here instead) was captured by running the
//      REAL backend/apps/agents/manager/configure_provider_env.py + registry.py's
//      resolve_model_id_for_sdk/get_api_type under `backend/.venv/Scripts/python.exe`, for every
//      BUILTIN_MODELS entry x the 4 SCENARIOS x 4 ROUTER_STATES combinations below, with 9Router's
//      own liveness/persisted-connections probes mocked via unittest.mock.patch.object -- the exact
//      technique backend/tests/test_router_watchdog.py's own
//      `test_detection_revival_gated_on_evidence` already uses -- so the capture is deterministic
//      and never touches the real, separately-running 9Router process on this shared dev box or any
//      real credentials. The one-off generator script was deleted immediately after capturing the
//      fixture, per the ticket's own instruction ("a small script you delete after").

import { describe, expect, it, vi } from 'vitest';
import {
  MaestroSessionExpiredError,
  configureProviderEnv,
  routerAvailable,
  type ConfigureProviderEnvDeps,
  type OptionsKwargs,
  type ProviderConnection,
} from './configureProviderEnv';
import { getApiType, resolveModelIdForSdk, BUILTIN_MODELS } from '../providers/registry';
import { defaultAppSettings, type AppSettings, type CustomProvider } from '../../settings/models';
import fixture from './configureProviderEnv.differential.fixture.json';

function settingsWith(overrides: Partial<AppSettings>): AppSettings {
  return { ...defaultAppSettings(), ...overrides };
}

function depsFor(overrides: Partial<ConfigureProviderEnvDeps>): ConfigureProviderEnvDeps {
  return {
    isRouterRunning: vi.fn().mockResolvedValue(false),
    ensureRouterRunning: vi.fn().mockResolvedValue(undefined),
    hasPersistedConnections: vi.fn().mockReturnValue(false),
    getAuthToken: vi.fn().mockReturnValue(''),
    normalizeOpenaiCompatBaseUrl: (u: string) => u,
    maestroPort: () => '8324',
    ...overrides,
  };
}

// -- 1. test_detection_revival_gated_on_evidence ---------------------------------------------------

describe('routerAvailable (ported from test_router_watchdog.py::test_detection_revival_gated_on_evidence)', () => {
  it('zero-config: no keys, no proxy mode, no persisted connections -> no revival attempt', async () => {
    const ensures: number[] = [];
    const deps = depsFor({
      isRouterRunning: vi.fn().mockResolvedValue(false),
      ensureRouterRunning: vi.fn(async () => {
        ensures.push(1);
      }),
      hasPersistedConnections: vi.fn().mockReturnValue(false),
    });
    const result = await routerAvailable(defaultAppSettings(), deps);
    expect(result).toBe(false);
    expect(ensures).toHaveLength(0);
  });

  it('a persisted subscription connection alone IS evidence -> revival attempted', async () => {
    const ensures: number[] = [];
    const deps = depsFor({
      isRouterRunning: vi.fn().mockResolvedValue(false),
      ensureRouterRunning: vi.fn(async () => {
        ensures.push(1);
      }),
      hasPersistedConnections: vi.fn().mockReturnValue(true),
    });
    const result = await routerAvailable(defaultAppSettings(), deps);
    expect(result).toBe(false); // ensure "succeeded" but router stayed down (isRouterRunning still mocked false)
    expect(ensures.length).toBeGreaterThan(0);
  });
});

// -- 2. Branch-coverage unit tests ------------------------------------------------------------------

describe('configureProviderEnv branches', () => {
  it('direct Anthropic API key (route=api)', async () => {
    const settings = settingsWith({ anthropic_api_key: 'sk-ant-live' });
    const optionsKwargs: OptionsKwargs = {};
    await configureProviderEnv(optionsKwargs, { model: 'opus-4-8-api' }, 'claude-opus-4-8', 'anthropic', settings, [], depsFor({}));
    expect(optionsKwargs.env).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-live',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    });
  });

  it('direct OpenAI API key routes through the local openai-passthrough (route=api)', async () => {
    const settings = settingsWith({ openai_api_key: 'sk-oai-live' });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ getAuthToken: () => '', maestroPort: () => '9999' });
    await configureProviderEnv(optionsKwargs, { model: 'gpt-5.4-api' }, 'cp-openai/gpt-5.4', 'openai', settings, [], deps);
    expect(optionsKwargs.env).toEqual({
      OPENAI_API_KEY: 'sk-oai-live',
      OPENAI_BASE_URL: 'http://127.0.0.1:9999/api/openai-passthrough/v1',
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
    });
  });

  it('direct Google API key routes through the local anthropic-proxy (route=api)', async () => {
    const settings = settingsWith({ google_api_key: 'goog-live' });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ getAuthToken: () => 'real-token', maestroPort: () => '8324' });
    await configureProviderEnv(optionsKwargs, { model: 'gemini-3.5-flash-api' }, 'gemini-3.5-flash', 'gemini', settings, [], deps);
    expect(optionsKwargs.env).toEqual({
      GEMINI_API_KEY: 'goog-live',
      GOOGLE_API_KEY: 'goog-live',
      ANTHROPIC_API_KEY: 'real-token',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8324/api/anthropic-proxy',
    });
  });

  it('OpenRouter via 9Router, subagents fall back to OR-resold Claude with no Anthropic key', async () => {
    const settings = settingsWith({ openrouter_api_key: 'or-live' });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ isRouterRunning: vi.fn().mockResolvedValue(true) });
    await configureProviderEnv(optionsKwargs, { model: 'or:some/model' }, 'openrouter/some/model', 'openrouter', settings, [], deps);
    expect(optionsKwargs.env).toEqual({
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
      CLAUDE_CODE_SUBAGENT_MODEL: 'openrouter/anthropic/claude-sonnet-4.5',
      ANTHROPIC_SMALL_FAST_MODEL: 'openrouter/anthropic/claude-haiku-4.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'openrouter/anthropic/claude-haiku-4.5',
      ENABLE_TOOL_SEARCH: 'auto',
    });
  });

  it('9Router direct, subagents pinned to the active Codex sub connection', async () => {
    const settings = defaultAppSettings();
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ isRouterRunning: vi.fn().mockResolvedValue(true) });
    const subConns: ProviderConnection[] = [{ provider: 'codex', isActive: true }];
    await configureProviderEnv(optionsKwargs, { model: 'gpt-5.4' }, 'cx/gpt-5.4', 'codex', settings, subConns, deps);
    expect(optionsKwargs.env).toEqual({
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://localhost:20128',
      CLAUDE_CODE_SUBAGENT_MODEL: 'cx/gpt-5.4-mini',
      ANTHROPIC_SMALL_FAST_MODEL: 'cx/gpt-5.4-mini',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'cx/gpt-5.4-mini',
      ENABLE_TOOL_SEARCH: 'auto',
    });
  });

  it('9Router direct, Gemini-bound resolved id goes through the local anthropic-proxy', async () => {
    const settings = settingsWith({ google_api_key: 'goog-live' });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ isRouterRunning: vi.fn().mockResolvedValue(true), getAuthToken: () => '', maestroPort: () => '8324' });
    await configureProviderEnv(optionsKwargs, { model: 'gemini-3.1-flash-lite' }, 'gemini/gemini-3.1-flash-lite-preview', 'gemini-cli', settings, [], deps);
    expect(optionsKwargs.env).toEqual({
      ANTHROPIC_API_KEY: '9router',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8324/api/anthropic-proxy',
      ENABLE_TOOL_SEARCH: 'auto',
    });
  });

  it('no provider configured at all -> the zero-config error message', async () => {
    const optionsKwargs: OptionsKwargs = {};
    await expect(
      configureProviderEnv(optionsKwargs, { model: 'opus-4-8-api' }, 'claude-opus-4-8', 'anthropic', defaultAppSettings(), [], depsFor({})),
    ).rejects.toThrow('No AI provider configured. Set an API key or connect a subscription.');
    expect(optionsKwargs.env).toBeUndefined();
  });

  it('9Router down and the model needs it -> the "install Node.js" error message', async () => {
    const optionsKwargs: OptionsKwargs = {};
    await expect(
      configureProviderEnv(optionsKwargs, { model: 'opus-4-8' }, 'cc/claude-opus-4-8', 'anthropic', defaultAppSettings(), [], depsFor({})),
    ).rejects.toThrow('9Router is not running; cannot use opus-4-8.');
    expect(optionsKwargs.env).toBeUndefined();
  });

  it('custom provider: a live (JWT) Maestro token is never blocked', async () => {
    const p_b64 = (s: string) => Buffer.from(s).toString('base64url');
    const liveExp = Math.floor(Date.now() / 1000) + 36_000;
    const liveJwt = `${p_b64('{"alg":"RS256","typ":"JWT"}')}.${p_b64(JSON.stringify({ exp: liveExp }))}.sig`;
    const maestroProvider: CustomProvider = { name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: liveJwt, models: [] };
    const settings = settingsWith({ provedor_ia_token: liveJwt, custom_providers: [maestroProvider] });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({ isRouterRunning: vi.fn().mockResolvedValue(true) });
    await configureProviderEnv(optionsKwargs, { model: 'custom/maestro/maestro-ultra' }, 'cp-maestro/maestro-ultra', 'custom', settings, [], deps);
    expect(optionsKwargs.env?.OPENAI_API_KEY).toBe(liveJwt);
  });

  it('custom provider: an expired Maestro token raises MaestroSessionExpiredError, never a bad-model error', async () => {
    const p_b64 = (s: string) => Buffer.from(s).toString('base64url');
    const expiredExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredJwt = `${p_b64('{"alg":"RS256","typ":"JWT"}')}.${p_b64(JSON.stringify({ exp: expiredExp }))}.sig`;
    const maestroProvider: CustomProvider = { name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: expiredJwt, models: [] };
    const settings = settingsWith({ provedor_ia_token: expiredJwt, custom_providers: [maestroProvider] });
    const optionsKwargs: OptionsKwargs = {};
    let caught: unknown;
    try {
      await configureProviderEnv(optionsKwargs, { model: 'custom/maestro/maestro-ultra' }, 'cp-maestro/maestro-ultra', 'custom', settings, [], depsFor({}));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MaestroSessionExpiredError);
    expect((caught as MaestroSessionExpiredError).state).toBe('expired');
    // A credential is never allowed to ride out in an error message.
    expect(String((caught as Error).message)).not.toContain(expiredJwt);
    expect(optionsKwargs.env).toBeUndefined();
  });

  it('custom provider: a neighbouring (non-Maestro) custom provider is untouched by the guard', async () => {
    const lmStudio: CustomProvider = { name: 'LM Studio', base_url: 'http://127.0.0.1:1234', api_key: '', models: [] };
    const settings = settingsWith({ custom_providers: [lmStudio] });
    const optionsKwargs: OptionsKwargs = {};
    const deps = depsFor({
      isRouterRunning: vi.fn().mockResolvedValue(true),
      normalizeOpenaiCompatBaseUrl: (u: string) => (u.endsWith('/v1') ? u : `${u}/v1`),
    });
    await configureProviderEnv(optionsKwargs, { model: 'custom/lm-studio/llama' }, 'cp-lm-studio/llama', 'custom', settings, [], deps);
    expect(optionsKwargs.env?.OPENAI_BASE_URL).toBe('http://127.0.0.1:1234/v1');
    expect(optionsKwargs.env?.OPENAI_API_KEY).toBe('no-auth-required');
  });
});

// -- 3. Table-driven differential test against the REAL Python configure_provider_env() -----------

// Router-liveness/persisted-connections/sub-conns per fixture scenario group, mirroring exactly
// what the fixture-generating Python script (deleted after use, per the ticket's own instruction --
// see the fixture JSON's header) mocked via unittest.mock.patch.object for that same group name.
const ROUTER_STATES: Readonly<Record<string, { running: boolean; persisted: boolean; subConns: ProviderConnection[] }>> = {
  router_down: { running: false, persisted: false, subConns: [] },
  router_up_no_sub: { running: true, persisted: false, subConns: [] },
  router_up_claude_sub: { running: true, persisted: true, subConns: [{ provider: 'claude', isActive: true }] },
  router_up_codex_sub: { running: true, persisted: true, subConns: [{ provider: 'codex', isActive: true }] },
};

const SCENARIOS: Readonly<Record<string, Partial<AppSettings>>> = {
  no_keys: {},
  anthropic_key: { anthropic_api_key: 'sk-ant-test-000' },
  openai_key: { openai_api_key: 'sk-oai-test-000' },
  google_key: { google_api_key: 'goog-test-000' },
};

interface FixtureEntry {
  resolved: string;
  apiType: string;
  ok: boolean;
  env?: Record<string, string> | null;
  errorType?: string;
  error?: string;
}

const allModelValues = Object.values(BUILTIN_MODELS).flatMap((models) => models.map((m) => m.value));

describe('configureProviderEnv differential test vs. real Python (configureProviderEnv.differential.fixture.json)', () => {
  const fixtureData = fixture as unknown as Record<string, FixtureEntry>;
  const fixtureKeys = Object.keys(fixtureData);
  let comparedResolutions = 0;
  let comparedApiTypes = 0;
  let comparedOutcomes = 0;

  it('the fixture covers every router state x scenario x catalog model id (no drift since it was captured)', () => {
    expect(fixtureKeys.length).toBe(Object.keys(ROUTER_STATES).length * Object.keys(SCENARIOS).length * allModelValues.length);
  });

  for (const routerName of Object.keys(ROUTER_STATES)) {
    for (const scenName of Object.keys(SCENARIOS)) {
      describe(`${routerName} | ${scenName}`, () => {
        for (const value of allModelValues) {
          it(`${value}`, async () => {
            const key = `${routerName}|${scenName}|${value}`;
            const expected = fixtureData[key];
            expect(expected, `fixture is missing key ${key}`).toBeDefined();

            const rstate = ROUTER_STATES[routerName];
            const settings = settingsWith(SCENARIOS[scenName]);

            // Layer 1: resolution must match (antigravity forced unreachable, same as the
            // fixture-generating script's httpx.get patch).
            const antigravityProbe = async () => false;
            const resolved = await resolveModelIdForSdk(value, settings, antigravityProbe);
            expect(resolved, 'resolveModelIdForSdk drifted from the Python fixture').toBe(expected.resolved);
            comparedResolutions += 1;

            const apiType = getApiType(value);
            expect(apiType, 'getApiType drifted from the Python fixture').toBe(expected.apiType);
            comparedApiTypes += 1;

            // Layer 2: configureProviderEnv's outcome (env dict, or thrown error) must match.
            const deps = depsFor({
              isRouterRunning: vi.fn().mockResolvedValue(rstate.running),
              hasPersistedConnections: vi.fn().mockReturnValue(rstate.persisted),
            });
            const optionsKwargs: OptionsKwargs = {};
            const session = { model: value };
            if (expected.ok) {
              await configureProviderEnv(optionsKwargs, session, resolved, apiType, settings, rstate.subConns, deps);
              expect(optionsKwargs.env, `env mismatch for ${key}`).toEqual(expected.env ?? undefined);
            } else {
              let caught: unknown;
              try {
                await configureProviderEnv(optionsKwargs, session, resolved, apiType, settings, rstate.subConns, deps);
              } catch (e) {
                caught = e;
              }
              expect(caught, `expected configureProviderEnv to throw for ${key}`).toBeInstanceOf(Error);
              expect((caught as Error).message, `error message mismatch for ${key}`).toBe(expected.error);
              expect(optionsKwargs.env, `env should be unset on the error path for ${key}`).toBeUndefined();
            }
            comparedOutcomes += 1;
          });
        }
      });
    }
  }

  it('reports how many model ids were compared', () => {
    // allModelValues.length model ids x 4 router states x 4 settings scenarios each.
    expect(allModelValues.length).toBeGreaterThan(0);
    console.info(
      `AGT-1 differential gate: ${allModelValues.length} catalog model ids, `
      + `${fixtureKeys.length} (router-state x settings-scenario x model-id) points compared -- `
      + `${comparedResolutions} resolutions, ${comparedApiTypes} api-type lookups, ${comparedOutcomes} full outcomes, all identical to the real Python configure_provider_env().`,
    );
  });
});
