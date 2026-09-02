// engine/src/agents/manager/streaming/thinking.test.ts -- AGT-4. Ports backend/apps/agents/manager/
// streaming/tests/test_thinking.py's four cases (cached msg_index reuse, child-session-id cache +
// its 1s-TTL expiry/refresh, and the stale-cache self-heal), plus direct coverage of the emission
// rule (no text + no upstream signal + no force -> no-op) and the persisted "Thought for Ns · M
// tokens" aggregate fields (elapsed_ms/tokens/input_tokens/tool_count) the ticket calls out by name.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitConsolidatedThinking, startTickerLoop, type ReasoningTokenProbe } from './thinking';
import { createThinkingState, createTurnState } from './state';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';
import { wsManager, type AgentSocketLike } from '../../core/wsManager';
import type { AgentSession } from '../../core/models';

function makeSession(overrides: Partial<AgentSession> & Pick<AgentSession, 'id' | 'name'>): AgentSession {
  return createAgentSession({
    created_at: '2026-01-01T00:00:00',
    branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
    ...overrides,
  });
}

const neverAvailableProbe: ReasoningTokenProbe = {
  isRunning: async () => false,
  getLatestReasoningTokens: async () => null,
};

describe('emitConsolidatedThinking', () => {
  let sink: AgentSocketLike;
  let sessionId: string;
  let counter = 0;

  beforeEach(() => {
    sessionId = `think-${counter++}`;
    sink = { send: () => {} };
    wsManager.connectSession(sessionId, sink);
  });
  afterEach(() => wsManager.disconnectSession(sessionId, sink));

  it('reuses the cached msg_index across repeated calls (ports test_emit_consolidated_thinking_reuses_cached_msg_index)', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    thinking.textParts = ['hello'];
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);
    const firstIndex = thinking.msgIndex;
    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);

    expect(firstIndex).not.toBeNull();
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].id).toBe(thinking.msgId);
    expect(thinking.msgIndex).toBe(firstIndex);
  });

  it('caches the child-session scan briefly (ports test_emit_consolidated_thinking_caches_child_session_scan_briefly)', async () => {
    const parentId = sessionId;
    const parent = makeSession({ id: parentId, name: 'Parent Agent' });
    const child = makeSession({ id: 'child', name: 'Child Agent', parent_session_id: parentId, tokens: { input_fresh: 10, output: 5 } });
    const thinking = createThinkingState();
    thinking.textParts = ['hello'];
    const turn = createTurnState();
    const sessions = new Map([[parentId, parent], ['child', child]]);

    await emitConsolidatedThinking(thinking, turn, parent, parentId, sessions, false, neverAvailableProbe);
    expect(turn.childSessionIds).toEqual(['child']);
  });

  it('the child-session cache expires and picks up a new child (ports test_emit_consolidated_thinking_child_cache_expires_and_picks_up_new_child)', async () => {
    const parentId = sessionId;
    const parent = makeSession({ id: parentId, name: 'Parent Agent' });
    const thinking = createThinkingState();
    thinking.textParts = ['hello'];
    const turn = createTurnState();
    const sessions = new Map([[parentId, parent]]);

    await emitConsolidatedThinking(thinking, turn, parent, parentId, sessions, false, neverAvailableProbe);
    expect(turn.childSessionIds).toEqual([]);

    // Simulate a mid-turn sub-agent fork appearing after the first tick, and the cache TTL elapsed.
    const child2 = makeSession({ id: 'child2', name: 'Child Agent 2', parent_session_id: parentId, tokens: { input_fresh: 3, output: 1 } });
    sessions.set('child2', child2);
    turn.childSessionIdsCachedAt = Date.now() - 2000;

    await emitConsolidatedThinking(thinking, turn, parent, parentId, sessions, false, neverAvailableProbe);
    expect(turn.childSessionIds).toEqual(['child2']);
  });

  it('self-heals when msg_index becomes stale (ports test_emit_consolidated_thinking_self_heals_when_msg_index_becomes_stale)', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    thinking.textParts = ['hello'];
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);
    expect(thinking.msgIndex).toBe(0);

    // Simulate something else inserting a message before the thinking pill, shifting its real index.
    session.messages.unshift({
      id: 'unrelated',
      role: 'user',
      content: 'hi',
      timestamp: 't',
      branch_id: 'main',
      parent_id: null,
      context_paths: null,
      attached_skills: null,
      forced_tools: null,
      images: null,
      hidden: false,
      client_message_id: null,
      elapsed_ms: null,
      tokens: null,
      tool_count: null,
      input_tokens: null,
    });

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);
    expect(thinking.msgIndex).toBe(1);
    expect(session.messages[1].id).toBe(thinking.msgId);
  });

  it('emits nothing when there is no text, no upstream signal, and no force flag', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);
    expect(session.messages).toHaveLength(0);
    expect(thinking.msgId).toBeNull();
  });

  it('force_provider_unavailable emits a pill even with no text (the cx/gc/ag/ translator carve-out)', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, true, neverAvailableProbe);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('thinking');
  });

  it('persists elapsed_ms/tokens/tool_count on the consolidated message and accumulates session.agent_active_ms', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    thinking.textParts = ['some reasoning text here'];
    const turn = createTurnState();
    turn.startedTs = Date.now() - 250;
    turn.toolCount = 2;
    turn.outputTokens = 40;
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, neverAvailableProbe);

    const msg = session.messages[0];
    expect(msg.tool_count).toBe(2);
    expect(msg.tokens).toBe(40);
    expect(msg.elapsed_ms).toBeGreaterThanOrEqual(250);
    expect(session.agent_active_ms).toBeGreaterThanOrEqual(250);
    expect(session.time_per_model[session.model]).toBeGreaterThanOrEqual(250);
  });

  it('picks up the upstream reasoning-token count over the heuristic when a probe reports one', async () => {
    const session = makeSession({ id: sessionId, name: 'Test Agent' });
    const thinking = createThinkingState();
    // No text_parts -> forces the probe branch (mirrors the cx/gc/ "translator strips reasoning" path).
    const turn = createTurnState();
    const probe: ReasoningTokenProbe = {
      isRunning: async () => true,
      getLatestReasoningTokens: async () => 196,
    };
    const sessions = new Map([[sessionId, session]]);

    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, true, probe);
    expect(session.messages[0].tokens).toBe(196);
  });
});

