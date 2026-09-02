import { describe, expect, test, beforeEach } from 'vitest';
import { catalogModels, forgetCatalog, parseCatalog, rememberCatalog, CATALOG_TTL_SECONDS, MAESTRO_MODELS } from './maestroCatalog';

beforeEach(() => {
  forgetCatalog();
});

describe('parseCatalog', () => {
  test('null for a non-object payload', () => {
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog('nope')).toBeNull();
    expect(parseCatalog(42)).toBeNull();
  });

  test('null when data is missing or not an array', () => {
    expect(parseCatalog({})).toBeNull();
    expect(parseCatalog({ data: 'nope' })).toBeNull();
  });

  test('null (not empty) when every row is unusable', () => {
    expect(parseCatalog({ data: [{}, { id: '' }, { id: 123 }] })).toBeNull();
  });

  test('dedupes ids and trims whitespace', () => {
    const result = parseCatalog({ data: [{ id: ' maestro-fast ' }, { id: 'maestro-fast' }] });
    expect(result).toHaveLength(1);
    expect(result?.[0].value).toBe('maestro-fast');
  });

  test('known ids sort in the shipped preferred order; unknown ids sort alphabetically after', () => {
    const result = parseCatalog({ data: [{ id: 'zebra' }, { id: 'maestro-code' }, { id: 'maestro-fast' }, { id: 'apple' }] });
    expect(result?.map((m) => m.value)).toEqual(['maestro-fast', 'maestro-code', 'apple', 'zebra']);
  });

  test('known ids get their shipped label; unknown ids get a prettified fallback', () => {
    const result = parseCatalog({ data: [{ id: 'maestro-ultra' }, { id: 'some-new-model' }] });
    expect(result?.find((m) => m.value === 'maestro-ultra')?.label).toBe('Maestro Ultra');
    expect(result?.find((m) => m.value === 'some-new-model')?.label).toBe('Some New Model');
  });

  test('every parsed row gets the vendor default context window / max tokens / reasoning=true', () => {
    const result = parseCatalog({ data: [{ id: 'x' }] });
    expect(result?.[0]).toMatchObject({ context_window: 128_000, max_completion_tokens: 4_096, reasoning: true });
  });
});

describe('catalogModels / rememberCatalog', () => {
  test('null before anything is ever remembered', () => {
    expect(catalogModels()).toBeNull();
  });

  test('returns a fresh catalog verbatim', () => {
    rememberCatalog([...MAESTRO_MODELS], 1_000_000);
    expect(catalogModels(1_000_000)).toEqual([...MAESTRO_MODELS]);
  });

  test('expires after CATALOG_TTL_SECONDS', () => {
    rememberCatalog([...MAESTRO_MODELS], 0);
    expect(catalogModels(CATALOG_TTL_SECONDS * 1000 - 1)).not.toBeNull();
    expect(catalogModels(CATALOG_TTL_SECONDS * 1000 + 1000)).toBeNull();
  });

  test('forgetCatalog drops the cache', () => {
    rememberCatalog([...MAESTRO_MODELS]);
    forgetCatalog();
    expect(catalogModels()).toBeNull();
  });

  test('the returned array is a copy, not a live reference', () => {
    rememberCatalog([...MAESTRO_MODELS]);
    const first = catalogModels();
    first?.push({ value: 'x', label: 'X', context_window: 1, max_completion_tokens: 1, reasoning: false });
    expect(catalogModels()).toHaveLength(MAESTRO_MODELS.length);
  });
});
