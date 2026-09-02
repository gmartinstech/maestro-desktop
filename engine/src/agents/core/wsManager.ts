// AGT-2: faithful TypeScript port of backend/apps/agents/core/ws_manager.py's ConnectionManager,
// folding in backend/apps/agents/core/seq_log.py's per-session sequencing/ring-buffer/terminal-
// persistence subsystem as this file's own AgentSeqLog (seq_log.py has no separate TS file in this
// ticket's scope -- ws_manager.py's own behavior is inseparable from it: every send/replay path
// goes straight through seq_log, so porting one without the other would port nothing testable).
//
// Contract typing: sendToSession's `event`/`data` pair is typed directly against
// contract/ws/agents.ts's AgentWsServerEvent union (see SessionEventName/SessionEventData below) --
// not a second, hand-rolled event-shape catalog. Getting a same-directory import of that file past
// engine/tsconfig.json's `rootDir: "src"` needed a real fix (a TS project reference to a new
// contract/tsconfig.json), not a workaround; see that file's header comment and
// engine/tsconfig.json's `references` entry for the mechanism, and this ticket's own status-ledger
// row for the exact build-order caveat it introduces.
//
// Deliberate scope cuts vs. the Python source (both because they depend on modules this ticket
// doesn't port, and because the GATE is emit-paths + resume/replay, not "every ConnectionManager
// method equally hardened"):
//   - The `agent:message` -> analytics bridge side effect (`backend.apps.service.analytics.
//     agent_bridge.bridge_agent_message`) is NOT ported. That module doesn't exist on the TS side
//     yet; whichever ticket ports backend/apps/service/analytics/ should wire it back in here.
//   - `websocket.accept()` has no port here. FastAPI's WebSocket needs an explicit accept() before
//     the first send; this file's AgentSocketLike is deliberately transport-agnostic (see below),
//     so accepting/upgrading a real socket is whatever engine route wires this in later (not yet
//     written) does before handing this class the socket.
//   - Constructing a FileTerminalEventStore no longer eagerly `mkdir`s its persist directory at
//     construction time the way seq_log.py's module-level `os.makedirs(persist_dir, exist_ok=True)`
//     does on import -- that would be a real side effect on every `import wsManager` (including
//     from a test that never touches disk). Deferred to first persist() call instead, same
//     best-effort try/catch either way.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import type { AgentWsServerEvent, WsAgentGapDetected, WsServerHello, WsServerPong } from '../../../../contract/ws/agents';

// ---------------------------------------------------------------------------------------------
// Contract-typed event surface for sendToSession
// ---------------------------------------------------------------------------------------------

// The three connection-scoped frames backend/main.py's WS handler writes directly (server:hello,
// server:pong) or replay_to writes directly (agent:gap_detected) -- none of these ever go through
// send_to_session/seq_log.stamp in the Python source, so they carry no `seq` and are excluded from
// the event names sendToSession accepts.
type ConnectionScopedEventName = WsServerHello['event'] | WsServerPong['event'] | WsAgentGapDetected['event'];

/** Every `agent:*` event name send_to_session can actually emit -- contract/ws/agents.ts's full
 * union minus the three connection-scoped frames above. */
export type SessionEventName = Exclude<AgentWsServerEvent['event'], ConnectionScopedEventName>;

/** The exact `data` shape contract/ws/agents.ts pins for a given session event name (both
 * `agent:status` shapes -- full and lite -- when `E` is `'agent:status'`). */
export type SessionEventData<E extends SessionEventName> = Extract<AgentWsServerEvent, { event: E }>['data'];

// ---------------------------------------------------------------------------------------------
// Socket DI surface -- deliberately narrower than any real WebSocket type so a unit test can hand
// in a plain fake, same spirit as engine/src/browser/screencast.ts's UiSocketLike.
// ---------------------------------------------------------------------------------------------

export interface AgentSocketLike {
  send(data: string): void | Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Per-session sequencing, ring buffer, and terminal-event persistence (ports seq_log.py)
// ---------------------------------------------------------------------------------------------

const RING_BUFFER_LIMIT = 500; // covers a ~30s drop even at ~20Hz thinking deltas (~50KB/session)
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'stopped', 'error']);

