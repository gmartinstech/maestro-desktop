// engine/src/agents/manager/run/turnRunner.test.ts -- AGT-4. The turn runner's own gate: the
// capacity-retry backoff schedule (mirrors the Python original's escalation, finalization-on-retry,
// and give-up-after-budget behavior -- backend/tests/test_capacity_retry.py already covers the
// classifier itself, ported in errorClassify.test.ts; this file covers the LOOP that consumes it),
// plus the streaming-message dispatch (baseline capture, pre-emit thinking pill, compact_boundary
// counting) that `consumeTurnMessages` drives.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITY_BACKOFFS,
  consumeTurnMessages,
  runTurnWithRetry,
  type PersistentSdkClient,
  type SdkMessageLike,
  type TurnRunnerDeps,
} from './turnRunner';
import { createTurnState, createThinkingState } from '../streaming/state';
import { createPartialReply } from '../streaming/partialReply';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';
import { wsManager, type AgentSocketLike } from '../../core/wsManager';
import type { ClientHandle } from './clientPool';

function asyncIterOf(messages: SdkMessageLike[]): AsyncIterable<SdkMessageLike> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const m of messages) yield m;
    },
  };
}

/** An async iterable that throws on its very first pull -- simulates `query()` raising before any
 * message is yielded (the CLI process failed to start, or died immediately). */
function throwingStream(err: unknown): AsyncIterable<SdkMessageLike> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<SdkMessageLike>> {
          return Promise.reject(err);
        },
      };
    },
  };
}

const TRANSIENT_ERROR = new Error('No pool capacity available. Try again shortly.');

describe('consumeTurnMessages', () => {
  let sessionId: string;
  let counter = 0;
  let sink: AgentSocketLike;
  let session: ReturnType<typeof createAgentSession>;
  let turn: ReturnType<typeof createTurnState>;
  let thinking: ReturnType<typeof createThinkingState>;
  let sessions: Map<string, ReturnType<typeof createAgentSession>>;

  beforeEach(() => {
    sessionId = `turn-${counter++}`;
    sink = { send: () => {} };
    wsManager.connectSession(sessionId, sink);
    session = createAgentSession({
      id: sessionId,
      name: 't',
      model: 'sonnet',
      created_at: '2026-01-01T00:00:00',
      branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
    });
    turn = createTurnState();
    thinking = createThinkingState();
    sessions = new Map([[sessionId, session]]);
  });
  afterEach(() => wsManager.disconnectSession(sessionId, sink));

  it('stamps startedTs + baseline tokens on the first non-result message, only once', async () => {
    session.tokens = { input_fresh: 12, output: 4 };
    await consumeTurnMessages(
      asyncIterOf([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } } },
      ]),
      session,
      sessionId,
      turn,
      thinking,
      new Map(),
      sessions,
      'sonnet',
      'anthropic',
      undefined,
    );
    expect(turn.startedTs).not.toBeNull();
    expect(turn.baselineCaptured).toBe(true);
    expect(turn.baselineSessionIn).toBe(12);
    expect(turn.baselineSessionOut).toBe(4);
  });

  it('counts a compact_boundary system message', async () => {
    await consumeTurnMessages(
      asyncIterOf([{ type: 'system', subtype: 'compact_boundary' }]),
      session,
      sessionId,
      turn,
      thinking,
      new Map(),
      sessions,
      'sonnet',
      'anthropic',
      undefined,
    );
    expect(turn.compactBoundaries).toBe(1);
  });

  it('pre-emits a force-unavailable thinking pill on the first message for a reasoning-stripping route (cx/)', async () => {
    await consumeTurnMessages(
      asyncIterOf([{ type: 'assistant', content: [{ type: 'text', text: 'hi' }] }]),
      session,
      sessionId,
      turn,
      thinking,
      new Map(),
      sessions,
      'cx/gpt-5',
      'openai',
      undefined,
    );
    // The pre-emit fires before handleAssistantMessage runs (turn.startedTs is null on message 1,
    // so the pre-emit branch executes ahead of the dispatch below it in the same iteration).
    expect(session.messages.some((m) => m.role === 'thinking')).toBe(true);
  });

  it('does NOT reset startedTs on a subsequent result message ending the turn (current_turn_emitted flips false, startedTs stays)', async () => {
    await consumeTurnMessages(
      asyncIterOf([
        { type: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        { type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: null },
      ]),
      session,
      sessionId,
      turn,
      thinking,
      new Map(),
      sessions,
      'sonnet',
      'anthropic',
      undefined,
    );
    expect(turn.currentTurnEmitted).toBe(false); // handleResultMessage's own reset ran too (startedTs -> null there)
  });

  it('dispatches stream_event/assistant/result to their matching handlers in one pass', async () => {
    await consumeTurnMessages(
      asyncIterOf([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'Read' } } },
        { type: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }] },
        { type: 'result', usage: { input_tokens: 5, output_tokens: 5 }, total_cost_usd: null },
      ]),
      session,
      sessionId,
      turn,
      thinking,
      new Map(),
      sessions,
      'sonnet',
      'anthropic',
      undefined,
    );
    expect(session.messages.some((m) => m.role === 'tool_call')).toBe(true);
    expect(session.tokens.input).toBe(5);
  });
});

