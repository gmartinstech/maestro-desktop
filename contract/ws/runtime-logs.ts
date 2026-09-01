// Frozen WS contract for `/ws/outputs/runtime/{workspace_id}/logs` (backend/main.py:258).
// This endpoint has its own envelope shape (no `seq`, no session_id — `workspace_id` instead)
// and is not consumed by frontend/src/shared/ws/WebSocketManager.ts; its client lives at
// frontend/src/app/pages/Outputs (Terminal/preview pane), which currently reads these frames
// with implicit `any` typing. Enumerated straight from backend/main.py's
// websocket_runtime_logs() handler, the only emitter for this endpoint.
//
// Any change to a WS event's shape, or a new one, must land here FIRST.

export interface WsRuntimeStatusData {
  running: boolean;
  port: number | null;
  backend_url: string | null;
  frontend_port: number | null;
  frontend_url: string | null;
  is_new_mode: boolean;
}

/** Sent once right after connect, and again after every `runtime:log` frame whose
 * `stream === 'runtime'` (a runtime-level event such as bind-ready flips
 * frontend_url from null to the Vite URL, so the client re-polls status on those). */
export interface WsRuntimeStatus {
  event: 'runtime:status';
  workspace_id: string;
  data: WsRuntimeStatusData;
}

/** One line of the workspace's persistent app-backend stdout/stderr (or a synthetic
 * `stream: "runtime"` line for start/frontend-ready/exit lifecycle events). */
export interface WsRuntimeLog {
  event: 'runtime:log';
  workspace_id: string;
  data: { stream: string; text: string };
}

/** Sent (with no `data` key) when no runtime is currently attached for the workspace;
 * the socket closes immediately after. The client is expected to call `/runtime/start`
 * and reconnect. Always preceded by one `runtime:status` frame on this path too, so the
 * preview pane can still show `is_new_mode`-driven placeholder state before it retries. */
export interface WsRuntimeNotAttached {
  event: 'runtime:not_attached';
  workspace_id: string;
}

/** Discriminated union of every message shape the backend can send over
 * `/ws/outputs/runtime/{workspace_id}/logs`. */
export type RuntimeLogsWsServerEvent = WsRuntimeStatus | WsRuntimeLog | WsRuntimeNotAttached;