/** Chains async callers onto one another so only one runs at a time -- JS has no asyncio.Lock, but
 * the same need exists here: sendToSession's send loop runs real awaits while "holding" the lock
 * (mirroring seq_log.py's `async with log.lock` spanning the whole broadcast, not just the seq
 * bump), so two concurrent sendToSession calls for the same session really can interleave without
 * this. */
class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

interface SeqReplayResult {
  oldest: number | null;
  newest: number | null;
  events: string[];
}

class SessionSeqLog {
  seq = 0;
  private readonly buffer: Array<{ seq: number; payload: string }> = [];
  private readonly mutex = new AsyncMutex();

  /** Atomically assigns seq, buffers the payload, then runs `onStamped` (typically the send loop)
   * before releasing the lock -- matches seq_log.py's `stamp` context manager, whose body (the
   * caller's sends) executes INSIDE the lock, not after it. */
  stamp(sessionId: string, event: string, data: unknown, onStamped: (seq: number, payloadStr: string) => Promise<void>): Promise<void> {
    return this.mutex.withLock(async () => {
      this.seq += 1;
      const seq = this.seq;
      const payloadStr = JSON.stringify({ event, session_id: sessionId, data, seq });
      this.buffer.push({ seq, payload: payloadStr });
      if (this.buffer.length > RING_BUFFER_LIMIT) this.buffer.shift();
      await onStamped(seq, payloadStr);
    });
  }

  replay(lastSeq: number): SeqReplayResult {
    if (this.buffer.length === 0) return { oldest: null, newest: this.seq, events: [] };
    const oldest = this.buffer[0].seq;
    const newest = this.buffer[this.buffer.length - 1].seq;
    const events = this.buffer.filter((e) => e.seq > lastSeq).map((e) => e.payload);
    return { oldest, newest, events };
  }
}

/** Store for terminal (completed/stopped/error) `agent:status` snapshots, so a client reconnecting
 * after the process restarted (in-memory ring buffer gone) still sees the final state. Injectable
 * so tests never touch real disk. */
export interface TerminalEventStore {
  persist(sessionId: string, payloadStr: string): void;
  load(sessionId: string): string | null;
}

// Session ids are uuid4 hex; sanitized anyway against path traversal, same guard as seq_log.py's
// p_terminal_path.
function sanitizeSessionId(sessionId: string): string {
  return Array.from(sessionId)
    .filter((c) => /[A-Za-z0-9_-]/.test(c))
    .join('');
}

export class FileTerminalEventStore implements TerminalEventStore {
  constructor(private readonly persistDir: string = join(resolveDataRoot(), 'agents', 'terminal_events')) {}

  private pathFor(sessionId: string): string | null {
    const safe = sanitizeSessionId(sessionId);
    return safe ? join(this.persistDir, `${safe}.json`) : null;
  }

  persist(sessionId: string, payloadStr: string): void {
    const path = this.pathFor(sessionId);
    if (!path) return;
    try {
      mkdirSync(this.persistDir, { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, payloadStr, 'utf-8');
      renameSync(tmp, path); // atomic swap, matches seq_log.py's os.replace
    } catch {
      // best-effort; never blocks the broadcast (matches seq_log.py's persist_terminal)
    }
  }

  load(sessionId: string): string | null {
    const path = this.pathFor(sessionId);
    if (!path || !existsSync(path)) return null;
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return null;
    }
  }
}

/** Process-wide seq/ring-buffer store, one SessionSeqLog per session id. Ports seq_log.py's
 * SeqLogStore. No `p_dict_lock` equivalent: the Python version double-checks under a lock because
 * an `await` between the unlocked check and the locked re-check lets another coroutine interleave;
 * this method has no `await` anywhere in it, so in JS's single-threaded model the plain
 * check-then-set below is already atomic. */
export class AgentSeqLog {
  private readonly perSession = new Map<string, SessionSeqLog>();

  private getOrCreate(sessionId: string): SessionSeqLog {
    let log = this.perSession.get(sessionId);
    if (!log) {
      log = new SessionSeqLog();
      this.perSession.set(sessionId, log);
    }
    return log;
  }

  stamp(sessionId: string, event: string, data: unknown, onStamped: (seq: number, payloadStr: string) => Promise<void>): Promise<void> {
    return this.getOrCreate(sessionId).stamp(sessionId, event, data, onStamped);
  }

