// Frozen WS contract for `/ws/electron-main` (backend/main.py:457).
// The Electron MAIN process (not the renderer) attaches here so cookie-read browser
// commands don't ride the renderer's WS, which macOS throttles when backgrounded
// (see backend/apps/agents/core/ws_manager.py's send_main_command / connect_main).
//
// Emitting side: ws_manager.send_main_command sends this frame directly over the raw
// socket (not through send_to_session/seq_log, so no `seq` and no session_id envelope
// field). Consuming side (read-only reference; NOT edited by this contract or by
// CTR-2): electron/main.js's connectMainBridge(), around line 3028.
//
// Any change to this shape must land here FIRST.

/** The only frame the backend ever sends over this socket. */
export interface WsBrowserCommand {
  event: 'browser:command';
  data: {
    request_id: string;
    action: string;
    /** Always '' on this endpoint (send_main_command hardcodes it; cookie reads have no browser_id). */
    browser_id: string;
    /** Always '' on this endpoint. */
    tab_id: string;
    params: Record<string, unknown>;
  };
}

/** Discriminated union of every message shape the backend can send over
 * `/ws/electron-main`. Currently a union of one, kept as a union (not a bare interface)
 * so a future second frame type is a non-breaking addition here. */
export type ElectronMainWsServerEvent = WsBrowserCommand;

/** Client -> server: electron/main.js answers each `browser:command` with this, resolved
 * via ws_manager.resolve_browser_command. Documented for completeness; not part of
 * CTR-2's gate (which is about the backend-emitted side). */
export interface WsBrowserResult {
  event: 'browser:result';
  data: { request_id: string; [field: string]: unknown };
}
