// engine/src/apps/dashboardLayout/models.ts -- SUB-1's native port of
// backend/apps/dashboard_layout/models.py.
//
// IMPORTANT, found during this port (see this ticket's status-ledger row for the full writeup):
// backend/apps/dashboard_layout's SubApp is NOT mounted in backend/main.py's MainApp([...]) list --
// its lifespan never runs and /api/dashboard_layout has no live route in the real backend today.
// It was superseded by backend/apps/dashboards (the multi-dashboard feature), which reads this
// module's on-disk file ONLY as a one-time legacy-migration source (dashboards.py's
// OLD_LAYOUT_FILE), never through this SubApp's own router. Ported anyway (the ticket names it by
// path, and a clean single-file layout store is trivial to keep faithful), but native routing is
// reachable only via an explicit MAESTRO_ENGINE_ROUTES=dashboard_layout:native opt-in -- there is
// no live Python behavior to stay parity-compatible WITH beyond this module's own dead code.

export interface CardPosition {
  session_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewCardPosition {
  output_id: string;
  instance: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DashboardLayout {
  cards: Record<string, CardPosition>;
  view_cards: Record<string, ViewCardPosition>;
}

export interface DashboardLayoutUpdateInput {
  cards: Record<string, CardPosition>;
  view_cards?: Record<string, ViewCardPosition>;
}

export function defaultLayout(): DashboardLayout {
  return { cards: {}, view_cards: {} };
}

function coerceCardPosition(raw: unknown): CardPosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.session_id !== 'string') return null;
  return {
    session_id: r.session_id,
    x: typeof r.x === 'number' ? r.x : 0,
    y: typeof r.y === 'number' ? r.y : 0,
    width: typeof r.width === 'number' ? r.width : 420,
    height: typeof r.height === 'number' ? r.height : 280,
  };
}

function coerceViewCardPosition(raw: unknown): ViewCardPosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.output_id !== 'string') return null;
  return {
    output_id: r.output_id,
    instance: typeof r.instance === 'number' ? r.instance : 1,
    x: typeof r.x === 'number' ? r.x : 0,
    y: typeof r.y === 'number' ? r.y : 0,
    width: typeof r.width === 'number' ? r.width : 480,
    height: typeof r.height === 'number' ? r.height : 360,
  };
}

// Ports DashboardLayout(**data)'s validation tolerance: an entry that doesn't fit the shape is
// dropped rather than bricking the whole load (mirrors dashboard_layout.py's own broad
// except-log-default fallback one level up, at the file-read call site).
export function coerceDashboardLayout(data: Record<string, unknown>): DashboardLayout {
  const layout = defaultLayout();
  if (typeof data.cards === 'object' && data.cards !== null) {
    for (const [id, raw] of Object.entries(data.cards as Record<string, unknown>)) {
      const card = coerceCardPosition(raw);
      if (card) layout.cards[id] = card;
    }
  }
  if (typeof data.view_cards === 'object' && data.view_cards !== null) {
    for (const [id, raw] of Object.entries(data.view_cards as Record<string, unknown>)) {
      const card = coerceViewCardPosition(raw);
      if (card) layout.view_cards[id] = card;
    }
  }
  return layout;
}
