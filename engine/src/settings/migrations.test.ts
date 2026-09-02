import { describe, expect, test } from 'vitest';
import { migrateLegacyFields, migratePickerValue } from './migrations';

describe('migratePickerValue', () => {
  test('rewrites the stale provedor-ia picker prefix to maestro', () => {
    expect(migratePickerValue('custom/provedor-ia/maestro-fast')).toBe('custom/maestro/maestro-fast');
  });

  test('leaves anything else unchanged', () => {
    expect(migratePickerValue('sonnet')).toBe('sonnet');
    expect(migratePickerValue('custom/other/model')).toBe('custom/other/model');
  });
});

describe('migrateLegacyFields', () => {
  test('chains the openswarm_* rename table oldest-first', () => {
    const raw = migrateLegacyFields({ openswarm_auth_token: 'tok-1' });
    expect(raw.maestro_bearer_token).toBe('tok-1');
    expect(raw.openswarm_auth_token).toBeUndefined();
    expect(raw.openswarm_bearer_token).toBeUndefined();
  });

  test('a value already present under the newer name wins over the stale one', () => {
    const raw = migrateLegacyFields({ openswarm_bearer_token: 'stale', maestro_bearer_token: 'current' });
    expect(raw.maestro_bearer_token).toBe('current');
  });

  test('rewrites deprecated connection_mode values to own_key', () => {
    for (const legacy of ['managed', 'openswarm-pro', 'free-trial']) {
      expect(migrateLegacyFields({ connection_mode: legacy }).connection_mode).toBe('own_key');
    }
  });

  test('leaves a current connection_mode untouched', () => {
    expect(migrateLegacyFields({ connection_mode: 'own_key' }).connection_mode).toBe('own_key');
  });

  test('drops a stale custom_providers entry literally named provedor-ia', () => {
    const raw = migrateLegacyFields({
      custom_providers: [{ name: 'provedor-ia', base_url: 'x' }, { name: 'OpenAI', base_url: 'y' }],
    });
    expect(raw.custom_providers).toEqual([{ name: 'OpenAI', base_url: 'y' }]);
  });

  test('rewrites a stale default_model picker prefix', () => {
    expect(migrateLegacyFields({ default_model: 'custom/provedor-ia/maestro' }).default_model).toBe('custom/maestro/maestro');
  });

  test('the credential field name itself is never renamed, present or absent', () => {
    expect(migrateLegacyFields({ provedor_ia_token: 'mtok_abc123' }).provedor_ia_token).toBe('mtok_abc123');
    expect(migrateLegacyFields({})).not.toHaveProperty('provedor_ia_token');
  });
});
