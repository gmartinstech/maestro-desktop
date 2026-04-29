import { store } from '../state/store';
import {
  updateSession,
  updateSessionName,
  updateGroupMeta,
  addMessage,
  streamStart,
  streamDelta,
  streamEnd,
  addApprovalRequest,
  removeApprovalRequest,
  updateSessionStatus,
  updateSessionCost,
  updateSessionContext,
  setContextOverflow,
  setMcpSuggestions,
  addBranch,
  setActiveBranch,
  closeSessionFromWs,
  trackAgentNotification,
  setSessionConnState,
  fetchSession,
} from '../state/agentsSlice';
import { addBrowserCardFromBackend, removeBrowserCard, setBrowserCardPosition, setGlowingBrowserCards, GRID_GAP } from '../state/dashboardLayoutSlice';
import { getAuthToken } from '../config';

// Thin wrapper around getAuthToken so the connect() call site stays
// synchronous. If the token isn't cached yet, returns '' and the WS
// handshake will 4401 — onclose catches that and refreshes the token
// before the next reconnect.
const _getAuthTokenSafe = (): string => {
  try { return getAuthToken() || ''; } catch { return ''; }
};

const _genUuid = (): string => {
  // Avoid pulling in `crypto.randomUUID` for compat — this is a
  // disambiguator, not a security boundary, so a 96-bit hex string is
  // plenty.
  const a = Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0');
  const b = Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0');
  const c = Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0');
  return `${a}${b}${c}`;
};

type WSEvent = {
  event: string;
  session_id?: string;
  data: Record<string, any>;
  seq?: number;
};

interface WSManagerOptions {
  skipStreamEvents?: boolean;
  // Session-scoped WSes opt into resume + connection-state dispatches
  // by passing this. Dashboard WS doesn't.
  sessionId?: string;
}

// Heartbeat tuning. 25s is below typical aggressive NAT idle timeouts
// (some enterprise firewalls drop after 30s of silence), and well
// below browser-tab background throttling thresholds. 10s pong
// timeout is a balance: long enough to tolerate flaky cellular RTT
// spikes, short enough that a real dead socket reconnects fast.
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

interface QueuedFrame {
  event: string;
  data: Record<string, any>;
  // Lets the future server-side dedup index match retries to
  // originals. Today the server treats most events idempotently
  // anyway (stop on stopped is a no-op), but the client sends this
  // forward-compatibly so a future server upgrade is safe without a
  // protocol bump.
  client_msg_id: string;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private skipStreamEvents: boolean;
  private sessionId: string | null;

  // Resume state. lastSeq is the highest server-assigned seq this
  // client has applied; it's sent on every (re)connect so the server
  // can replay missed events. Persists for the lifetime of this
  // WebSocketManager instance — when the user navigates away and a
  // new createSessionWs() is constructed, lastSeq starts at 0 and we
  // get a full replay.
  private connectionUuid: string;
  private lastSeq: number = 0;
  private resumeAcked: boolean = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  // Set to true by `disconnect()` so we don't reconnect after an
  // explicit close (component unmount / user clicks Close).
  private explicitlyClosed: boolean = false;

  // Heartbeat. We send a ping on a fixed cadence and arm a timeout
  // for the pong; if the timeout fires, we force-close the socket so
  // `onclose` triggers reconnect. Detects laptop-sleep / NAT-drop
  // silent failures that wouldn't otherwise surface until the next
  // outbound send.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Outbound queue. Frames the user enqueues while the WS isn't
  // OPEN — or while OPEN but pre-resume-ack — wait here and flush
  // after the resume handshake completes. Queue is in-memory only:
  // surviving a full app restart isn't worth the localStorage
  // complexity given how rare that case is for a transient drop.
  private outboundQueue: QueuedFrame[] = [];

  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private interpolatorState: Map<string, { sessionId: string; messageId: string; targetText: string; displayedLength: number }> = new Map();
  private interpolatorRafId: number | null = null;

  constructor(url: string, options?: WSManagerOptions) {
    this.url = url;
    this.skipStreamEvents = options?.skipStreamEvents ?? false;
    this.sessionId = options?.sessionId ?? null;
    this.connectionUuid = _genUuid();
  }