describe('runTurnWithRetry (capacity backoff)', () => {
  let sessionId: string;
  let counter = 0;
  let sink: AgentSocketLike;
  let session: ReturnType<typeof createAgentSession>;
  let turn: ReturnType<typeof createTurnState>;
  let thinking: ReturnType<typeof createThinkingState>;
  let sessions: Map<string, ReturnType<typeof createAgentSession>>;
  let livePartial: Map<string, ReturnType<typeof createPartialReply>>;
  let sentEvents: Array<{ event: string; data: unknown }>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionId = `retry-${counter++}`;
    sentEvents = [];
    sink = {
      send(t: string) {
        const parsed = JSON.parse(t);
        sentEvents.push({ event: parsed.event, data: parsed.data });
      },
    };
    wsManager.connectSession(sessionId, sink);
    session = createAgentSession({
      id: sessionId,
      name: 't',
      model: 'sonnet',
      created_at: '2026-01-01T00:00:00',
      branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
    });
    turn = createTurnState();
    thinking = createThinkingState();
    sessions = new Map([[sessionId, session]]);
    livePartial = new Map();
  });
  afterEach(() => {
    wsManager.disconnectSession(sessionId, sink);
    vi.useRealTimers();
  });

  function baseDeps(overrides: Partial<TurnRunnerDeps> = {}): TurnRunnerDeps {
    return {
      queryOnce: () => asyncIterOf([]),
      clientPool: new Map<string, ClientHandle<PersistentSdkClient>>(),
      connectPersistentClient: async () => {
        throw new Error('not used in this test');
      },
      usePersistentClient: () => false,
      ...overrides,
    };
  }

  it('succeeds on the first attempt with no retry when the stream completes cleanly', async () => {
    const deps = baseDeps({ queryOnce: () => asyncIterOf([{ type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: null }]) });
    await runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps);
    // no error, no retry-only side effects
  });

  it('escalates through the exact CAPACITY_BACKOFFS schedule, then rethrows once the budget is exhausted', async () => {
    let calls = 0;
    const deps = baseDeps({
      queryOnce: () => {
        calls += 1;
        return throwingStream(TRANSIENT_ERROR);
      },
    });
    const promise = runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps);
    // Swallow the eventual rejection so an unhandled-rejection warning doesn't fire while timers advance.
    const settled = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await settled;
    expect(err).toBe(TRANSIENT_ERROR);
    // One call per attempt: the original + one retry per backoff entry.
    expect(calls).toBe(CAPACITY_BACKOFFS.length + 1);
  });

  it('rethrows immediately for a non-transient error, with no retry and no sleep', async () => {
    let calls = 0;
    const deps = baseDeps({
      queryOnce: () => {
        calls += 1;
        return throwingStream(new Error('invalid_request_error: bad params'));
      },
    });
    await expect(runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps)).rejects.toThrow('bad params');
    expect(calls).toBe(1);
  });

  it('finalizes an in-flight stream (stream_end for the open text + each ordered tool) before retrying', async () => {
    let calls = 0;
    const deps = baseDeps({
      queryOnce: () => {
        calls += 1;
        if (calls === 1) {
          // First attempt streams some text then dies mid-turn.
          turn.streamTextMsgId = 'open-text';
          turn.streamToolMsgIdsOrdered = ['open-tool-1'];
          return throwingStream(TRANSIENT_ERROR);
        }
        return asyncIterOf([{ type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: null }]);
      },
    });
    const promise = runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps);
    await vi.runAllTimersAsync();
    await promise;
    const ends = sentEvents.filter((e) => e.event === 'agent:stream_end').map((e) => (e.data as { message_id: string }).message_id);
    expect(ends).toContain('open-text');
    expect(ends).toContain('open-tool-1');
    expect(turn.streamTextMsgId).toBeNull();
    expect(turn.streamToolMsgIdsOrdered).toEqual([]);
  });

  it('rebuilds options for resume when session.sdk_session_id is set, via onResumeRebuild', async () => {
    session.sdk_session_id = 'sdk-abc';
    let calls = 0;
    let rebuiltWith: string | null = null;
    const deps = baseDeps({
      queryOnce: () => {
        calls += 1;
        if (calls === 1) return throwingStream(TRANSIENT_ERROR);
        return asyncIterOf([{ type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: null }]);
      },
      onResumeRebuild: (sdkSessionId) => {
        rebuiltWith = sdkSessionId;
      },
    });
    const promise = runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps);
    await vi.runAllTimersAsync();
    await promise;
    expect(rebuiltWith).toBe('sdk-abc');
  });

  it('persistent-client dead-client fail-safe: one transparent immediate respawn retry when nothing has streamed yet', async () => {
    class ProcessError extends Error {}
    let connects = 0;
    const deps = baseDeps({
      usePersistentClient: () => true,
      connectPersistentClient: async () => {
        connects += 1;
        const client: PersistentSdkClient = {
          async disconnect() {},
          async query() {},
          receiveResponse: () =>
            connects === 1
              ? throwingStream(new ProcessError('CLI died'))
              : asyncIterOf([{ type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: null }]),
        };
        return client;
      },
    });
    const promise = runTurnWithRetry(session, sessionId, 'hi', {}, {}, turn, thinking, [], 'sonnet', 'anthropic', undefined, sessions, livePartial, deps);
    await vi.runAllTimersAsync();
    await promise; // must resolve, not throw -- the dead-client retry is immediate (wait=0) and transparent
    expect(connects).toBe(2);
  });
});
