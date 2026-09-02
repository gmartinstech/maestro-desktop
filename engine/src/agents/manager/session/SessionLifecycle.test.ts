// engine/src/agents/manager/session/SessionLifecycle.test.ts -- AGT-5. Fresh coverage (no
// dedicated backend/tests/test_session_lifecycle.py exists to port -- not one of the GATE's named
// search patterns). Exercises purgeSessionMemory's chokepoint contract, closeSession's status/
// persistence/broadcast behavior, and getHistory's filter/paginate/sort logic.

import { describe, expect, it, vi } from 'vitest';
import { createAgentSession } from '../../sessionFactory';
import type { AgentSession } from '../../core/models';
import { wsManager } from '../../core/wsManager';
import { viewBuilderDirtySessions, viewBuilderRenderRetryCounts } from '../viewBuilderState';
import { closeSession, getHistory, purgeSessionMemory, type SessionLifecycleState } from './SessionLifecycle';

function pState(session?: AgentSession): SessionLifecycleState {
  const sessions = new Map<string, AgentSession>();
  if (session) sessions.set(session.id, session);
  return {
    sessions,
    tasks: new Map(),
    livePartial: new Map(),
    cancelEvents: new Map(),
    hookCtxs: new Map(),
    stderrBuffers: new Map(),
  };
}

describe('purgeSessionMemory', () => {
  it('drops the session from every in-memory structure keyed by its id', () => {
    const session = createAgentSession({ id: 's1', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
    const state = pState(session);
    state.tasks.set('s1', { cancel: () => {}, done: () => true });
    state.livePartial.set('s1', {});
    state.cancelEvents.set('s1', { set: () => {} });
    state.hookCtxs.set('s1', {});
    state.stderrBuffers.set('s1', {});
    viewBuilderRenderRetryCounts.set('s1', 1);
    viewBuilderDirtySessions.add('s1');

    purgeSessionMemory(state, 's1');

    expect(state.sessions.has('s1')).toBe(false);
    expect(state.tasks.has('s1')).toBe(false);
    expect(state.livePartial.has('s1')).toBe(false);
    expect(state.cancelEvents.has('s1')).toBe(false);
    expect(state.hookCtxs.has('s1')).toBe(false);
    expect(state.stderrBuffers.has('s1')).toBe(false);
    expect(viewBuilderRenderRetryCounts.has('s1')).toBe(false);
    expect(viewBuilderDirtySessions.has('s1')).toBe(false);
  });
});

describe('closeSession', () => {
  it('flips status to stopped, persists, broadcasts agent:closed, and purges memory', async () => {
    const session = createAgentSession({ id: 's1', name: 't', model: 'sonnet', dashboard_id: 'd', created_at: new Date().toISOString(), branches: {}, status: 'running' });
    const state = pState(session);
    const sent: Array<[string, unknown]> = [];
    const spy = vi.spyOn(wsManager, 'sendToSession').mockImplementation(async (_sid, event, data) => {
      sent.push([event, data]);
    });
    const saved: Array<[string, Record<string, unknown>]> = [];
    try {
      await closeSession(state, 's1', { saveSession: (sid, data) => saved.push([sid, data]) });
    } finally {
      spy.mockRestore();
    }

    expect(saved.length).toBe(1);
    expect(saved[0][1].status).toBe('stopped');
    expect(sent.some(([e]) => e === 'agent:closed')).toBe(true);
    expect(state.sessions.has('s1')).toBe(false);
  });

  it('throws for an unknown session', async () => {
    const state = pState();
    await expect(closeSession(state, 'missing', { saveSession: () => {} })).rejects.toThrow();
  });
});

describe('getHistory', () => {
  const rows: Array<[string, Record<string, unknown>]> = [
    ['a', { id: 'a', name: 'Alpha task', status: 'stopped', model: 'sonnet', mode: 'agent', closed_at: '2026-01-01T00:00:00Z', dashboard_id: 'd1' }],
    ['b', { id: 'b', name: 'Beta task', status: 'stopped', model: 'sonnet', mode: 'agent', closed_at: '2026-02-01T00:00:00Z', dashboard_id: 'd2' }],
    ['c', { id: 'c', name: 'Gamma', status: 'stopped', model: 'sonnet', mode: 'agent', closed_at: '2026-03-01T00:00:00Z', dashboard_id: 'd1' }],
  ];

  it('sorts newest-closed first', () => {
    const out = getHistory(() => rows);
    expect(out.sessions.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(out.total).toBe(3);
    expect(out.has_more).toBe(false);
  });

  it('filters by dashboard_id', () => {
    const out = getHistory(() => rows, { dashboardId: 'd1' });
    expect(out.sessions.map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('filters by a case-insensitive name/search_text query', () => {
    const out = getHistory(() => rows, { q: 'beta' });
    expect(out.sessions.map((s) => s.id)).toEqual(['b']);
  });

  it('paginates with limit/offset and reports has_more', () => {
    const out = getHistory(() => rows, { limit: 1, offset: 0 });
    expect(out.sessions.map((s) => s.id)).toEqual(['c']);
    expect(out.has_more).toBe(true);
  });
});