describe('startTickerLoop', () => {
  let sink: AgentSocketLike;
  let sessionId: string;
  let received: Array<Record<string, unknown>>;
  let counter = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionId = `ticker-${counter++}`;
    received = [];
    sink = {
      send: (t) => {
        received.push(JSON.parse(t));
      },
    };
    wsManager.connectSession(sessionId, sink);
  });
  afterEach(() => {
    wsManager.disconnectSession(sessionId, sink);
    vi.useRealTimers();
  });

  it('re-emits the pill every 1s until cancelled, and settle() resolves once stopped', async () => {
    const session = makeSession({ id: sessionId, name: 'Ticker Agent' });
    const thinking = createThinkingState();
    thinking.textParts = ['reasoning'];
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    const handle = startTickerLoop(thinking, turn, session, sessionId, sessions, neverAvailableProbe);
    expect(handle.isDone()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(received.filter((e) => e.event === 'agent:message')).toHaveLength(2);

    handle.cancel();
    await handle.settle();
    expect(handle.isDone()).toBe(true);

    // No further emission after cancel, even if more time passes.
    await vi.advanceTimersByTimeAsync(3000);
    expect(received.filter((e) => e.event === 'agent:message')).toHaveLength(2);
  });

  it('cancel() before the first tick resolves settle() promptly without ever emitting', async () => {
    const session = makeSession({ id: sessionId, name: 'Ticker Agent' });
    const thinking = createThinkingState();
    const turn = createTurnState();
    const sessions = new Map([[sessionId, session]]);

    const handle = startTickerLoop(thinking, turn, session, sessionId, sessions, neverAvailableProbe);
    handle.cancel();
    await handle.settle();
    expect(handle.isDone()).toBe(true);
    expect(received).toHaveLength(0);
  });
});
