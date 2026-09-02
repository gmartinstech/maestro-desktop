// engine/src/agents/manager/session/SessionLifecycle.ts -- AGT-5, a port of
// backend/apps/agents/manager/session/SessionLifecycle.py: session lifecycle + query methods.
// Python's version is a mixin reading/writing a shared AgentManager's `self.*` state across the
// MRO (see AgentManagerProtocol.py); this port has no class/mixin equivalent to reach for (the
// engine's AgentManager.ts is still the minimal AGT-3/4 mock-only seam, not yet the full stateful
// manager object Python's mixins assume exists) -- so each function below takes the specific state
// it needs as an explicit parameter instead of an implicit `self`. Whoever wires the real
// AgentManager.ts should call these with its own live Maps, the same way it already does for
// AgentLaunch.ts/contextBudget.ts/compactSession.ts in this same ticket.
//
// Persistence (`session_store.py`: load_all_session_data/save_session/delete_session_file/
// build_search_text) is NOT ported -- it's a real, non-trivial disk-format module of its own and
// out of this ticket's named file list. Every function that needs it takes the operation as a
// required dependency (no default) rather than silently no-op'ing, so a caller that doesn't wire
// persistence gets a loud missing-dependency error instead of a session that looks closed but was
// never saved. `resume_and_duplicate.py` (load_session_for_resume/build_duplicate_session) is the
// same story -- required DI, not stubbed, because inventing placeholder resume/duplicate logic
// would be untested behavior nobody asked for.

import type { AgentSession } from '../../core/models';
import { wsManager } from '../../core/wsManager';
import { viewBuilderDirtySessions, viewBuilderRenderRetryCounts } from '../viewBuilderState';
import { disposeClientSoon, type ClientHandle, type PooledClient } from '../run/clientPool';

export interface SessionLifecycleState {
  sessions: Map<string, AgentSession>;
  tasks: Map<string, { cancel(): void; done(): boolean } | undefined>;
  livePartial: Map<string, unknown>;
  cancelEvents: Map<string, { set(): void } | undefined>;
  hookCtxs: Map<string, unknown>;
  stderrBuffers: Map<string, unknown>;
  clientPool?: Map<string, ClientHandle<PooledClient>>;
}

/** True async wait until `task` settles (its `done()` starts returning true), polling instead of
 * `await`ing a real promise -- this port's `tasks` map deliberately stores a cancel/done handle,
 * not the promise itself (see the header: the engine has no concrete task-runner shape yet to
 * assume), so a real caller with an actual promise should just `await` it directly instead of
 * calling this. */
async function waitForTaskDone(task: { done(): boolean }, pollMs = 10): Promise<void> {
  while (!task.done()) await new Promise((r) => setTimeout(r, pollMs));
}

/** Drop a session from EVERY in-memory structure keyed by its id, so a close or delete can't
 * strand stale per-session state that lives until the process dies. One chokepoint on purpose: a
 * new per-session cache wires its eviction in HERE and both removal paths get it for free. */
export function purgeSessionMemory(state: SessionLifecycleState, sessionId: string): void {
  state.sessions.delete(sessionId);
  state.tasks.delete(sessionId);
  state.livePartial.delete(sessionId);
  state.cancelEvents.delete(sessionId);
  viewBuilderRenderRetryCounts.delete(sessionId);
  viewBuilderDirtySessions.delete(sessionId);
  if (state.clientPool) disposeClientSoon(state.clientPool, sessionId);
  state.hookCtxs.delete(sessionId);
  state.stderrBuffers.delete(sessionId);
}

export interface CloseSessionDeps {
  saveSession: (sessionId: string, docData: Record<string, unknown>) => void;
  buildSearchText?: (session: AgentSession, maxLen?: number) => string;
}

/** Close a session: pause the agent if running, persist it, and remove from in-memory state. Also
 * stops browser-agent children. `stopAgent` is DI'd (the running-turn cancellation path is
 * AgentManager.ts's own territory, not yet built out beyond the mock seam). */
export async function closeSession(
  state: SessionLifecycleState,
  sessionId: string,
  deps: CloseSessionDeps & { stopAgent?: (childId: string) => Promise<void> },
): Promise<void> {
  const children = [...state.sessions.values()].filter((s) => s.parent_session_id === sessionId && s.mode === 'browser-agent');
  for (const child of children) {
    await deps.stopAgent?.(child.id);
  }

  const task = state.tasks.get(sessionId);
  if (task && !task.done()) {
    task.cancel();
    await waitForTaskDone(task);
  }

  const session = state.sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (session.status === 'running' || session.status === 'waiting_approval') session.status = 'stopped';
  session.closed_at = new Date().toISOString();

  for (const req of [...session.pending_approvals]) {
    wsManager.resolveApproval(req.id, { behavior: 'deny', message: 'Session closed' });
  }
  session.pending_approvals = [];

  const ev = state.cancelEvents.get(sessionId);
  ev?.set();

  const docData: Record<string, unknown> = { ...session, search_text: deps.buildSearchText?.(session) };
  deps.saveSession(sessionId, docData);

  await wsManager.sendToSession(sessionId, 'agent:closed', {
    session_id: sessionId,
    status: session.status,
    name: session.name,
    model: session.model,
    mode: session.mode,
    created_at: session.created_at,
    closed_at: session.closed_at,
    cost_usd: session.cost_usd,
    dashboard_id: session.dashboard_id,
  } as never);

  purgeSessionMemory(state, sessionId);
}

