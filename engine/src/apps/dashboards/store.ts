// engine/src/apps/dashboards/store.ts -- SUB-3, a full TypeScript port of the on-disk half of
// backend/apps/dashboards/dashboards.py (load_all/save/load/p_delete/migrate_if_needed).

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import { atomicWriteJson } from '../../settings/store';
import { loadAllSessionData, saveSessionFile } from '../../agents/manager/session/sessionFileStore';
import { sessionsDir } from '../service/sessions';
import { dashboardLayoutDir } from '../dashboardLayout/store';
import { coerceDashboardLayout } from '../dashboardLayout/models';
import { defaultDashboardLayout, newDashboard, type Dashboard, type DashboardLayout } from './models';

export function dashboardsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'dashboards');
}

function dashboardFilePath(dashboardId: string, env: NodeJS.ProcessEnv): string {
  return join(dashboardsDir(env), `${dashboardId}.json`);
}

function oldLayoutFilePath(env: NodeJS.ProcessEnv): string {
  return join(dashboardLayoutDir(env), 'layout.json');
}

function readJsonOrNull(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerces a loosely-typed JSON blob into a Dashboard, filling any field an older/partial file is
 * missing -- mirrors pydantic's own field-default tolerance on `Dashboard(**data)` re-validation
 * (a bad/mismatched file is skipped by the caller, see loadAll(), not thrown from here). */
function hydrateDashboard(data: Record<string, unknown>): Dashboard | null {
  if (typeof data.id !== 'string') return null;
  const layout = typeof data.layout === 'object' && data.layout !== null
    ? { ...defaultDashboardLayout(), ...(data.layout as Record<string, unknown>) } as DashboardLayout
    : defaultDashboardLayout();
  const now = new Date().toISOString();
  return {
    id: data.id,
    name: typeof data.name === 'string' ? data.name : 'Untitled Dashboard',
    auto_named: data.auto_named === true,
    created_at: typeof data.created_at === 'string' ? data.created_at : now,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : now,
    layout,
    thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : null,
    preview_updated_at: typeof data.preview_updated_at === 'string' ? data.preview_updated_at : null,
    preview_signature: typeof data.preview_signature === 'string' ? data.preview_signature : null,
  };
}

export function loadAll(env: NodeJS.ProcessEnv = process.env): Dashboard[] {
  const dir = dashboardsDir(env);
  if (!existsSync(dir)) return [];
  const result: Dashboard[] = [];
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const data = readJsonOrNull(join(dir, fname));
    if (data === null) continue;
    const dash = hydrateDashboard(data);
    // Parseable JSON, wrong shape (e.g. an older/newer schema). Skip from the list but leave the
    // file alone so a later version can still read it -- same as dashboards.py's own try/except.
    if (dash === null) continue;
    result.push(dash);
  }
  return result;
}

export function save(dashboard: Dashboard, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteJson(dashboardFilePath(dashboard.id, env), dashboard);
}

/** Returns the dashboard or null -- callers needing dashboards.py's 404-on-missing HTTP behavior
 * check for null themselves (dashboards.ts's own handler). */
export function load(dashboardId: string, env: NodeJS.ProcessEnv = process.env): Dashboard | null {
  const data = readJsonOrNull(dashboardFilePath(dashboardId, env));
  if (data === null) return null;
  return hydrateDashboard(data);
}

export function pDelete(dashboardId: string, env: NodeJS.ProcessEnv = process.env): void {
  const path = dashboardFilePath(dashboardId, env);
  if (existsSync(path)) rmSync(path);
}

/** One-time migration: if no dashboards exist, create 'Dashboard 1' from the old single-layout
 * file and tag every existing chat session with its id. Idempotent (loadAll().length short-
 * circuits on every call after the first, same as modes.ts's ensureSeeded() convention this
 * engine already established for lazy per-request migration). */
export function migrateIfNeeded(env: NodeJS.ProcessEnv = process.env): void {
  if (loadAll(env).length > 0) return;

  let layout: DashboardLayout = defaultDashboardLayout();
  const oldPath = oldLayoutFilePath(env);
  if (existsSync(oldPath)) {
    try {
      const raw = JSON.parse(readFileSync(oldPath, 'utf8')) as Record<string, unknown>;
      if ('cards' in raw) {
        const oldLayout = coerceDashboardLayout(raw);
        // dashboardLayout/models.ts's ViewCardPosition (old, dead single-layout module) is a
        // narrower shape than dashboards/models.ts's own (which allows arbitrary extra keys, e.g.
        // parent_session_id) -- structurally compatible at runtime (every field the old shape has
        // is a subset), just not nominally assignable without this cast.
        layout = {
          ...defaultDashboardLayout(),
          cards: oldLayout.cards,
          view_cards: oldLayout.view_cards as unknown as DashboardLayout['view_cards'],
        };
      }
    } catch {
      // Failed to read old layout.json -- fall back to the empty layout already set above,
      // matching dashboards.py's own broad except-log-and-continue.
    }
  }

  const dashboard = newDashboard('Dashboard 1', layout);
  save(dashboard, env);

  if (existsSync(sessionsDir(env))) {
    for (const [sessionId, data] of loadAllSessionData(env)) {
      data.dashboard_id = dashboard.id;
      saveSessionFile(sessionId, data, env);
    }
  }
}
