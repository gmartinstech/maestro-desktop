// engine/src/agents/ws.ts -- AGT-6's native handler for /ws/agents/{session_id} (backend/main.py's
// websocket_session), wired into server.ts's upgrade handler the same way browser/screencastServer.ts's
// handleBrowserScreencastUpgrade already is: a special-cased check ahead of the generic native-501
// rejection, gated on the route table saying "agents" is native (see server.ts's own comment on
// why a partial-native name needs this instead of split.ts's whole-name table).
//
// Auth (token + origin) is NOT this file's job -- server.ts's wsRequestAuthOk already gated the
// upgrade before this function is ever called, same cross-cutting-concern split
// auth/middleware.ts's header describes for the HTTP side.
//
// Ports backend/main.py's websocket_session handler body: the resume handshake (client:hello ->
// replay -> server:hello), the client:ping heartbeat, and the four turn-producing/controlling
// client events it dispatches to agent_manager. WebSocketDisconnect's only effect in the Python
// original is dropping the socket from the registry (the agent task keeps running) -- mirrored
// here by the 'close' listener doing exactly that and nothing else.

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { wsManager, type AgentSocketLike } from './core/wsManager';
import { agentManager } from './AgentManager';

function sessionIdFromPath(url: string | undefined): string | null {
  const path = (url ?? '/').split('?')[0];
  const m = /^\/ws\/agents\/([^/]+)$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function toAgentSocket(ws: WebSocket): AgentSocketLike {
  return {
    send(data: string) {
      try {
        ws.send(data);
      } catch {
        // best-effort -- matches replay_to/send_to_session's own "will retry on reconnect" stance
      }
    },
  };
}

async function dispatchClientEvent(sessionId: string, socket: AgentSocketLike, msg: Record<string, unknown>): Promise<void> {
  const event = msg.event;
  const data = (typeof msg.data === 'object' && msg.data !== null ? msg.data : {}) as Record<string, unknown>;

  if (event === 'client:hello') {
    const lastSeq = Number(data.last_seq ?? 0) || 0;
    const connectionUuid = typeof data.connection_uuid === 'string' ? data.connection_uuid : '';
    const ack = await wsManager.replayTo(sessionId, socket, lastSeq);
    await socket.send(JSON.stringify({
      event: 'server:hello',
      session_id: sessionId,
      data: { connection_uuid: connectionUuid, current_seq: wsManager.currentSeq(sessionId), ack },
    }));
    return;
  }

  if (event === 'client:ping') {
    await socket.send(JSON.stringify({ event: 'server:pong', session_id: sessionId, data: { nonce: data.nonce } }));
    return;
  }

  if (event === 'agent:send_message') {
    await agentManager.sendMessage(sessionId, typeof data.prompt === 'string' ? data.prompt : '', {
      mode: data.mode as string | undefined,
      model: data.model as string | undefined,
      images: data.images as Array<Record<string, unknown>> | undefined,
    });
    return;
  }

  if (event === 'agent:approval_response') {
    const requestId = typeof data.request_id === 'string' ? data.request_id : '';
    if (!requestId) return;
    agentManager.handleApproval(requestId, {
      behavior: data.behavior === 'allow' ? 'allow' : 'deny',
      message: (data.message as string | null) ?? null,
      updated_input: (data.updated_input as Record<string, unknown> | null) ?? null,
      trust_pattern: Boolean(data.trust_pattern),
      set_always_allow: Boolean(data.set_always_allow),
    });
    return;
  }

  if (event === 'agent:edit_message') {
    const messageId = typeof data.message_id === 'string' ? data.message_id : '';
    const content = typeof data.content === 'string' ? data.content : '';
    if (!messageId) return;
    await agentManager.editMessage(sessionId, messageId, content);
    return;
  }

  if (event === 'agent:stop') {
    await agentManager.stopAgent(sessionId);
  }
}

/** Completes a WS upgrade for `/ws/agents/{session_id}` and wires it to the AgentManager singleton.
 * Returns false (socket left untouched) for anything not matching that exact path shape so the
 * caller (server.ts) can fall back to its normal native/proxy decision -- there is only ever one WS
 * shape under the "agents" name, but the convention matches handleBrowserScreencastUpgrade's own
 * (parse first, only take the socket once the parse succeeds). */
export function handleAgentsWsUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
  const sessionId = sessionIdFromPath(req.url);
  if (!sessionId) return false;

  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (ws) => {
    const agentSocket = toAgentSocket(ws);
    wsManager.connectSession(sessionId, agentSocket);

    ws.on('message', (raw: RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // malformed frame from the client -- drop it, must not take down the session
      }
      if (typeof msg !== 'object' || msg === null) return;
      void dispatchClientEvent(sessionId, agentSocket, msg as Record<string, unknown>).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[agents] ws message handling failed for session ${sessionId}:`, err);
      });
    });

    ws.on('close', () => {
      // Only drops the socket from the registry -- the agent task (if any) keeps running, same as
      // backend/main.py's WebSocketDisconnect handler.
      wsManager.disconnectSession(sessionId, agentSocket);
    });
  });
  return true;
}
