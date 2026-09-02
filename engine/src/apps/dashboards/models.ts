// engine/src/apps/dashboards/models.ts -- SUB-3, a full TypeScript port of
// backend/apps/dashboards/models.py.
//
// Field-for-field port of the pydantic models: CardPosition/ViewCardPosition/BrowserTab/
// BrowserCardPosition/NotePosition/DashboardLayout/Dashboard/DashboardCreate/DashboardUpdate. Same
// field names, same defaults -- this is a wire format the frontend and the still-shipping Python
// backend both read/write during the migration.

import { randomUUID } from 'node:crypto';

export interface CardPosition {
  session_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewCardPosition {
  output_id: string;
  // Which instance of the app this card is (1 = primary).
  instance: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // Only present on some cards (parent_session_id ties an app card to the agent that built it);
  // kept as an open bag below via [key: string]: unknown rather than a named field, since
  // dashboards.py itself treats view_cards entries as loosely-typed dicts (DashboardLayout's own
  // view_cards field is typed ViewCardPosition, but dashboards.py's serialize/import code paths
  // read/write extra keys like parent_session_id through **card spreads, never through the model).
  [key: string]: unknown;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
}

export interface BrowserCardPosition {
  browser_id: string;
  url: string;
  tabs: BrowserTab[];
  activeTabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Agent session id that spawned this browser, or null for user-created.
  spawned_by: string | null;
  // When the agent leaves the deliverable on the page, this skips the auto-close-on-parent-finish.
  keep_open: boolean;
  // The dashboard this card calls home.
  dashboard_id: string | null;
}

export interface NotePosition {
  note_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color: string;
}

export interface DashboardLayout {
  cards: Record<string, CardPosition>;
  view_cards: Record<string, ViewCardPosition>;
  browser_cards: Record<string, BrowserCardPosition>;
  workflow_cards: Record<string, unknown>;
  workflows_hub: Record<string, unknown> | null;
  notes: Record<string, NotePosition>;
  expanded_session_ids: string[];
  // model_config = ConfigDict(extra="allow") on the Python model -- an unrecognized top-level key
  // round-trips instead of being dropped.
  [key: string]: unknown;
}

export function defaultDashboardLayout(): DashboardLayout {
  return {
    cards: {},
    view_cards: {},
    browser_cards: {},
    workflow_cards: {},
    workflows_hub: null,
    notes: {},
    expanded_session_ids: [],
  };
}

export interface Dashboard {
  id: string;
  name: string;
  auto_named: boolean;
  created_at: string;
  updated_at: string;
  layout: DashboardLayout;
  thumbnail: string | null;
  // Bumped only when a fresh thumbnail is saved; drives sidebar/grid order.
  preview_updated_at: string | null;
  // Sorted card-id set captured with the last thumbnail.
  preview_signature: string | null;
}

export function newDashboardId(): string {
  return randomUUID().replace(/-/g, '');
}

export function newDashboard(name = 'Untitled Dashboard', layout: DashboardLayout = defaultDashboardLayout()): Dashboard {
  const now = new Date().toISOString();
  return {
    id: newDashboardId(),
    name,
    auto_named: false,
    created_at: now,
    updated_at: now,
    layout,
    thumbnail: null,
    preview_updated_at: null,
    preview_signature: null,
  };
}

export interface DashboardCreateInput {
  name?: string;
}

export interface DashboardUpdateInput {
  name?: string;
  layout?: DashboardLayout;
  thumbnail?: string | null;
  preview_signature?: string | null;
}
