// engine/src/split.ts -- ENG-1, the strangler-fig route table.
//
// For every /api/<name> or /ws/<name> path the engine decides whether IT serves the request
// natively (TypeScript, in-process) or transparently proxies it to the spawned Python backend.
// Ownership is a per-name table read from MAESTRO_ENGINE_ROUTES, and every name NOT mentioned in
// that table -- including names that don't exist yet -- defaults to 'proxy'. That default is the
// whole point: it is what makes day one a no-op (see docs/plans/2026-08-31-txm-tauri-typescript-
// migration.md's ENG-1 entry, "the strangler fig"; rollback for any later native port is deleting
// or flipping one entry here, at runtime, no rebuild).
//
// A route's "name" is the first path segment after /api/ or /ws/ -- e.g. both /api/agents/launch
// and /ws/agents/{session_id} resolve to the name "agents", so one table entry flips a whole
// subsystem's REST *and* WS surface together (AGT-6 in the plan: "Flip /api/agents + /ws/agents to
// native"). Not every backend WS path lines up with its sibling REST name this way -- /ws/dashboard
// has no /api/dashboard (the REST surface is the plural /api/dashboards, a pre-existing backend
// naming quirk, not this table's) -- those get independent entries, which is expected.

export type RouteMode = 'proxy' | 'native';

export type RouteTable = ReadonlyMap<string, RouteMode>;

const P_ENV_VAR = 'MAESTRO_ENGINE_ROUTES';

// The table's baseline, edited in place by each ticket that finishes porting a subsystem -- e.g.
// ENG-3 flipped 'settings' here when settings/handler.ts landed; ENG-7 flips 'health' and
// 'service' the same way (engine/src/apps/{health,service}/*). MAESTRO_ENGINE_ROUTES entries
// still win over this baseline (loadRouteTable merges env on top, see below), so the plan's own
// rollback story -- "one env-var entry, at runtime, no rebuild" -- still holds even after a name
// is flipped here: setting `health:proxy` in the env reverts a single ticket's flip without
// touching this file or restarting from source.
const DEFAULT_ROUTES: Readonly<Record<string, RouteMode>> = {
  health: 'native',
  service: 'native',
};

// name:mode pairs, comma-separated -- e.g. "agents:native,settings:native" -- chosen over a JSON
// blob because the plan's own rollback story is "one env-var entry, at runtime": that needs to be
// hand-typeable in a shell or a CI/launcher config with no quoting gymnastics, which a JSON blob
// forces in most shells (especially Windows' cmd/PowerShell, this repo's primary target).
export function parseRouteTable(raw: string | undefined): RouteTable {
  const table = new Map<string, RouteMode>();
  if (!raw) return table;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) {
      throw new Error(`${P_ENV_VAR}: malformed entry "${trimmed}" (expected "name:proxy" or "name:native")`);
    }
    const name = trimmed.slice(0, sep).trim();
    const mode = trimmed.slice(sep + 1).trim();
    if (!name) throw new Error(`${P_ENV_VAR}: malformed entry "${trimmed}" (empty name before ":")`);
    if (mode !== 'proxy' && mode !== 'native') {
      throw new Error(`${P_ENV_VAR}: unknown mode "${mode}" for "${name}" (expected "proxy" or "native")`);
    }
    table.set(name, mode);
  }
  return table;
}

/** Reads and parses MAESTRO_ENGINE_ROUTES from the live environment, layered on top of
 * DEFAULT_ROUTES (env entries win on a name-by-name basis). An unset var yields exactly
 * DEFAULT_ROUTES -- on the very first day of this table's existence (ENG-1) that was itself
 * empty, i.e. everything proxied (see resolveMode); each subsequent ticket's flip changes what
 * "unset" now defaults to, without requiring every deployment to set the env var explicitly. */
export function loadRouteTable(): RouteTable {
  const table = new Map<string, RouteMode>(Object.entries(DEFAULT_ROUTES));
  for (const [name, mode] of parseRouteTable(process.env[P_ENV_VAR])) {
    table.set(name, mode);
  }
  return table;
}

/** Extracts the routing name from a request path, or null for anything outside /api/<name>/... or
 * /ws/<name>/... (bare framework paths like /docs, /openapi.json -- see backend/main.py -- have no
 * subsystem owner and are always proxied; resolveMode(table, null) below returns 'proxy'). */
export function routeNameFromPath(pathname: string): string | null {
  const m = /^\/(api|ws)\/([^/]+)/.exec(pathname);
  return m ? m[2] : null;
}

/** The table's one load-bearing default: a name absent from the table -- including a null name,
 * including a name nobody has ever heard of -- resolves to 'proxy'. Nothing can silently start
 * 404ing just because a later ticket added a new backend route this table doesn't know about yet. */
export function resolveMode(table: RouteTable, name: string | null): RouteMode {
  if (name === null) return 'proxy';
  return table.get(name) ?? 'proxy';
}
