// engine/src/apps/terminal/ws.ts -- SUB-6's native handler for `/ws/terminal/{workspace_id}`
// (backend/main.py's websocket_terminal), wired into server.ts's upgrade handler the same way
// AGT-6's agents/ws.ts already is: a special-cased check ahead of the generic native-501
// rejection, gated on the route table saying "terminal" is native (see server.ts's own comment on
// why a name with no HTTP surface still needs this instead of split.ts's whole-name table -- there
// is no /api/terminal/* REST surface at all, only this one WS shape, matching browser-screencast's
// precedent of a name that's WS-only).
//
// Auth (token + origin) is NOT this file's job -- server.ts's wsRequestAuthOk already gated the
// upgrade before this function is ever called, same cross-cutting-concern split
// auth/middleware.ts's header describes for the HTTP side.
//
// Frame shapes are pinned by contract/ws/terminal.ts -- term:status once on connect, term:output
// per PTY output chunk (base64, because PTY output is raw bytes and a UTF-8 sequence can straddle
// a read boundary), term:exit once the shell dies; term:input/term:resize are the only frames read
// back. No resume/seq_log here on purpose, matching the Python original and contract/ws/terminal.ts's
// own header -- a terminal's reconnect contract is just "hand me the current scrollback"
// (PtySession.subscribe() replays the ring buffer synchronously before this function ever returns).
//
// Deliberate simplification vs. backend/main.py's websocket_terminal: the Python route bridges a
// sync subscribe() callback into an asyncio.Queue plus two concurrently-awaited sender/receiver
// tasks, because asyncio requires an explicit hop to get from a callback back into `await
// websocket.send_text(...)`. Node's `ws` has no such split -- `WebSocket.send()` is callable
// directly from the sync subscribe() callback -- so there is no queue and no second task here;
// the send-on-chunk and receive-on-message paths are just two event listeners on the same object,
// same as AGT-6's agents/ws.ts already established for a different WS name.

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { TerminalWsServerEvent } from '../../../../contract/ws/terminal';
import { manager } from './manager';
import { terminalCwd } from './workspaceCwd';

interface ParsedTerminalPath {
  workspaceId: string;
  instance: number;
}

function parseTerminalPath(url: string | undefined): ParsedTerminalPath | null {
  const [pathname, query] = (url ?? '/').split('?');
  const m = /^\/ws\/terminal\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const workspaceId = decodeURIComponent(m[1]);
  const rawInstance = new URLSearchParams(query ?? '').get('instance');
  const parsedInstance = rawInstance !== null ? Number(rawInstance) : NaN;
  const instance = Number.isInteger(parsedInstance) ? parsedInstance : 1;
  return { workspaceId, instance };
}

function sendFrame(ws: WebSocket, frame: TerminalWsServerEvent): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // best-effort -- matches send_to_session/replay_to's own "will retry on reconnect" stance
    // elsewhere in this codebase (see agents/ws.ts's toAgentSocket.send for the same convention)
  }
}

/** Completes a WS upgrade for `/ws/terminal/{workspace_id}` and wires it to the shared PtySessionManager
 * singleton. Returns false (socket left untouched) for anything not matching that exact path shape
 * so the caller (server.ts) can fall back to its normal native/proxy decision, mirroring
 * handleAgentsWsUpgrade's own contract. */
export function handleTerminalWsUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
  const parsed = parseTerminalPath(req.url);
  if (!parsed) return false;
  const { workspaceId, instance } = parsed;

  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = manager.attach(workspaceId, instance, terminalCwd(workspaceId));

    // Subscribe BEFORE sending term:status, same ordering as the Python original (subscribe()
    // replays the ring buffer synchronously first, so a reconnect never misses output that arrived
    // between the previous socket's close and this one's open).
    const unsubscribe = session.subscribe((chunk) => {
      if (chunk.length === 0) {
        sendFrame(ws, { event: 'term:exit', data: { code: session.exitCode ?? 0 } });
        return;
      }
      sendFrame(ws, { event: 'term:output', data: { data: chunk.toString('base64') } });
    });

    sendFrame(ws, {
      event: 'term:status',
      data: { running: session.running, shell: session.shell, cwd: session.cwd },
    });

    ws.on('message', (raw: RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // malformed frame from the client -- drop it, must not take down the shell
      }
      if (typeof msg !== 'object' || msg === null) return;
      const { event, data } = msg as { event?: unknown; data?: unknown };
      const payload = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

      if (event === 'term:input') {
        const raw64 = typeof payload.data === 'string' ? payload.data : '';
        // Buffer.from(..., 'base64') is permissive (never throws on malformed input, unlike
        // Python's base64.b64decode) -- an accepted platform difference, not a scope cut: worst
        // case a corrupt frame writes garbage bytes to the shell instead of being silently dropped,
        // no crash either way.
        session.write(Buffer.from(raw64, 'base64'));
      } else if (event === 'term:resize') {
        const cols = Number(payload.cols ?? 80);
        const rows = Number(payload.rows ?? 24);
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
          try {
            session.resize(cols || 80, rows || 24);
          } catch {
            // resize on an already-exited pty -- drop, same as the Python route's bare except
          }
        }
      }
    });

    ws.on('close', () => {
      unsubscribe();
      // Detach, never stop: the shell must outlive the socket so a tab switch or renderer reload
      // resumes the same session.
      manager.detach(workspaceId, instance);
    });
  });
  return true;
}