  private bufferDelta(sessionId: string, messageId: string, delta: string) {
    const existing = this.interpolatorState.get(messageId);
    if (existing) {
      existing.targetText += delta;
    } else {
      this.interpolatorState.set(messageId, { sessionId, messageId, targetText: delta, displayedLength: 0 });
    }
    this.scheduleInterpolator();
  }

  private scheduleInterpolator() {
    if (this.interpolatorRafId != null) return;
    this.interpolatorRafId = requestAnimationFrame(() => this.tickInterpolator());
  }

  // Drain each message's pending text at a paced, roughly-uniform rate so
  // bursty server emissions paint as a smooth stream of characters instead of
  // visible chunks. Rate adapts to backlog: small backlog → ~2 chars/frame
  // (~120cps, typewriter feel); large backlog → up to 40 chars/frame so we
  // catch up fast without pinning the main thread.
  private tickInterpolator() {
    this.interpolatorRafId = null;
    let workRemaining = false;
    for (const state of this.interpolatorState.values()) {
      const remaining = state.targetText.length - state.displayedLength;
      if (remaining <= 0) continue;
      const step = Math.min(Math.max(Math.ceil(remaining / 6), 2), 40);
      const nextLength = Math.min(state.displayedLength + step, state.targetText.length);
      const deltaSlice = state.targetText.slice(state.displayedLength, nextLength);
      state.displayedLength = nextLength;
      store.dispatch(streamDelta({ sessionId: state.sessionId, messageId: state.messageId, delta: deltaSlice }));
      if (state.displayedLength < state.targetText.length) workRemaining = true;
    }
    if (workRemaining) this.scheduleInterpolator();
  }

