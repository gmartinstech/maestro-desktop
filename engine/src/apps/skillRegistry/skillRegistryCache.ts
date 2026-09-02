// engine/src/apps/skillRegistry/skillRegistryCache.ts -- SUB-2, a full TypeScript port of
// backend/apps/skill_registry/skill_registry_cache.py.
//
// Catalog ships in the repo (skillsSnapshot.json, a byte-for-byte copy of the Python original's
// bundled skills_snapshot.json -- imported via tsconfig's resolveJsonModule, same mechanism
// agents/manager/configureProviderEnv.differential.fixture.json already relies on to land in
// dist/ at build time) so a brand-new install shows skills with zero network, and every
// successful live fetch is persisted to the user's cache so subsequent launches are instant +
// offline-safe.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeStateDir } from '../../agents/manager/statePaths';
import { atomicWriteJson } from '../../settings/store';
import bundledSnapshot from './skillsSnapshot.json';

// Canonical shape for one catalog entry, shared with skillRegistrySources.ts (whose `FetchedSkill`
// is a type alias of this, not a near-duplicate) -- every entry this module ever loads (bundled
// snapshot, disk cache) or that a live GitHub fetch produces carries all six fields, matching the
// Python original's dict shape exactly (skill_registry_sources.py's p_fetch_one_skill always sets
// every key).
export interface CachedSkill {
  name: string;
  description: string;
  content: string;
  folder: string;
  category: string;
  repositoryUrl: string;
}

export type SkillRegistryCacheData = Record<string, CachedSkill>;

/** The bundled snapshot's absolute path -- kept for parity with the Python original's
 * `BUNDLED_SNAPSHOT` constant, which backend/tests/test_skill_registry_seed.py asserts exists on
 * disk. The TS twin of that test reads the SAME underlying file this module imports (not a
 * separately-loaded copy), just resolved as a plain path rather than a parsed JSON module. */
export const BUNDLED_SNAPSHOT_PATH = join(__dirname, 'skillsSnapshot.json');

export function diskCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.MAESTRO_SKILL_CACHE_DIR ?? '').trim();
  const base = override || homeStateDir('cache');
  return join(base, 'skill_registry.json');
}

/** Return a non-empty catalog from the on-disk last-good cache, falling back to the bundled
 * snapshot, so the registry is never empty on a cold/offline start. Returns {} only if neither
 * source is present/valid. */
export function loadSeedCache(env: NodeJS.ProcessEnv = process.env): SkillRegistryCacheData {
  const diskPath = diskCachePath(env);
  if (existsSync(diskPath)) {
    try {
      const data = JSON.parse(readFileSync(diskPath, 'utf8')) as unknown;
      if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0) {
        return data as SkillRegistryCacheData;
      }
    } catch {
      // fall through to the bundled snapshot
    }
  }
  const data = bundledSnapshot as unknown as SkillRegistryCacheData;
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    return data;
  }
  return {};
}

/** Persist the last good live fetch so the next launch is instant. Atomic replace (via
 * settings/store.ts's atomicWriteJson) so a crash mid-write can't leave a truncated cache. */
export function saveDiskCache(skills: SkillRegistryCacheData, env: NodeJS.ProcessEnv = process.env): void {
  if (Object.keys(skills).length === 0) return;
  try {
    atomicWriteJson(diskCachePath(env), skills);
  } catch {
    // best-effort, matches the Python original's log.debug + swallow.
  }
}