/** Permanently delete a session: remove from memory and its persisted file. Also stops
 * browser-agent children first. */
export async function deleteSession(
  state: SessionLifecycleState,
  sessionId: string,
  deps: { deleteSessionFile: (sessionId: string) => void; stopAgent?: (childId: string) => Promise<void> },
): Promise<void> {
  const children = [...state.sessions.values()].filter((s) => s.parent_session_id === sessionId && s.mode === 'browser-agent');
  for (const child of children) {
    await deps.stopAgent?.(child.id);
  }

  const task = state.tasks.get(sessionId);
  if (task && !task.done()) {
    task.cancel();
    await waitForTaskDone(task);
  }

  purgeSessionMemory(state, sessionId);
  deps.deleteSessionFile(sessionId);
}

export function getSession(state: SessionLifecycleState, sessionId: string): AgentSession | undefined {
  return state.sessions.get(sessionId);
}

export interface HistoryPage {
  sessions: Array<Record<string, unknown>>;
  total: number;
  has_more: boolean;
}

/** Return paginated, optionally filtered summaries of closed sessions. `loadAllSessionData` is
 * required DI (session_store.py isn't ported -- see this file's header). */
export function getHistory(
  loadAllSessionData: () => Array<[string, Record<string, unknown>]>,
  opts: { q?: string; limit?: number; offset?: number; dashboardId?: string } = {},
): HistoryPage {
  const { q = '', limit = 20, offset = 0, dashboardId } = opts;
  const allData = loadAllSessionData().slice();
  allData.sort((a, b) => String(b[1].closed_at ?? '').localeCompare(String(a[1].closed_at ?? '')));

  const qLower = q.trim().toLowerCase();
  const history: Array<Record<string, unknown>> = [];
  for (const [sid, data] of allData) {
    if (dashboardId && data.dashboard_id !== dashboardId) continue;
    if (qLower) {
      const name = String(data.name ?? '').toLowerCase();
      const searchText = String(data.search_text ?? '').toLowerCase();
      if (!name.includes(qLower) && !searchText.includes(qLower)) continue;
    }
    history.push({
      id: data.id ?? sid,
      name: data.name ?? 'Untitled',
      status: data.status ?? 'stopped',
      model: data.model ?? 'sonnet',
      mode: data.mode ?? 'agent',
      created_at: data.created_at,
      closed_at: data.closed_at,
      cost_usd: data.cost_usd ?? 0,
      dashboard_id: data.dashboard_id,
    });
  }

  const total = history.length;
  const page = history.slice(offset, offset + limit);
  return { sessions: page, total, has_more: offset + limit < total };
}

/** In-memory-only slice of `get_all_sessions` -- the on-disk-promotion branch (promoting a
 * dashboard's persisted-but-not-yet-loaded sessions, filtered by the dashboard layout's card ids)
 * needs session_store.py + a dashboard-layout reader, both out of this ticket's scope; `loadFromDisk`
 * is required DI for that branch, defaulting to a no-op that returns nothing extra (matching "no
 * persistence wired" rather than silently promoting the wrong thing). */
export function getAllSessions(
  state: SessionLifecycleState,
  dashboardId?: string,
  loadFromDisk: (dashboardId: string, alreadySeen: Set<string>) => AgentSession[] = () => [],
): AgentSession[] {
  if (!dashboardId) return [...state.sessions.values()];
  const result = [...state.sessions.values()].filter((s) => s.dashboard_id === dashboardId);
  const seen = new Set(result.map((s) => s.id));
  for (const sess of loadFromDisk(dashboardId, seen)) {
    if (seen.has(sess.id)) continue;
    state.sessions.set(sess.id, sess);
    result.push(sess);
  }
  return result;
}

/** Return browser-agent sessions for a parent, from memory or disk. `loadFromDisk` is required DI
 * for the on-disk half (session_store.py isn't ported); defaults to memory-only. */
export function getBrowserAgentChildren(
  state: SessionLifecycleState,
  parentSessionId: string,
  loadFromDisk: (parentSessionId: string, alreadySeen: Set<string>) => Array<Record<string, unknown>> = () => [],
): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const s of state.sessions.values()) {
    if (s.mode === 'browser-agent' && s.parent_session_id === parentSessionId) {
      results.push(s as unknown as Record<string, unknown>);
      seen.add(s.id);
    }
  }
  results.push(...loadFromDisk(parentSessionId, seen));
  return results;
}
