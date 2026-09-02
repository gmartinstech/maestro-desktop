import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defaultAppSettings, MAESTRO_DEFAULT_MODEL, FALLBACK_DEFAULT_MODEL } from './models';
import { applyMaestroDefaults, maestroProvider, provedorIaToken, MAESTRO_DEFAULT_PROXY_URL } from './applyMaestroDefaults';
import { forgetCatalog, rememberCatalog } from './maestroCatalog';

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.PROVEDOR_IA_TOKEN;
  delete process.env.PROVEDOR_IA_TOKEN;
  forgetCatalog();
});
afterEach(() => {
  if (savedEnv !== undefined) process.env.PROVEDOR_IA_TOKEN = savedEnv;
  else delete process.env.PROVEDOR_IA_TOKEN;
  forgetCatalog();
});

describe('provedorIaToken', () => {
  test('the settings field wins over the env var', () => {
    process.env.PROVEDOR_IA_TOKEN = 'mtok_env';
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'mtok_field' };
    expect(provedorIaToken(settings)).toBe('mtok_field');
  });

  test('falls back to the env var when the field is empty', () => {
    process.env.PROVEDOR_IA_TOKEN = 'mtok_env';
    expect(provedorIaToken(defaultAppSettings())).toBe('mtok_env');
  });

  test('null when neither is set', () => {
    expect(provedorIaToken(defaultAppSettings())).toBeNull();
  });

  test('a JWT-shaped env value is refused (old vendor-installer contract), a static opaque key is not', () => {
    process.env.PROVEDOR_IA_TOKEN = 'header.payload.signature';
    expect(provedorIaToken(defaultAppSettings())).toBeNull();
    process.env.PROVEDOR_IA_TOKEN = 'mtok_opaque_key';
    expect(provedorIaToken(defaultAppSettings())).toBe('mtok_opaque_key');
  });

  test('a JWT-shaped value IN THE FIELD (not the env) is not specially refused here -- that one-time migration is migrations.ts/store.ts\'s job', () => {
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'a.b.c' };
    expect(provedorIaToken(settings)).toBe('a.b.c');
  });
});

describe('maestroProvider', () => {
  test('uses the shipped MAESTRO_MODELS fallback when no catalog was ever fetched', () => {
    const provider = maestroProvider('mtok_x');
    expect(provider).toMatchObject({ name: 'Maestro', base_url: MAESTRO_DEFAULT_PROXY_URL, api_key: 'mtok_x' });
    expect(provider.models.length).toBeGreaterThan(0);
  });

  test('prefers a fresh cached catalog over the shipped constant', () => {
    rememberCatalog([{ value: 'only-model', label: 'Only Model', context_window: 1, max_completion_tokens: 1, reasoning: true }]);
    const provider = maestroProvider('mtok_x');
    expect(provider.models).toEqual([{ value: 'only-model', label: 'Only Model', context_window: 1, max_completion_tokens: 1, reasoning: true }]);
  });
});

describe('applyMaestroDefaults', () => {
  test('no token, no existing entry: default_model demotes off the unreachable Maestro id', () => {
    const settings = defaultAppSettings();
    expect(settings.default_model).toBe(MAESTRO_DEFAULT_MODEL);
    const result = applyMaestroDefaults(settings);
    expect(result.default_model).toBe(FALLBACK_DEFAULT_MODEL);
    expect(result.custom_providers).toEqual([]);
  });

  test('no token, but default_model was already changed to something else: left alone', () => {
    const settings = { ...defaultAppSettings(), default_model: 'sonnet' };
    const result = applyMaestroDefaults(settings);
    expect(result.default_model).toBe('sonnet');
  });

  test('a token inserts the Maestro entry FIRST in custom_providers, heading the picker', () => {
    const settings = {
      ...defaultAppSettings(),
      provedor_ia_token: 'mtok_x',
      custom_providers: [{ name: 'SomeOther', base_url: 'https://x.example', api_key: 'k', models: [] }],
    };
    const result = applyMaestroDefaults(settings);
    expect(result.custom_providers[0].name).toBe('Maestro');
    expect(result.custom_providers[1].name).toBe('SomeOther');
  });

  test('idempotent: running it twice never duplicates the entry', () => {
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'mtok_x' };
    applyMaestroDefaults(settings);
    applyMaestroDefaults(settings);
    expect(settings.custom_providers.filter((p) => p.name === 'Maestro')).toHaveLength(1);
  });

  test('a token rotation re-derives (replaces in place) the existing managed entry', () => {
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'mtok_old' };
    applyMaestroDefaults(settings);
    settings.provedor_ia_token = 'mtok_new';
    applyMaestroDefaults(settings);
    expect(settings.custom_providers).toHaveLength(1);
    expect(settings.custom_providers[0].api_key).toBe('mtok_new');
  });

  test('a token going away never deletes the existing entry (no silent disconnect)', () => {
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'mtok_x' };
    applyMaestroDefaults(settings);
    settings.provedor_ia_token = '';
    applyMaestroDefaults(settings);
    expect(settings.custom_providers.some((p) => p.name === 'Maestro')).toBe(true);
  });

  test('matching an existing managed entry by name is case-insensitive (mirrors the Python original)', () => {
    const settings = {
      ...defaultAppSettings(),
      provedor_ia_token: 'mtok_x',
      custom_providers: [{ name: 'MAESTRO', base_url: 'stale', api_key: 'stale', models: [] }],
    };
    const result = applyMaestroDefaults(settings);
    expect(result.custom_providers).toHaveLength(1);
    expect(result.custom_providers[0].base_url).toBe(MAESTRO_DEFAULT_PROXY_URL);
  });
});