  replay(sessionId: string, lastSeq: number): SeqReplayResult {
    const log = this.perSession.get(sessionId);
    return log ? log.replay(lastSeq) : { oldest: null, newest: null, events: [] };
  }

  currentSeq(sessionId: string): number {
    return this.perSession.get(sessionId)?.seq ?? 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Approval / browser-command deferred promises (JS analog of asyncio.Future)
// ---------------------------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolveFn: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolveFn = (value: T) => {
      settled = true;
      resolve(value);
    };
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve: (value: T) => resolveFn(value),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Races `promise` against a plain timer without ever settling `promise` itself on timeout --
 * mirrors `asyncio.wait({future}, timeout=...)`, which leaves an unfinished future exactly as
 * pending as before the call (unlike Promise.race, which can't express "neither side wins yet"). */
function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, ms);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, value });
    });
  });
}

/** Poll up to WS_RECONNECT_WAIT_MS for a dashboard socket to (re)appear; bridges the brief gap a
 * CPU-starved renderer's missed heartbeat can leave before the frontend auto-reconnects. */
export async function awaitReconnect(hasConn: () => boolean): Promise<boolean> {
  if (hasConn()) return true;
  let waited = 0;
  while (waited < WS_RECONNECT_WAIT_MS) {
    await sleep(500);
    waited += 500;
    if (hasConn()) return true;
  }
  return hasConn();
}

// ---------------------------------------------------------------------------------------------
// Timing constants (ports ws_manager.py's module-level constants, seconds -> ms)
// ---------------------------------------------------------------------------------------------

const BROWSER_CMD_TIMEOUT_DEFAULT_MS = 15_000;
const BROWSER_CMD_TIMEOUTS_MS: Record<string, number> = {
  navigate: 25_000,
  replay_route: 20_000,
  wait: 12_000,
  perform_action: 35_000,
  browser_fetch: 32_000,
  browser_search: 45_000,
};
const BROWSER_CMD_REBROADCAST_MS = 3_000;
const WS_RECONNECT_WAIT_MS = 8_000;
const APPROVAL_DEFAULT_TIMEOUT_MS = 600_000;

function browserCmdTimeoutMs(action: string): number {
  return BROWSER_CMD_TIMEOUTS_MS[action] ?? BROWSER_CMD_TIMEOUT_DEFAULT_MS;
}

// ---------------------------------------------------------------------------------------------
// Public result/ack shapes
// ---------------------------------------------------------------------------------------------

/** replayTo's return value -- the ack embedded in server:hello's `data.ack` (see contract/ws/
 * agents.ts's WsServerHello). Four shapes, matching replay_to's four Python return statements
 * exactly. */
export type ReplayAck =
  | { ok: false; reason: 'gap'; oldest_seq: number | null; newest_seq: number | null }
  | { ok: true; replayed: number; from_seq: number; to_seq: number | null }
  | { ok: true; replayed: 1; terminal_only: true }
  | { ok: true; replayed: 0; current_seq: number };

export interface ApprovalDecision {
  behavior: 'allow' | 'deny';
  message?: string | null;
  updated_input?: Record<string, unknown> | null;
  trust_pattern?: boolean;
  // AGT-5 addition: mirrors backend/apps/agents/manager/permissions/ApprovalDecision.py's
  // `set_always_allow` field, which decision.py's request_user_approval reads to persist an
  // "Always approve" choice as the tool's policy. Optional so every existing caller of this
  // interface (constructed without it) still satisfies the type.
  set_always_allow?: boolean;
}

export interface SensitiveApprovalMeta {
  sensitivePattern?: string;
  sensitiveLabel?: string;
  sensitiveWhy?: string;
  timeoutMs?: number;
}

export type BrowserCommandResult = Record<string, unknown>;

export interface ConnectionManagerDeps {
  seqLog?: AgentSeqLog;
  terminalStore?: TerminalEventStore;
}

// ---------------------------------------------------------------------------------------------
// ConnectionManager (ports ws_manager.py's ConnectionManager)
// ---------------------------------------------------------------------------------------------

