// engine/src/agents/manager/Messaging.test.ts -- AGT-5. Fresh coverage (no dedicated
// backend/tests/test_messaging.py exists to port). Exercises the refusal-when-already-running
// contract (send_message's own docstring calls out that this must never silently vanish the
// prompt), the cross-provider model-switch fork flag, and editMessage's branch-fork bookkeeping.

import { describe, expect, it, vi } from 'vitest';
import { createAgentSession, createMessage } from '../sessionFactory';
import type { AgentSession } from '../core/models';
import { wsManager } from '../core/wsManager';
import { editMessage, sendMessage } from './Messaging';

function pSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return createAgentSession({ id: 's1', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {}, ...overrides });
}

describe('sendMessage', () => {
  it('refuses (returns false) when a turn is already running for the session, and does not queue the prompt', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      const session = pSession();
      const sessions = new Map([[session.id, session]]);
      const tasks = new Map([[session.id, { done: () => false }]]);
      const runAgentLoop = vi.fn();
      const ok = await sendMessage(sessions, tasks, session.id, 'hello', {}, { runAgentLoop });
      expect(ok).toBe(false);
      expect(runAgentLoop).not.toHaveBeenCalled();
      expect(session.messages.length).toBe(0); // the prompt was never appended either
    } finally {
      spy.mockRestore();
    }
  });

  it('appends a user message, flips status to running, and spawns the turn', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      const session = pSession();
      const sessions = new Map([[session.id, session]]);
      const tasks = new Map();
      const runAgentLoop = vi.fn();
      const ok = await sendMessage(sessions, tasks, session.id, 'hello', {}, { runAgentLoop });
      expect(ok).toBe(true);
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].content).toBe('hello');
      expect(session.status).toBe('running');
      expect(runAgentLoop).toHaveBeenCalledWith(session.id, 'hello', expect.any(Object));
    } finally {
      spy.mockRestore();
    }
  });

  it('a cross-api-type model switch sets needs_fork', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      const session = pSession({ model: 'sonnet' }); // anthropic
      const sessions = new Map([[session.id, session]]);
      const tasks = new Map();
      await sendMessage(sessions, tasks, session.id, 'hi', { model: 'gpt-5.5-api' }, { runAgentLoop: vi.fn() }); // openai
      expect(session.needs_fork).toBe(true);
      expect(session.model).toBe('gpt-5.5-api');
    } finally {
      spy.mockRestore();
    }
  });

  it('throws for an unknown session with no loadSessionData wired', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      await expect(sendMessage(new Map(), new Map(), 'missing', 'hi', {}, { runAgentLoop: vi.fn() })).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('editMessage', () => {
  it('creates a new branch forked at the edited message and spawns a fresh turn', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      const session = pSession();
      const original = createMessage({ id: 'm1', role: 'user', content: 'original', branch_id: 'main', timestamp: new Date().toISOString() });
      session.messages.push(original);
      const sessions = new Map([[session.id, session]]);
      const tasks = new Map();
      const runAgentLoop = vi.fn();
      await editMessage(sessions, tasks, session.id, 'm1', 'edited content', { runAgentLoop });

      expect(Object.keys(session.branches).length).toBe(1);
      const [branchId, branch] = Object.entries(session.branches)[0];
      expect(branch.fork_point_message_id).toBe('m1');
      expect(session.active_branch_id).toBe(branchId);
      expect(session.needs_fresh_session).toBe(true);
      const edited = session.messages.find((m) => m.content === 'edited content');
      expect(edited?.branch_id).toBe(branchId);
      expect(runAgentLoop).toHaveBeenCalledWith(session.id, 'edited content', expect.any(Object));
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses to edit a non-user message', async () => {
    const spy = vi.spyOn(wsManager, 'sendToSession').mockResolvedValue(undefined);
    try {
      const session = pSession();
      session.messages.push(createMessage({ id: 'm1', role: 'assistant', content: 'reply', branch_id: 'main', timestamp: new Date().toISOString() }));
      const sessions = new Map([[session.id, session]]);
      await expect(editMessage(sessions, new Map(), session.id, 'm1', 'x', { runAgentLoop: vi.fn() })).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
