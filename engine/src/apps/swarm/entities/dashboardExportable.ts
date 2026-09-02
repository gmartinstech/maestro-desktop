// engine/src/apps/swarm/entities/dashboardExportable.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/entities/dashboards.py's DashboardExportable.
//
// The bundling showcase. A dashboard's agent cards and app cards are pulled into the closure as
// sessions + apps (each session pulls its custom mode); the layout's entity-keyed dicts are
// rewritten local->bundle on export and bundle->fresh-local on import via the RemapTable. Mirrors
// the in-app duplicate_dashboard remap. Browser cards keep their url/tabs but get fresh ids; after
// writing the dashboard we re-point each imported session at it.

import { randomUUID } from 'node:crypto';
import { loadSessionData, saveSessionFile } from '../../../agents/manager/session/sessionFileStore';
import { dashboardsDir, load as loadDashboard, save as saveDashboardDoc } from '../../dashboards/store';
import type { BrowserCardPosition, CardPosition, Dashboard, DashboardLayout, ViewCardPosition } from '../../dashboards/models';
import { defaultDashboardLayout } from '../../dashboards/models';
import { depRef, type DepRef, type Exportable, type ExportContext } from '../exportable';
import { RemapTable } from '../exportable';
import { EntityType, type Requirement } from '../models';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function viewCardOutputId(key: string, card: Record<string, unknown>): string {
  return String(card.output_id ?? key).split('#')[0];
}

export class DashboardExportable implements Exportable {
  readonly type = EntityType.dashboard;

  constructor(
    public readonly localId: string,
    public readonly name: string,
    private readonly pData: Dashboard,
  ) {}

  static load(localId: string): DashboardExportable | null {
    const data = loadDashboard(localId);
    if (data === null) return null;
    return new DashboardExportable(localId, data.name || 'Dashboard', data);
  }

  serialize(ctx: ExportContext): Record<string, unknown> {
    const layout: DashboardLayout = { ...defaultDashboardLayout(), ...this.pData.layout };
    const cards: Record<string, CardPosition> = {};
    for (const [sid, card] of Object.entries(layout.cards ?? {})) {
      const bid = ctx.bundleIdFor(EntityType.session, sid);
      if (bid) cards[bid] = { ...card, session_id: bid };
    }
    const viewCards: Record<string, ViewCardPosition> = {};
    for (const [key, card] of Object.entries(layout.view_cards ?? {})) {
      // Keys are output_id for the primary card, `output_id#N` for extra instances of the same
      // app; resolve the bundle id off the bare output id and rebuild the suffix.
      const oid = viewCardOutputId(key, card);
      const bid = ctx.bundleIdFor(EntityType.app, oid);
      if (bid) {
        const inst = Number(card.instance ?? 1);
        // parent_session_id tethers the app card to the agent that built it; it's a session id, so
        // it remaps like spawned_by on browser cards.
        const parent = card.parent_session_id as string | null | undefined;
        const newKey = inst <= 1 ? bid : `${bid}#${inst}`;
        viewCards[newKey] = {
          ...card, output_id: bid,
          parent_session_id: parent ? ctx.bundleIdFor(EntityType.session, parent) : null,
        };
      }
    }
    const browserCards: Record<string, BrowserCardPosition> = {};
    for (const [bkey, card] of Object.entries(layout.browser_cards ?? {})) {
      const c: BrowserCardPosition = { ...card };
      const spawn = c.spawned_by;
      c.spawned_by = spawn ? ctx.bundleIdFor(EntityType.session, spawn) : null;
      browserCards[bkey] = c;
    }
    const expanded = (layout.expanded_session_ids ?? [])
      .map((s) => ctx.bundleIdFor(EntityType.session, s))
      .filter((b): b is string => Boolean(b));
    return {
      name: this.pData.name || 'Dashboard',
      layout: {
        ...layout, cards, view_cards: viewCards,
        browser_cards: browserCards, notes: layout.notes ?? {},
        expanded_session_ids: expanded,
      },
    };
  }

  files(): Record<string, Buffer> {
    return {};
  }

  dependencies(): DepRef[] {
    const layout = this.pData.layout ?? defaultDashboardLayout();
    const deps: DepRef[] = Object.keys(layout.cards ?? {}).map((sid) => depRef(EntityType.session, sid, 'has_agent'));
    const viewOids = new Set<string>();
    for (const [key, card] of Object.entries(layout.view_cards ?? {})) {
      viewOids.add(viewCardOutputId(key, card));
    }
    for (const oid of [...viewOids].sort()) {
      deps.push(depRef(EntityType.app, oid, 'has_app'));
    }
    return deps;
  }

  requirements(): Requirement[] {
    return [];
  }

  static import_(payload: Record<string, unknown>, _files: Record<string, Buffer>, remap: RemapTable): string {
    const newDid = randomUUID().replace(/-/g, '');
    const layout: DashboardLayout = { ...defaultDashboardLayout(), ...(payload.layout as Partial<DashboardLayout> | undefined) };
    const cards: Record<string, CardPosition> = {};
    for (const [bid, card] of Object.entries(layout.cards ?? {})) {
      const nsid = remap.local(bid);
      if (nsid) cards[nsid] = { ...card, session_id: nsid };
    }
    const viewCards: Record<string, ViewCardPosition> = {};
    for (const [key, card] of Object.entries(layout.view_cards ?? {})) {
      const bid = viewCardOutputId(key, card);
      const noid = remap.local(bid);
      if (noid) {
        const inst = Number(card.instance ?? 1);
        const parent = card.parent_session_id as string | null | undefined;
        const newKey = inst <= 1 ? noid : `${noid}#${inst}`;
        viewCards[newKey] = {
          ...card, output_id: noid,
          parent_session_id: parent ? remap.local(parent) : null,
        };
      }
    }
    const browserCards: Record<string, BrowserCardPosition> = {};
    for (const card of Object.values(layout.browser_cards ?? {})) {
      const nbid = `browser-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const c: BrowserCardPosition = { ...card, browser_id: nbid };
      // Re-stamp the home dashboard, else the card keeps the source's id and the anti-bleed render
      // guard (DashboardCardLayer keepAliveHidden) hides it on the imported dashboard.
      c.dashboard_id = newDid;
      const spawn = card.spawned_by;
      c.spawned_by = spawn ? remap.local(spawn) : null;
      browserCards[nbid] = c;
    }
    const expanded = (layout.expanded_session_ids ?? [])
      .map((b) => remap.local(b))
      .filter((e): e is string => Boolean(e));
    const now = new Date().toISOString();
    const doc: Dashboard = {
      id: newDid,
      name: (payload.name as string | undefined) || 'Imported Dashboard',
      auto_named: false,
      created_at: now,
      updated_at: now,
      layout: {
        ...layout, cards, view_cards: viewCards,
        browser_cards: browserCards, notes: layout.notes ?? {},
        expanded_session_ids: expanded,
      },
      thumbnail: null,
      preview_updated_at: null,
      preview_signature: null,
    };
    saveDashboardDoc(doc);
    // Best-effort: a hiccup here must not orphan the just-written dashboard.
    for (const sid of Object.keys(cards)) {
      try {
        const d = loadSessionData(sid);
        if (d !== null) {
          d.dashboard_id = newDid;
          saveSessionFile(sid, d);
        }
      } catch {
        // best-effort, matches dashboards.py's p_retag_sessions try/except pass
      }
    }
    return newDid;
  }

  static rollback(localId: string): void {
    const path = join(dashboardsDir(), `${localId}.json`);
    if (existsSync(path)) rmSync(path);
  }
}