export class ConnectionManager {
  private readonly sessionConnections = new Map<string, Set<AgentSocketLike>>();
  private readonly globalConnectionsSet = new Set<AgentSocketLike>();
  // Which dashboard each global socket is currently showing; last activation wins (the window the
  // user is looking at most recently is where a scheduled run's browser card spawns).
  private readonly globalDashboardIds = new Map<AgentSocketLike, string>();
  private activeDashboardIdValue: string | null = null;
  private readonly pendingApprovals = new Map<string, Deferred<ApprovalDecision>>();
  private readonly browserFutures = new Map<string, Deferred<BrowserCommandResult>>();
  // The Electron/Tauri MAIN process (not the renderer) holds a single socket here; cookie reads
  // route to it so they don't ride the renderer, which the OS can throttle when backgrounded.
  private mainConnectionSocket: AgentSocketLike | null = null;
  private readonly seqLog: AgentSeqLog;
  private readonly terminalStore: TerminalEventStore;

  constructor(deps: ConnectionManagerDeps = {}) {
    this.seqLog = deps.seqLog ?? new AgentSeqLog();
    this.terminalStore = deps.terminalStore ?? new FileTerminalEventStore();
  }

  get activeDashboardId(): string | null {
    return this.activeDashboardIdValue;
  }

  // -- connection registry -----------------------------------------------------------------
  // No accept()/upgrade step here -- see file header. The caller hands this class an
  // already-open AgentSocketLike.

