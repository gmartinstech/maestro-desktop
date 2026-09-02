// engine/src/apps/web/nineRouter.ts -- SUB-8's port of backend/apps/web/web.py's
// `p_refresh_9r_connected` cache: which 9Router subscription providers (claude, codex,
// antigravity, gemini-cli, ...) are currently connected. 20s TTL, same as the Python original, to
// keep search/fetch endpoints snappy.
//
// Built entirely on ENG-6's own 9Router port (router/process.ts's isRunning/getProviders) rather
// than re-implementing the /api/providers call -- that module already carries the real
// cli_auth_headers()/`{"connections": [...]}`-unwrap behavior this needs, faithfully ported from
// backend/apps/nine_router/process.py's own get_providers().

import { isRunning as nineRouterIsRunning, getProviders as nineRouterGetProviders } from '../../router/process';

const P_CACHE_TTL_MS = 20_000;

let cached: Set<string> = new Set();
let cachedAt = 0;

export interface NineRouterConnectedDeps {
  isRunning: typeof nineRouterIsRunning;
  getProviders: typeof nineRouterGetProviders;
}

const defaultDeps: NineRouterConnectedDeps = {
  isRunning: nineRouterIsRunning,
  getProviders: nineRouterGetProviders,
};

/** Returns the set of currently-active 9Router subscription providers. Best-effort: any failure
 * leaves the cache exactly as it was, mirroring the Python original's bare except-and-keep-cache. */
export async function refresh9rConnected(
  now: number = Date.now(),
  deps: NineRouterConnectedDeps = defaultDeps,
): Promise<Set<string>> {
  if (now - cachedAt < P_CACHE_TTL_MS) return cached;
  try {
    if (!(await deps.isRunning())) {
      cached = new Set();
    } else {
      const conns = await deps.getProviders();
      const next = new Set<string>();
      for (const c of conns) {
        if (c && typeof c === 'object' && (c as Record<string, unknown>).isActive && typeof (c as Record<string, unknown>).provider === 'string') {
          next.add((c as Record<string, unknown>).provider as string);
        }
      }
      cached = next;
    }
    cachedAt = now;
  } catch {
    // cache stays; best-effort, same as the Python original.
  }
  return cached;
}

/** Test-only: forces the next refresh9rConnected() call to actually re-check instead of serving a
 * cached value. */
export function resetNineRouterCacheForTests(): void {
  cached = new Set();
  cachedAt = 0;
}
