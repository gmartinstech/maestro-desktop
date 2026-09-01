// Frozen WS contract for `/ws/terminal/{workspace_id}` (backend/main.py:339).
// Bidirectional PTY channel for the app card's Shell tab. Enumerated from backend/main.py's
// websocket_terminal() handler, the only emitter for this endpoint, backed by the PTY session
// in backend/apps/terminal/manager.py. Frames are base64 on the wire because PTY output is raw
// bytes and a UTF-8 sequence can straddle a read boundary.
//
// Unlike agents.ts/dashboard.ts, this endpoint is NOT consumed by
// frontend/src/shared/ws/WebSocketManager.ts — it's a raw WebSocket (no resume/seq_log; the
// terminal's reconnect contract is just "hand me the current scrollback"), wired through
// frontend/src/shared/hooks/useTerminalSocket.ts + frontend/src/shared/terminalFrames.ts's
// decodeTerminalFrame(), which is where this contract's loose typing actually got closed.
//
// Any change to a WS event's shape, or a new one, must land here FIRST.

/** Sent once right after connect (`session.running`/`shell`/`cwd` reflect the attached PTY). */
export interface WsTerminalStatus {
  event: 'term:status';
  data: { running: boolean; shell: string; cwd: string };
}

/** One chunk of PTY stdout/stderr, base64-encoded. */
export interface WsTerminalOutput {
  event: 'term:output';
  data: { data: string };
}

/** Sent once the PTY process exits; the socket's send loop returns right after. */
export interface WsTerminalExit {
  event: 'term:exit';
  data: { code: number };
}

/** Discriminated union of every message shape the backend can send over
 * `/ws/terminal/{workspace_id}`. */
export type TerminalWsServerEvent = WsTerminalStatus | WsTerminalOutput | WsTerminalExit;

// ---- Client -> server frames (documented for completeness; not part of the gate) ----

export type TerminalWsClientEvent =
  | { event: 'term:input'; data: { data: string } }
  | { event: 'term:resize'; data: { cols: number; rows: number } };
