// Frozen WS contract for `/ws/dashboard` (backend/main.py:419).
// `/ws/dashboard` is the other socket frontend/src/shared/ws/WebSocketManager.ts drives (the
// first being `/ws/agents/{session_id}`, typed in agents.ts); its handleMessage switch carries
// both session-scoped agent:* cases (typed in agents.ts, and re-delivered here verbatim because
// send_to_session fans every session event out to dashboard sockets too) and the dashboard-only
// cases typed in this file.
//
// Source of truth for what the backend emits: ws_manager.broadcast_global
// (backend/apps/agents/core/ws_manager.py), whose envelope is ONLY `{event, data}` — no
// top-level `session_id` or `seq` (unlike send_to_session's envelope; see agents.ts). Enumerated
// from every broadcast_global(...) call site: backend/main.py (`settings:changed`),
// backend/apps/workflows/{workflows,executor,notifier}.py (`workflow:*`),
// backend/apps/agents/manager/AgentLaunch.py, backend/apps/agents/agent_manager.py and
// backend/apps/outputs/outputs.py (`agent:output_upserted`), backend/apps/workflows/workflows.py
// (`agent:test_state`), and backend/apps/agents/browser/browser_agent.py (`dashboard:*`).
//
// Two call sites (AgentLaunch.py's session-fork path, post_tool_hook.py's sub-agent snapshot)
// broadcast `agent:status` with the SAME `data` shape as agents.ts's WsAgentStatusFull, just
// without the top-level session_id/seq send_to_session adds — not re-modeled here since
// WebSocketManager.ts's `agent:status` case already treats `data.session` as authoritative
// independent of the top-level session_id's presence.
//
// Any change to a WS event's shape, or a new one, must land here FIRST.

/** Connection-scoped heartbeat reply on this socket. Unlike agents.ts's WsServerPong there is
 * no session_id (this socket isn't session-scoped) and no server:hello/resume handshake at all
 * (websocket_dashboard() has no client:hello branch; the client treats the socket as "live"
 * the instant it opens, see WebSocketManager.connect()'s no-sessionId branch). */
export interface WsDashboardServerPong {
  event: 'server:pong';
  data: { nonce: unknown };
}

/** Signal-only: an agent (not the user via the Settings modal) wrote settings, so the renderer
 * should refetch instead of waiting for the next window-focus. Carries no fields on purpose so
 * nothing (least of all a secret) rides the broadcast. */
export interface WsSettingsChanged {
  event: 'settings:changed';
  data: Record<string, never>;
}

/** Workflow Test-Agent lifecycle, driven by workflows.py's `_set_test_state`. */
export interface WsAgentTestState {
  event: 'agent:test_state';
  data: { session_id: string; state: 'running' | 'complete' | 'error' };
}

/** Wire-relevant slice of an Output row (frontend/src/shared/state/outputsSlice.ts's Output),
 * embedded whole in `agent:output_upserted`'s data and dispatched straight into the outputs
 * slice's upsert reducer, which merges over any existing row by id. */
export interface WsDashboardOutput {
  id: string;
  [extra: string]: unknown;
}

/** Emitted when an Output row is created (canvas-launched App Builder seed) or updated
 * (post-session meta.json sync). */
export interface WsAgentOutputUpserted {
  event: 'agent:output_upserted';
  data: { output: WsDashboardOutput };
}

/** Wire-relevant slice of a Workflow (backend/apps/workflows/models.py), embedded whole in
 * `workflow:updated`'s data and dispatched straight into the workflows slice via upsertWorkflow. */
export interface WsDashboardWorkflow {
  id: string;
  [extra: string]: unknown;
}

export interface WsWorkflowUpdated {
  event: 'workflow:updated';
  data: { workflow_id: string; workflow: WsDashboardWorkflow };
}

export interface WsWorkflowDeleted {
  event: 'workflow:deleted';
  data: { workflow_id: string };
}

/** Wire-relevant slice of a WorkflowRun (backend/apps/workflows/models.py). `status`/
 * `triggered_by`/`id`/`workflow_id` are read directly by WebSocketManager.ts's `workflow:run`
 * case (to auto-open the run monitor on a fresh manual run); the rest rides through unread. */
export interface WsDashboardWorkflowRun {
  id: string;
  workflow_id: string;
  status: 'running' | 'success' | 'failure' | 'ran_late' | 'skipped';
  triggered_by: 'schedule' | 'manual' | 'retry';
  [extra: string]: unknown;
}

/** Fired on every step transition of a workflow run (start, per-step progress, pause/resume,
 * approval-wait, finish) — executor.py broadcasts this at each of those points. */
export interface WsWorkflowRun {
  event: 'workflow:run';
  data: { workflow_id: string; run: WsDashboardWorkflowRun };
}

/** Permission-escalation notify, from workflows/notifier.py's `_base_payload` plus (on a
 * text/call tier whose cloud SMS bridge isn't wired) the `tier_*`/`fallback` fields. */
export interface WsWorkflowNotify {
  event: 'workflow:notify';
  data: {
    workflow_id: string;
    workflow_title: string;
    run_id: string;
    status: 'running' | 'success' | 'failure' | 'ran_late' | 'skipped';
    session_id: string | null;
    started_at: string | null;
    finished_at: string | null;
    /** Present only on a text/call escalation tier's fallback notify. */
    tier_kind?: 'notify' | 'text' | 'call';
    tier_phone?: string | null;
    fallback?: boolean;
  };
}

export interface WsDashboardBrowserCardKeep {
  event: 'dashboard:browser_card_keep';
  data: { dashboard_id: string; browser_id: string };
}

/** Wire-relevant slice of a BrowserCardPosition (backend/apps/dashboards/models.py /
 * frontend/src/shared/state/dashboardLayoutSlice.ts's BrowserCardPosition), embedded whole and
 * spread into the dashboard layout slice's browserCards map. */
export interface WsDashboardBrowserCard {
  browser_id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spawned_by?: string | null;
  dashboard_id?: string;
  [extra: string]: unknown;
}

export interface WsDashboardBrowserCardAdded {
  event: 'dashboard:browser_card_added';
  data: {
    dashboard_id: string;
    browser_card: WsDashboardBrowserCard;
    parent_session_id: string;
  };
}

/** Discriminated union of every dashboard-only message shape the backend can send over
 * `/ws/dashboard` via broadcast_global. This socket ALSO receives every agent:* event from
 * agents.ts's AgentWsServerEvent (send_to_session fans out to both the session's own sockets
 * and every dashboard socket) — those are not repeated here, see the file doc comment above. */
export type DashboardWsServerEvent =
  | WsDashboardServerPong
  | WsSettingsChanged
  | WsAgentTestState
  | WsAgentOutputUpserted
  | WsWorkflowUpdated
  | WsWorkflowDeleted
  | WsWorkflowRun
  | WsWorkflowNotify
  | WsDashboardBrowserCardKeep
  | WsDashboardBrowserCardAdded;

// ---- Client -> server frames (documented for completeness; not part of the gate) ----

export type DashboardWsClientEvent =
  | { event: 'client:ping'; data: { nonce: string } }
  | { event: 'agent:approval_response'; data: { request_id: string; behavior: 'allow' | 'deny'; message?: string } }
  | { event: 'browser:result'; data: { request_id: string; [field: string]: unknown } }
  | { event: 'dashboard:active'; data: { dashboard_id: string } };
