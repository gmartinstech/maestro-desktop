// engine/src/apps/dashboardLayout/store.ts -- SUB-1's native port of
// backend/apps/dashboard_layout/dashboard_layout.py's load()/save() (see models.ts's header for
// this SubApp's dead-code status in the real backend).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import { atomicWriteJson } from '../../settings/store';
import { coerceDashboardLayout, defaultLayout, type DashboardLayout } from './models';

export function dashboardLayoutDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'dashboard_layout');
}

function layoutFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dashboardLayoutDir(env), 'layout.json');
}

// Direct port of load(): missing file -> default; an old column-based shape (pre-canvas rewrite,
// "columns" present but no "cards") -> reset to default rather than trying to migrate it (matches
// dashboard_layout.py's own explicit comment); any other read/parse failure -> default, never throw.
export function loadDashboardLayout(env: NodeJS.ProcessEnv = process.env): DashboardLayout {
  const path = layoutFilePath(env);
  if (!existsSync(path)) return defaultLayout();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return defaultLayout();
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultLayout();
  const data = raw as Record<string, unknown>;
  if ('columns' in data && !('cards' in data)) return defaultLayout();
  return coerceDashboardLayout(data);
}

// dashboard_layout.py's save() is a plain open()+json.dump (NOT atomic_write_json, unlike
// modes.py/dashboards.py) -- reusing settings/store.ts's atomicWriteJson here is a deliberate
// strengthening, not a deviation that changes observable behavior: same file, same JSON shape,
// just crash-safe. Documented rather than silently diverging.
export function saveDashboardLayout(layout: DashboardLayout, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteJson(layoutFilePath(env), layout);
}
