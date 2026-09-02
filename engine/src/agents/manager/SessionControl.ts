// engine/src/agents/manager/SessionControl.ts -- AGT-6, a port of
// backend/apps/agents/manager/SessionControl.py's stop/approve/switch-branch/update quartet (the
// ops that control or mutate a session WITHOUT producing a new turn). Not named in any prior AGT-1
// through AGT-5 file list -- ported here because AGT-6 is the ticket that actually wires a live
// /ws/agents connection and needs `agent:stop` to do something real, not because it was assigned to
// this ticket in advance.
//
// Same explicit-state-parameter shape as session/SessionLifecycle.ts (no AgentManager class exists
// on the Python side's MRO to borrow `self.*` from). `handleApproval` isn't here -- it's a one-line
// call straight to wsManager.resolveApproval, already exposed by core/wsManager.ts, so AgentManager
// calls that directly instead of wrapping it a second time.
//
// Scope cut, documented: SessionControl.py's stop_agent also calls `commit_partial_now` (persist an
// in-flight streamed reply before teardown) and `save_session` (disk persistence) -- neither exists
// on the TS side yet (session_store.py isn't ported, same gap session/SessionLifecycle.ts's own
// header already names for close/delete). Skipped here for the same reason: inventing a persistence
// stand-in would be untested behavior nobody asked for, and the mock loop this ticket gates against
// resolves far too fast for a real "stop mid-stream" race to matter today.

import type { AgentSession } from '../core/models';
import { wsManager } from '../core/wsManager';

export interface SessionControlState {
  sessions: Map<string, AgentSession>;
  tasks: Map<string, { cancel(): void; done(): boolean } | undefined>;
  cancelEvents: Map<string, { set(): void } | undefined>;
}

/** Stop a running agent and all its browser-agent children. Mirrors stop_agent's ordering: cancel
 * event set BEFORE the task is cancelled, pending approvals denied, status flipped, task dropped
 * from the registry immediately (not left to drain synchronously) so a follow-up message isn't
 * rejected as "still running" while a cancelled task tears down in the background. */
export async function stopAgent(state: SessionControlState, sessionId: string): Promise<void> {
  const children = [...state.sessions.values()].filter((s) => s.parent_session_id === sessionId && s.mode === 'browser-agent');
  for (const child of children) await stopAgent(state, child.id);

  const session = state.sessions.get(sessionId);
  if (session) {
    state.cancelEvents.get(sessionId)?.set();

    for (const req of [...session.pending_approvals]) {
      wsManager.resolveApproval(req.id, { behavior: 'deny', message: 'Agent stopped' });
    }
    session.pending_approvals = [];

    session.status = 'stopped';
    session.needs_fresh_session = true;
    if (!session.closed_at) session.closed_at = new Date().toISOString();

    await wsManager.sendToSession(sessionId, 'agent:status', {
      session_id: sessionId,
      status: 'stopped',
      session,
    } as never);
  }

  const task = state.tasks.get(sessionId);
  state.tasks.delete(sessionId);
  if (task && !task.done()) task.cancel();
}

/** Switch the session's active branch (message-edit fork navigation). */
export async function switchBranch(sessions: Map<string, AgentSession>, sessionId: string, branchId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (!(branchId in session.branches)) throw new Error(`Branch ${branchId} not found`);
  session.active_branch_id = branchId;
  session.needs_fresh_session = true;
  await wsManager.sendToSession(sessionId, 'agent:branch_switched', { session_id: sessionId, active_branch_id: branchId } as never);
}

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(['system_prompt', 'name', 'thinking_level']);
const VALID_THINKING_LEVELS: ReadonlySet<string> = new Set(['off', 'low', 'medium', 'high', 'auto']);

/** Update mutable session fields (system_prompt, name, thinking_level); unknown keys and an invalid
 * thinking_level value are silently ignored, mirroring update_session's own defensive filter. */
export async function updateSession(sessions: Map<string, AgentSession>, sessionId: string, fields: Record<string, unknown>): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  for (const [key, value] of Object.entries(fields)) {
    if (!UPDATABLE_FIELDS.has(key)) continue;
    if (key === 'thinking_level' && !VALID_THINKING_LEVELS.has(String(value))) continue;
    (session as unknown as Record<string, unknown>)[key] = value;
  }

  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: session.status, session } as never);
}
