// engine/src/agents/manager/SessionControl.test.ts -- AGT-6. Unit coverage for SessionControl.ts's
// three pure-ish operations (stopAgent/switchBranch/updateSession), each driven against a minimal
// hand-built session + wsManager's real singleton (the same pattern MockAgent.test.ts/
// Messaging.test.ts already use -- these functions call wsManager.sendToSession/resolveApproval
// directly, not through an injectable seam, so asserting on session mutation is the practical gate
// here rather than intercepting the WS broadcast itself).

import { beforeEach, describe, expect, it } from 'vitest';
import { stopAgent, switchBranch, updateSession, type SessionControlState } from './SessionControl';
import { createAgentSession, createMessageBranch } from '../sessionFactory';
import type { AgentSession } from '../core/models';
import { wsManager } from '../core/wsManager';

function makeSession(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return createAgentSession({
    id,
    name: 'session-control test',
    created_at: '2026-01-01T00:00:00.000Z',
    branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00.000Z' }) },
    ...overrides,
  });
}

describe('stopAgent', () => {
  let sessions: Map<string, AgentSession>;
  let tasks: SessionControlState['tasks'];
  let cancelEvents: SessionControlState['cancelEvents'];

  beforeEach(() => {
    sessions = new Map();
    tasks = new Map();
    cancelEvents = new Map();
  });

  it('flips status to stopped, sets closed_at, and drops the task from the registry', async () => {
    const session = makeSession('stop-1');
    sessions.set(session.id, session);
    let cancelled = false;
    tasks.set(session.id, { cancel: () => { cancelled = true; }, done: () => false });

    await stopAgent({ sessions, tasks, cancelEvents }, session.id);

    expect(session.status).toBe('stopped');
    expect(session.needs_fresh_session).toBe(true);
    expect(session.closed_at).not.toBeNull();
    expect(cancelled).toBe(true);
    expect(tasks.has(session.id)).toBe(false);
  });

  it('does not overwrite an already-set closed_at', async () => {
    const session = makeSession('stop-2', { closed_at: '2025-01-01T00:00:00.000Z' });
    sessions.set(session.id, session);

    await stopAgent({ sessions, tasks, cancelEvents }, session.id);

    expect(session.closed_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('sets the cancel event and denies every pending approval before touching the task', async () => {
    const session = makeSession('stop-3');
    session.pending_approvals = [
      { id: 'req-1', session_id: session.id, tool_name: 'Bash', tool_input: {}, created_at: '2026-01-01T00:00:00.000Z', sensitive_pattern: null, sensitive_label: null, sensitive_why: null },
    ];
    sessions.set(session.id, session);
    let eventSet = false;
    cancelEvents.set(session.id, { set: () => { eventSet = true; } });

    const decision = wsManager.sendApprovalRequest(session.id, 'req-1', 'Bash', {});
    await stopAgent({ sessions, tasks, cancelEvents }, session.id);

    expect(eventSet).toBe(true);
    expect(session.pending_approvals).toEqual([]);
    await expect(decision).resolves.toEqual({ behavior: 'deny', message: 'Agent stopped' });
  });

  it('stops browser-agent children before the parent', async () => {
    const parent = makeSession('stop-parent');
    const child = makeSession('stop-child', { mode: 'browser-agent', parent_session_id: 'stop-parent' });
    sessions.set(parent.id, parent);
    sessions.set(child.id, child);

    await stopAgent({ sessions, tasks, cancelEvents }, parent.id);

    expect(child.status).toBe('stopped');
    expect(parent.status).toBe('stopped');
  });

  it('is a silent no-op for an unknown session id', async () => {
    await expect(stopAgent({ sessions, tasks, cancelEvents }, 'no-such-session')).resolves.toBeUndefined();
  });
});

describe('switchBranch', () => {
  it('sets active_branch_id and marks needs_fresh_session when the branch exists', async () => {
    const session = makeSession('branch-1', {
      branches: {
        main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00.000Z' }),
        fork: createMessageBranch({ id: 'fork', created_at: '2026-01-01T00:01:00.000Z' }),
      },
    });
    const sessions = new Map([[session.id, session]]);

    await switchBranch(sessions, session.id, 'fork');

    expect(session.active_branch_id).toBe('fork');
    expect(session.needs_fresh_session).toBe(true);
  });

  it('throws for an unknown session', async () => {
    await expect(switchBranch(new Map(), 'ghost', 'main')).rejects.toThrow(/not found/);
  });

  it('throws for an unknown branch id', async () => {
    const session = makeSession('branch-2');
    const sessions = new Map([[session.id, session]]);
    await expect(switchBranch(sessions, session.id, 'no-such-branch')).rejects.toThrow(/Branch/);
  });
});

describe('updateSession', () => {
  it('updates name/system_prompt/thinking_level', async () => {
    const session = makeSession('update-1');
    const sessions = new Map([[session.id, session]]);

    await updateSession(sessions, session.id, { name: 'renamed', system_prompt: 'be terse', thinking_level: 'high' });

    expect(session.name).toBe('renamed');
    expect(session.system_prompt).toBe('be terse');
    expect(session.thinking_level).toBe('high');
  });

  it('ignores keys outside the allowed set', async () => {
    const session = makeSession('update-2');
    const sessions = new Map([[session.id, session]]);

    await updateSession(sessions, session.id, { model: 'haiku', cost_usd: 999 });

    expect(session.model).not.toBe('haiku');
    expect(session.cost_usd).not.toBe(999);
  });

  it('ignores an invalid thinking_level value', async () => {
    const session = makeSession('update-3', { thinking_level: 'auto' });
    const sessions = new Map([[session.id, session]]);

    await updateSession(sessions, session.id, { thinking_level: 'ultra' });

    expect(session.thinking_level).toBe('auto');
  });

  it('throws for an unknown session', async () => {
    await expect(updateSession(new Map(), 'ghost', { name: 'x' })).rejects.toThrow(/not found/);
  });
});