  connectSession(sessionId: string, socket: AgentSocketLike): void {
    let set = this.sessionConnections.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionConnections.set(sessionId, set);
    }
    set.add(socket);
  }

  disconnectSession(sessionId: string, socket: AgentSocketLike): void {
    const set = this.sessionConnections.get(sessionId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.sessionConnections.delete(sessionId);
  }

  connectGlobal(socket: AgentSocketLike): void {
    this.globalConnectionsSet.add(socket);
  }

  connectMain(socket: AgentSocketLike): void {
    this.mainConnectionSocket = socket;
  }

  disconnectMain(socket: AgentSocketLike): void {
    if (this.mainConnectionSocket === socket) this.mainConnectionSocket = null;
  }

  setActiveDashboard(socket: AgentSocketLike, dashboardId: string): void {
    this.globalDashboardIds.set(socket, dashboardId);
    this.activeDashboardIdValue = dashboardId;
  }

  disconnectGlobal(socket: AgentSocketLike): void {
    this.globalConnectionsSet.delete(socket);
    this.globalDashboardIds.delete(socket);
    // Drop this socket's active-dashboard pointer; if it owned the global one, fall back to any
    // window still connected so a closed tab doesn't leave a stale target.
    const remaining = [...this.globalDashboardIds.values()];
    if (this.activeDashboardIdValue === null || !remaining.includes(this.activeDashboardIdValue)) {
      this.activeDashboardIdValue = remaining[0] ?? null;
    }
  }

  // -- session broadcast + resume/replay ---------------------------------------------------

  /** Broadcasts a session event with monotonic sequencing; terminal statuses also persist to
   * disk. `event`/`data` are typed directly against contract/ws/agents.ts -- see SessionEventName/
   * SessionEventData at the top of this file. */
  async sendToSession<E extends SessionEventName>(sessionId: string, event: E, data: SessionEventData<E>): Promise<void> {
    await this.seqLog.stamp(sessionId, event, data, async (_seq, payloadStr) => {
      for (const ws of [...(this.sessionConnections.get(sessionId) ?? [])]) {
        try {
          await ws.send(payloadStr);
        } catch {
          // will retry on reconnect
        }
      }
      for (const ws of [...this.globalConnectionsSet]) {
        try {
          await ws.send(payloadStr);
        } catch {
          // dashboard socket may be dead; broadcastGlobal's callers reap those, not this path
        }
      }
      // Persisted under the stamp lock so a concurrent running-status update can't race past and
      // overwrite with stale state.
      if ((event as string) === 'agent:status') {
        const status = (data as Record<string, unknown>).status;
        if (typeof status === 'string' && TERMINAL_STATUSES.has(status)) {
          this.terminalStore.persist(sessionId, payloadStr);
        }
      }
    });
    // Analytics bridge for agent:message is deliberately NOT ported here -- see file header.
  }

  /** Replays buffered events with seq > lastSeq to a (re)connecting socket; returns the ack
   * embedded in the resume handshake's server:hello. Ports replay_to faithfully, including its
   * "stop sending on the first failed send but still report the full filtered count" behavior. */
  async replayTo(sessionId: string, socket: AgentSocketLike, lastSeq: number): Promise<ReplayAck> {
    const { oldest, newest, events } = this.seqLog.replay(sessionId, lastSeq);

    // Gap-check first: lastSeq predating the buffer means the client missed events this process
    // can no longer replay; lastSeq=0 means a fresh client (full replay), never a gap.
    if (lastSeq > 0 && oldest !== null && lastSeq < oldest - 1) {
      const gapPayload: WsAgentGapDetected = {
        event: 'agent:gap_detected',
        session_id: sessionId,
        data: { session_id: sessionId, oldest_seq: oldest, newest_seq: newest, client_seq: lastSeq },
      };
      try {
        await socket.send(JSON.stringify(gapPayload));
      } catch {
        // best-effort
      }
      return { ok: false, reason: 'gap', oldest_seq: oldest, newest_seq: newest };
    }

    if (events.length > 0) {
      const filtered = this.stripReplayedCloses(this.filterStaleApprovals(events));
      for (const payloadStr of filtered) {
        try {
          await socket.send(payloadStr);
        } catch {
          break; // matches replay_to: stop sending, but the ack below still reports the full count
        }
      }
      return { ok: true, replayed: filtered.length, from_seq: lastSeq, to_seq: newest };
    }

    const terminal = this.terminalStore.load(sessionId);
    if (terminal !== null) {
      try {
        await socket.send(terminal);
      } catch {
        // best-effort
      }
      return { ok: true, replayed: 1, terminal_only: true };
    }

    return { ok: true, replayed: 0, current_seq: newest ?? 0 };
  }

  currentSeq(sessionId: string): number {
    return this.seqLog.currentSeq(sessionId);
  }

  /** Drops `agent:approval_request` events whose request_id is no longer pending. The ring buffer
   * holds every event ever stamped, including resolved approvals; without this filter, a client
   * reconnecting with last_seq=0 (e.g. re-mounting after navigating away) would re-fire every past
   * approval as a dead no-op card. "in pendingApprovals" is authoritative: sendApprovalRequest
   * inserts BEFORE stamping the event, and resolveApproval/timeout always remove it after. */
  private filterStaleApprovals(events: string[]): string[] {
    const alive = this.pendingApprovals;
    const out: string[] = [];
    for (const payloadStr of events) {
      const parsed = parseJsonObject(payloadStr);
      if (!parsed) {
        out.push(payloadStr);
        continue;
      }
      if (parsed.event !== 'agent:approval_request') {
        out.push(payloadStr);
        continue;
      }
      const data = (parsed.data as Record<string, unknown> | undefined) ?? {};
      const requestId = data.request_id;
      if (typeof requestId === 'string' && alive.has(requestId)) out.push(payloadStr);
    }
    return out;
  }

  /** Drops `agent:closed` from a replay buffer: it's a transition event ("session JUST closed")
   * whose frontend reducer destructively deletes the session from state. Replaying it on a fresh
   * client (e.g. opening the closed chat from history) would delete the very session being
   * opened; the current closed state is already conveyed by the REST hydrate plus the latest
   * agent:status in the replay, so suppressing the transition is non-lossy. */
  private stripReplayedCloses(events: string[]): string[] {
    const out: string[] = [];
    for (const payloadStr of events) {
      const parsed = parseJsonObject(payloadStr);
      if (parsed && parsed.event === 'agent:closed') continue;
      out.push(payloadStr);
    }
    return out;
  }

  // -- dashboard-wide broadcast (bypasses seq_log; dashboard resumes via full state refetch) --

  async broadcastGlobal(event: string, data: Record<string, unknown>): Promise<void> {
    const payloadStr = JSON.stringify({ event, data });
    const dead: AgentSocketLike[] = [];
    for (const ws of [...this.globalConnectionsSet]) {
      try {
        await ws.send(payloadStr);
      } catch {
        dead.push(ws);
      }
    }
    // A renderer that reloaded without a clean close leaves a half-open socket here; a command
    // broadcast into it is lost forever (the future then times out). Drop any failed send so the
    // next command only targets live renderers.
    for (const ws of dead) this.disconnectGlobal(ws);
  }

  // -- HITL approval bridging ---------------------------------------------------------------

  /** Sends an approval request and waits for the user's decision; a 10-minute default timeout
   * prevents a permanently parked turn. */
  async sendApprovalRequest(sessionId: string, requestId: string, toolName: string, toolInput: Record<string, unknown>, meta: SensitiveApprovalMeta = {}): Promise<ApprovalDecision> {
    const deferred = createDeferred<ApprovalDecision>();
    this.pendingApprovals.set(requestId, deferred);

    const payload: SessionEventData<'agent:approval_request'> = {
      request_id: requestId,
      tool_name: toolName,
      tool_input: toolInput,
      ...(meta.sensitivePattern ? { sensitive_pattern: meta.sensitivePattern, sensitive_label: meta.sensitiveLabel, sensitive_why: meta.sensitiveWhy } : {}),
    };
    await this.sendToSession(sessionId, 'agent:approval_request', payload);

    try {
      const won = await raceTimeout(deferred.promise, meta.timeoutMs ?? APPROVAL_DEFAULT_TIMEOUT_MS);
      if (!won.timedOut) return won.value;
      return { behavior: 'deny', message: 'Approval timed out' };
    } finally {
      this.pendingApprovals.delete(requestId);
    }
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): void {
    const deferred = this.pendingApprovals.get(requestId);
    if (deferred && !deferred.settled) deferred.resolve(decision);
  }

  // -- browser command bridging --------------------------------------------------------------

  /** Sends a browser command to the frontend and waits for the result, re-broadcasting until one
   * answers (a silently-dead dashboard socket can take up to ~35s of heartbeat to notice, and a
   * command sent into that gap would otherwise be lost forever). */
  async sendBrowserCommand(requestId: string, action: string, browserId: string, params: Record<string, unknown>, tabId = ''): Promise<BrowserCommandResult> {
    if (this.globalConnectionsSet.size === 0 && !(await awaitReconnect(() => this.globalConnectionsSet.size > 0))) {
      return { error: 'No dashboard is connected. Open the dashboard to use browser tools.' };
    }

    const deferred = createDeferred<BrowserCommandResult>();
    this.browserFutures.set(requestId, deferred);
    const payload = { request_id: requestId, action, browser_id: browserId, tab_id: tabId, params };

    try {
      const timeoutMs = browserCmdTimeoutMs(action);
      const deadline = Date.now() + timeoutMs;
      // The renderer dedupes by request_id, so re-sends on rebroadcast can't double-act.
      for (;;) {
        await this.broadcastGlobal('browser:command', payload);
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { error: 'Browser command timed out' };
        const won = await raceTimeout(deferred.promise, Math.min(BROWSER_CMD_REBROADCAST_MS, remaining));
        if (!won.timedOut) return won.value;
      }
    } finally {
      this.browserFutures.delete(requestId);
    }
  }

  /** Sends a command straight to the throttle-free main-process socket (cookie reads only);
   * returns a not-connected error so the caller can fall back to the renderer. */
  async sendMainCommand(requestId: string, action: string, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    const ws = this.mainConnectionSocket;
    if (ws === null) return { error: 'Electron main bridge not connected' };

    const deferred = createDeferred<BrowserCommandResult>();
    this.browserFutures.set(requestId, deferred);
    const payload = { request_id: requestId, action, browser_id: '', tab_id: '', params };
    try {
      await ws.send(JSON.stringify({ event: 'browser:command', data: payload }));
      const won = await raceTimeout(deferred.promise, browserCmdTimeoutMs(action));
      if (!won.timedOut) return won.value;
      return { error: 'Electron main bridge timed out' };
    } catch (e) {
      this.disconnectMain(ws);
      return { error: `Electron main bridge send failed: ${String(e)}` };
    } finally {
      this.browserFutures.delete(requestId);
    }
  }

  resolveBrowserCommand(requestId: string, result: BrowserCommandResult): void {
    const deferred = this.browserFutures.get(requestId);
    if (deferred && !deferred.settled) deferred.resolve(result);
  }
}

function parseJsonObject(payloadStr: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payloadStr);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const wsManager = new ConnectionManager();
