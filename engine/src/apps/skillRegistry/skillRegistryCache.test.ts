// engine/src/apps/skillRegistry/skillRegistryCache.test.ts -- SUB-2's vitest twin of
// backend/tests/test_skill_registry_seed.py: regression tests for the skill-registry
// never-empty seed (winv2 Bug #1).
//
// The bug: the catalog was fetched from GitHub once at startup then only hourly, so a cold/slow/
// failed network left it empty for the whole session, breaking the Skills page and the onboarding
// "Install a skill" step. Fix: seed from a bundled snapshot + on-disk last-good cache so the
// catalog is never empty, even fully offline.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registrySearch, setCacheForTests } from './skillRegistry';
import { BUNDLED_SNAPSHOT_PATH, diskCachePath, loadSeedCache, saveDiskCache } from './skillRegistryCache';

describe('bundled snapshot', () => {
  test('exists and includes pdf', () => {
    // The onboarding step targets the "pdf" skill via /pdf/i; it must be present in the shipped
    // snapshot or the tour times out even with a populated list.
    expect(existsSync(BUNDLED_SNAPSHOT_PATH)).toBe(true);
    const data = JSON.parse(readFileSync(BUNDLED_SNAPSHOT_PATH, 'utf8')) as Record<string, { folder?: string }>;
    const entries = Object.entries(data);
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.some(([k, v]) => k.toLowerCase().includes('pdf') || (v.folder ?? '').toLowerCase().includes('pdf'))).toBe(true);
  });
});

describe('disk cache + seed', () => {
  let tmp: string;
  let savedCacheDirEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'maestro-engine-skillregistry-cache-test-'));
    savedCacheDirEnv = process.env.MAESTRO_SKILL_CACHE_DIR;
    process.env.MAESTRO_SKILL_CACHE_DIR = tmp;
  });

  afterEach(() => {
    if (savedCacheDirEnv === undefined) delete process.env.MAESTRO_SKILL_CACHE_DIR;
    else process.env.MAESTRO_SKILL_CACHE_DIR = savedCacheDirEnv;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('seed makes the catalog non-empty offline', async () => {
    // Point the disk cache at an empty tmp dir so only the bundled snapshot can seed; this is the
    // brand-new-install, no-network case.
    const seeded = loadSeedCache();
    expect(Object.keys(seeded).length).toBeGreaterThanOrEqual(10);

    setCacheForTests(seeded);
    const res = await registrySearch({ q: '', limit: 100, offset: 0, category: '' });
    expect('total' in res && res.total).toBeGreaterThanOrEqual(10);
    expect('skills' in res && res.skills.length).toBeGreaterThanOrEqual(10);
  });

  test('disk cache round-trips and wins priority over the bundled snapshot', () => {
    // A saved last-good fetch must win over the bundled snapshot on next boot.
    const sentinel = {
      'only-skill': { name: 'only-skill', description: '', content: '', folder: 'skills/only-skill', category: 'Test', repositoryUrl: '' },
    };
    saveDiskCache(sentinel);
    expect(existsSync(diskCachePath())).toBe(true);
    expect(loadSeedCache()).toEqual(sentinel);
  });
});