  // Flush remaining pending text synchronously. Pass a messageId to flush
  // only that stream (used on stream_end so the tail isn't paced).
  private flushInterpolator(messageId?: string) {
    const drain = (state: { sessionId: string; messageId: string; targetText: string; displayedLength: number }) => {
      if (state.displayedLength >= state.targetText.length) return;
      const tail = state.targetText.slice(state.displayedLength);
      state.displayedLength = state.targetText.length;
      store.dispatch(streamDelta({ sessionId: state.sessionId, messageId: state.messageId, delta: tail }));
    };
    if (messageId) {
      const state = this.interpolatorState.get(messageId);
      if (state) {
        drain(state);
        this.interpolatorState.delete(messageId);
      }
    } else {
      for (const state of this.interpolatorState.values()) drain(state);
      this.interpolatorState.clear();
    }
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.explicitlyClosed = false;

    // Append our per-install auth token to the URL. The backend's WS
    // handshake validates this before accepting; without it, any
    // webpage loaded on the same machine could open a WS and read
    // agent traffic. See backend/auth.py + main.py:_ws_auth_ok.
    const token = _getAuthTokenSafe();
    const sep = this.url.includes('?') ? '&' : '?';
    const urlWithToken = token ? `${this.url}${sep}token=${encodeURIComponent(token)}` : this.url;
    this.ws = new WebSocket(urlWithToken);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.resumeAcked = false;
      this.startHeartbeat();
      // Send hello immediately so the server can replay anything the
      // server sent that we never applied. On a fresh session,
      // last_seq=0 → server replays from buffer start (empty) and
      // we proceed normally.
      if (this.sessionId) {
        this.sendRaw('client:hello', {
          session_id: this.sessionId,
          connection_uuid: this.connectionUuid,
          last_seq: this.lastSeq,
        });
      } else {
        // Dashboard / global WS: no resume, queue can flush right away.
        this.resumeAcked = true;
        this.flushQueue();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WSEvent = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (ev) => {
      this.stopHeartbeat();
      // 4401 = our backend's auth-failure code. Happens on stale token
      // after backend restart (dev hot-reload). Re-fetch from Electron
      // IPC before retrying.
      if (ev && ev.code === 4401) {
        import('@/shared/config').then(mod => mod.refreshAuthToken().catch(() => {}));
      }
      // Mark UI as reconnecting so the run card shows a clear
      // "trying to reconnect" state rather than implying the run
      // died. Skipped on an explicit disconnect (user navigated
      // away) since there's no run to surface state for.
      if (this.sessionId && !this.explicitlyClosed) {
        store.dispatch(setSessionConnState({
          sessionId: this.sessionId,
          state: 'reconnecting',
        }));
      }
      if (!this.explicitlyClosed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Force the close path to run — onclose will mark state
      // reconnecting and schedule a retry.
      this.ws?.close();
    };
  }

  disconnect() {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.interpolatorRafId != null) {
      cancelAnimationFrame(this.interpolatorRafId);
      this.interpolatorRafId = null;
    }
    this.flushInterpolator();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // No retry cap. Long-horizon agent runs may outlast a multi-hour
    // network outage (overnight laptop sleep, captive portal limbo);
    // giving up would silently desync the UI. Backoff is bounded at
    // 30s so the user-visible "Reconnecting…" loop never hammers the
    // network, and a small jitter prevents thundering-herd if many
    // session WSes reconnect at once after a backend restart.
    const jitter = 0.8 + Math.random() * 0.4; // ±20%
    const delay = Math.min(this.reconnectDelay, this.maxReconnectDelay) * jitter;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer != null) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private sendPing() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const nonce = _genUuid();
    try {
      this.ws.send(JSON.stringify({ event: 'client:ping', data: { nonce } }));
    } catch {
      // socket dying — let the close handler take over
      return;
    }
    if (this.pongTimeoutTimer != null) clearTimeout(this.pongTimeoutTimer);
    this.pongTimeoutTimer = setTimeout(() => {
      // Silent death: no pong arrived in time. Force a close so the
      // browser's onclose path (and our reconnect) runs immediately
      // instead of waiting for the OS TCP keepalive (~75s).
      try { this.ws?.close(); } catch { /* nothing */ }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearPongTimeout() {
    if (this.pongTimeoutTimer != null) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (!this.resumeAcked) return;
    const queue = this.outboundQueue;
    this.outboundQueue = [];
    for (const frame of queue) {
      try {
        this.ws.send(JSON.stringify({ event: frame.event, data: frame.data }));
      } catch {
        // Re-queue and bail; reconnect will retry.
        this.outboundQueue.unshift(frame);
        break;
      }
    }
  }

  // Direct send that bypasses the queue. Used for hello/ping which
  // must NOT be queued (they're connection-scoped, not session-data).
  private sendRaw(event: string, data: Record<string, any>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ event, data })); } catch { /* nothing */ }
  }

  private handleMessage(msg: WSEvent) {
    const { event, session_id, data } = msg;

    // Update lastSeq for events that carry one. seq is monotonic per
    // session, so this is the high-water mark we send back on resume.
    if (typeof msg.seq === 'number' && msg.seq > this.lastSeq) {
      this.lastSeq = msg.seq;
    }

    // ----- Connection-scoped frames (no business-logic side effects) -----

    if (event === 'server:pong') {
      this.clearPongTimeout();
      return;
    }

    if (event === 'server:hello') {
      // Resume handshake completed. The server has either replayed
      // missed events (which arrived as separate frames before this
      // ack), surfaced a gap, or signalled "you're caught up." Mark
      // ourselves live and flush any queued outbound frames.
      this.resumeAcked = true;
      if (this.sessionId) {
        store.dispatch(setSessionConnState({
          sessionId: this.sessionId,
          state: 'live',
        }));
      }
      this.flushQueue();
      return;
    }

    if (event === 'agent:gap_detected') {
      // We were offline long enough that the server's ring buffer
      // rolled past our lastSeq. Re-fetch authoritative state via
      // REST so the slice's view doesn't have a silent gap.
      if (session_id) {
        store.dispatch(fetchSession(session_id));
        // Reset lastSeq — the REST refetch is the new authoritative
        // baseline; subsequent server events with seq numbers will
        // re-establish the high-water mark.
        this.lastSeq = 0;
      }
      return;
    }

    if (this.skipStreamEvents) {
      if (event === 'agent:stream_start' || event === 'agent:stream_delta' || event === 'agent:stream_end') {
        return;
      }
    }

    switch (event) {
      case 'agent:status':
        if (data.session) {
          store.dispatch(updateSession(data.session));
        } else if (session_id) {
          store.dispatch(updateSessionStatus({ sessionId: session_id, status: data.status }));
        }
        if (data.status === 'running' && session_id) {
          store.dispatch(trackAgentNotification(session_id));
        }
        // Per-sub-agent close via browser_id; skip user-created cards (no spawned_by).
        if (
          (data.status === 'completed' || data.status === 'error') &&
          data.session?.mode === 'browser-agent'
        ) {
          const browserId = data.session.browser_id;
          if (browserId) {
            const card = store.getState().dashboardLayout.browserCards[browserId];
            if (card && card.spawned_by) {
              store.dispatch(removeBrowserCard(browserId));
            }
          }
        }
        break;

      case 'agent:message':
        if (session_id && data.message) {
          if (this.interpolatorState.size > 0) this.flushInterpolator();
          store.dispatch(addMessage({ sessionId: session_id, message: data.message }));
        }
        break;

      case 'agent:stream_start':
        if (session_id && data.message_id) {
          store.dispatch(streamStart({
            sessionId: session_id,
            messageId: data.message_id,
            role: data.role,
            toolName: data.tool_name,
          }));
        }
        break;

      case 'agent:stream_delta':
        if (session_id && data.message_id) {
          this.bufferDelta(session_id, data.message_id, data.delta);
        }
        break;

      case 'agent:stream_end':
        if (session_id && data.message_id) {
          this.flushInterpolator(data.message_id);
          store.dispatch(streamEnd({
            sessionId: session_id,
            messageId: data.message_id,
          }));
        }
        break;

      case 'agent:approval_request':
        if (session_id) {
          store.dispatch(addApprovalRequest({
            sessionId: session_id,
            request: {
              id: data.request_id,
              session_id: session_id,
              tool_name: data.tool_name,
              tool_input: data.tool_input,
              created_at: new Date().toISOString(),
            },
          }));
        }
        break;

      case 'agent:cost_update':
        if (session_id) {
          store.dispatch(updateSessionCost({
            sessionId: session_id,
            costUsd: data.cost_usd,
          }));
        }
        break;

      case 'agent:context_update':
        if (session_id) {
          store.dispatch(updateSessionContext({
            sessionId: session_id,
            inputTokens: data.input_tokens ?? 0,
            outputTokens: data.output_tokens ?? 0,
            cacheReadTokens: data.cache_read_tokens ?? 0,
            cacheReadPct: data.cache_read_pct ?? 0,
            ctxUsedPct: data.ctx_used_pct ?? 0,
            activeMcps: Array.isArray(data.active_mcps) ? data.active_mcps : [],
          }));
        }
        break;

      case 'agent:context_overflow':
        if (session_id) {
          store.dispatch(setContextOverflow({
            sessionId: session_id,
            reason: data.reason ?? 'long_context_required',
            message: data.message ?? 'Context full.',
          }));
        }
        break;

      case 'agent:auth_error':
        // Re-uses the context_overflow card slot — both are "this session is
        // blocked, here's what to do" cards. Reason field disambiguates.
        if (session_id) {
          store.dispatch(setContextOverflow({
            sessionId: session_id,
            reason: data.reason ?? 'auth_error',
            message: data.message ?? 'Authentication failed.',
          }));
        }
        break;

      case 'agent:mcp_suggestions':
        if (session_id) {
          store.dispatch(setMcpSuggestions({
            sessionId: session_id,
            suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
            isVague: !!data.is_vague,
          }));
        }
        break;

      case 'agent:branch_created':
        if (session_id && data.branch) {
          store.dispatch(addBranch({ sessionId: session_id, branch: data.branch }));
          store.dispatch(setActiveBranch({ sessionId: session_id, branchId: data.active_branch_id }));
        }
        break;

      case 'agent:branch_switched':
        if (session_id) {
          store.dispatch(setActiveBranch({ sessionId: session_id, branchId: data.active_branch_id }));
        }
        break;

      case 'agent:name_updated':
        if (session_id && data.name) {
          store.dispatch(updateSessionName({ sessionId: session_id, name: data.name }));
        }
        break;

      case 'agent:group_meta_updated':
        if (session_id && data.group_id) {
          store.dispatch(updateGroupMeta({
            sessionId: session_id,
            groupId: data.group_id,
            name: data.name ?? '',
            svg: data.svg ?? '',
            isRefined: data.is_refined ?? false,
          }));
        }
        break;

      case 'agent:closed':
        if (session_id) {
          const closedStatus = data.status ?? 'stopped';
          store.dispatch(closeSessionFromWs({
            id: session_id,
            name: data.name ?? 'Untitled',
            status: closedStatus,
            model: data.model ?? '',
            mode: data.mode ?? '',
            created_at: data.created_at ?? new Date().toISOString(),
            closed_at: data.closed_at ?? new Date().toISOString(),
            cost_usd: data.cost_usd ?? 0,
            dashboard_id: data.dashboard_id,
          }));
          // Auto-delete browsers spawned by this agent when it finishes
          // normally or errors out. We intentionally skip 'stopped' — the
          // user may want to inspect the browser after manually stopping.
          if (closedStatus === 'completed' || closedStatus === 'error') {
            const browserCards = store.getState().dashboardLayout.browserCards;
            for (const card of Object.values(browserCards)) {
              if (card.spawned_by === session_id) {
                store.dispatch(removeBrowserCard(card.browser_id));
              }
            }
          }
        }
        break;

      case 'dashboard:browser_card_added':
        if (data.browser_card) {
          store.dispatch(addBrowserCardFromBackend(data.browser_card));
          const parentId = data.parent_session_id;
          if (parentId) {
            const layoutState = store.getState().dashboardLayout;
            const parentCard = layoutState.cards[parentId];
            if (parentCard) {
              const targetX = parentCard.x + parentCard.width + GRID_GAP * 12;
              let targetY = parentCard.y;
              const columnCards = Object.values(layoutState.browserCards).filter(
                (c) => Math.abs(c.x - targetX) < 50 && c.browser_id !== data.browser_card.browser_id,
              );
              if (columnCards.length > 0) {
                const lowestBottom = Math.max(...columnCards.map((c) => c.y + c.height));
                targetY = lowestBottom + GRID_GAP;
              }
              store.dispatch(setBrowserCardPosition({
                browserId: data.browser_card.browser_id,
                x: targetX,
                y: targetY,
              }));
              store.dispatch(setGlowingBrowserCards({
                browserIds: [data.browser_card.browser_id],
                sessionId: parentId,
                label: 'Use Browser',
              }));
            }
          }
        }
        break;
    }

    // Notify any custom listeners
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => fn({ session_id, ...data }));
    }
  }

  send(event: string, data: Record<string, any>) {
    // Queue if the socket isn't open OR resume hasn't been ack'd yet.
    // The pre-ack gate prevents an outbound user message from racing
    // the resume replay — the server might process the message
    // before the replay finishes, leaving the slice's view of
    // history incomplete.
    const open = this.ws?.readyState === WebSocket.OPEN;
    if (!open || !this.resumeAcked) {
      this.outboundQueue.push({ event, data, client_msg_id: _genUuid() });
      return;
    }
    try {
      this.ws!.send(JSON.stringify({ event, data }));
    } catch {
      this.outboundQueue.push({ event, data, client_msg_id: _genUuid() });
    }
  }

  sendMessage(
    sessionId: string,
    prompt: string,
    opts?: { mode?: string; model?: string; provider?: string; images?: Array<{ data: string; media_type: string }> },
  ) {
    this.send('agent:send_message', {
      session_id: sessionId,
      prompt,
      ...opts,
    });
  }

  sendApproval(requestId: string, behavior: 'allow' | 'deny', message?: string) {
    this.send('agent:approval_response', {
      request_id: requestId,
      behavior,
      message,
    });
  }

  stopAgent(sessionId: string) {
    this.send('agent:stop', { session_id: sessionId });
  }

  on(event: string, handler: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

import { WS_BASE } from '@/shared/config';

export const dashboardWs = new WebSocketManager(`${WS_BASE}/ws/dashboard`, { skipStreamEvents: true });

export function createSessionWs(sessionId: string): WebSocketManager {
  return new WebSocketManager(`${WS_BASE}/ws/agents/${sessionId}`, { sessionId });
}

export default WebSocketManager;
