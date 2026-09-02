import { describe, expect, test } from 'vitest';
import { coerceSettings, defaultAppSettings, MAESTRO_DEFAULT_MODEL, PROVEDOR_IA_TOKEN_FIELD } from './models';

describe('defaultAppSettings', () => {
  test('matches the Python schema defaults for the fields this migration checks most', () => {
    const d = defaultAppSettings();
    expect(d.default_model).toBe(MAESTRO_DEFAULT_MODEL);
    expect(d.connection_mode).toBe('own_key');
    expect(d.default_thinking_level).toBe('auto');
    expect(d.custom_providers).toEqual([]);
    expect(d.preflight_enabled).toBe(true);
    expect(d.preflight_rollout_pct).toBe(100);
  });
});

describe('coerceSettings', () => {
  test('preserves every valid field from raw, including the credential field name', () => {
    const raw = { [PROVEDOR_IA_TOKEN_FIELD]: 'mtok_realkey', theme: 'dark', zoom_sensitivity: 75 };
    const s = coerceSettings(raw);
    expect(s.provedor_ia_token).toBe('mtok_realkey');
    expect(s.theme).toBe('dark');
    expect(s.zoom_sensitivity).toBe(75);
  });

  test('fills in defaults for absent fields', () => {
    const s = coerceSettings({});
    expect(s.default_model).toBe(MAESTRO_DEFAULT_MODEL);
    expect(s.theme).toBe('light');
  });

  test('drops a field whose type has drifted, reverting it to default, and reports it', () => {
    const dropped: string[] = [];
    const s = coerceSettings({ zoom_sensitivity: 'not-a-number', theme: 'dark' }, (fields) => dropped.push(...fields));
    expect(s.zoom_sensitivity).toBe(50);
    expect(s.theme).toBe('dark');
    expect(dropped).toEqual(['zoom_sensitivity']);
  });

  test('rejects an out-of-enum literal value', () => {
    const s = coerceSettings({ default_thinking_level: 'ludicrous' });
    expect(s.default_thinking_level).toBe('auto');
  });

  test('ignores unknown top-level keys, mirroring pydantic extra="ignore"', () => {
    const s = coerceSettings({ some_field_from_a_newer_app_version: 'x' } as Record<string, unknown>);
    expect((s as unknown as Record<string, unknown>).some_field_from_a_newer_app_version).toBeUndefined();
  });

  test('preserves a full custom_providers entry shape', () => {
    const cp = { name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: 'mtok_x', models: [] };
    const s = coerceSettings({ custom_providers: [cp] });
    expect(s.custom_providers).toEqual([cp]);
  });
});
