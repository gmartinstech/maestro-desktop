// engine/src/agents/providers/registry.test.ts -- AGT-1 gate: TS vitest port of
// backend/apps/agents/providers/tests/test_registry.py's assertions, confirming identical
// pass/fail behavior for identical scenarios against the ported registry.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANTIGRAVITY_CHECK_TTL_MS,
  antigravityCache,
  antigravityConnected,
  resolveModelIdForSdk,
} from './registry';
import type { SettingsWithCustomProviders } from './registry';

function resetAntigravityCache(): void {
  antigravityCache.lastCheckedMs = -Infinity;
  antigravityCache.lastResult = false;
}

beforeEach(() => {
  resetAntigravityCache();
});

function fakeProvidersResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

// -- test_antigravity_connected_caches_result_briefly ---------------------------------------------

describe('antigravityConnected caching', () => {
  it('caches a positive result briefly (one underlying probe for two calls within the TTL)', async () => {
    const fetchProviders = vi.fn().mockResolvedValue(
      fakeProvidersResponse({ connections: [{ provider: 'antigravity', isActive: true }] }),
    );
    const first = await antigravityConnected({ fetchProviders });
    const second = await antigravityConnected({ fetchProviders });
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchProviders).toHaveBeenCalledTimes(1);
  });

  // -- test_antigravity_connected_cache_expires ----------------------------------------------------
  it('expires the cache after its TTL and re-probes', async () => {
    antigravityCache.lastCheckedMs = performance.now() - ANTIGRAVITY_CHECK_TTL_MS - 100;
    antigravityCache.lastResult = true;
    const fetchProviders = vi.fn().mockResolvedValue(fakeProvidersResponse({ connections: [] }));
    const result = await antigravityConnected({ fetchProviders });
    expect(result).toBe(false);
    expect(fetchProviders).toHaveBeenCalledTimes(1);
  });
});

// -- test_resolve_model_id_for_sdk_shares_one_antigravity_probe_within_ttl -------------------------

describe('resolveModelIdForSdk + antigravity TTL sharing', () => {
  it('shares one underlying antigravity probe across two resolutions within the TTL window', async () => {
    const settings: SettingsWithCustomProviders = {};
    const fetchProviders = vi.fn().mockResolvedValue(
      fakeProvidersResponse({ connections: [{ provider: 'antigravity', isActive: true }] }),
    );
    const probe = () => antigravityConnected({ fetchProviders });
    const first = await resolveModelIdForSdk('gemini-3.1-flash-lite', settings, probe);
    const second = await resolveModelIdForSdk('gemini-3.1-flash-lite', settings, probe);
    expect(first).toBe('ag/gemini-3-flash');
    expect(second).toBe('ag/gemini-3-flash');
    expect(fetchProviders).toHaveBeenCalledTimes(1);
  });
});
