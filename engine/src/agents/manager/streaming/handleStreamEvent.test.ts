// engine/src/agents/manager/streaming/handleStreamEvent.test.ts -- AGT-4. Ports
// backend/tests/test_stream_event.py's four cases (content_block_start/text, text_delta
// accumulation + live-partial mirror, tool_use start count, thinking block start->stop elapsed
// accumulation) plus direct coverage of input_json_delta and message_stop, which the ticket names
// explicitly ("the streaming state machine").

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleStreamEvent, type StreamEventLike } from './handleStreamEvent';
import { createTurnState, createThinkingState } from './state';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';
import { wsManager, type AgentSocketLike } from '../../core/wsManager';
import type { PartialReply } from './partialReply';

function ev(event: StreamEventLike['event']): StreamEventLike {
  return { event };
}

describe('handleStreamEvent', () => {
  let sessionId: string;
  let counter = 0;
  let sink: AgentSocketLike;
  let received: Array<Record<string, unknown>>;
  let session: ReturnType<typeof createAgentSession>;
  let turn: ReturnType<typeof createTurnState>;
  let thinking: ReturnType<typeof createThinkingState>;
  let livePartial: Map<string, PartialReply>;

  beforeEach(() => {
    sessionId = `stream-${counter++}`;
    received = [];
    sink = {
      send: (t) => {
        received.push(JSON.parse(t));
      },
    };
    wsManager.connectSession(sessionId, sink);
    session = createAgentSession({
      id: sessionId,
      name: 't',
      created_at: '2026-01-01T00:00:00',
      branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
    });
    turn = createTurnState();
    thinking = createThinkingState();
    livePartial = new Map();
  });
  afterEach(() => wsManager.disconnectSession(sessionId, sink));

  it('content_block_start/text inits the stream message and broadcasts stream_start (ports test_content_block_start_text_inits_stream_message)', async () => {
    await handleStreamEvent(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }), session, sessionId, turn, thinking, livePartial);
    expect(turn.streamTextMsgId).not.toBeNull();
    expect(turn.streamBlockIndexMap.get(0)).toBe(turn.streamTextMsgId);
    expect(received.some((e) => e.event === 'agent:stream_start')).toBe(true);
  });

  it('text_delta accumulates and mirrors live_partial (ports test_text_delta_accumulates_and_mirrors_live_partial)', async () => {
    turn.streamTextMsgId = 'm1';
    turn.streamBlockIndexMap.set(0, 'm1');
    await handleStreamEvent(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }), session, sessionId, turn, thinking, livePartial);
    expect(turn.streamTextAccum).toBe('Hello');
    expect(turn.assistantTextChars).toBe(5);
    expect(livePartial.get(sessionId)?.text).toBe('Hello');
  });

  it('tool_use start increments the stream tool count (ports test_tool_use_start_increments_stream_tool_count)', async () => {
    await handleStreamEvent(ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Read' } }), session, sessionId, turn, thinking, livePartial);
    expect(turn.toolCount).toBe(1);
    expect(turn.streamBlockIndexMap.has(1)).toBe(true);
  });

  it('thinking block start then stop pops and accumulates elapsed (ports test_thinking_block_start_then_stop_pops_and_accumulates)', async () => {
    await handleStreamEvent(ev({ type: 'content_block_start', index: 2, content_block: { type: 'thinking' } }), session, sessionId, turn, thinking, livePartial);
    expect(thinking.blockStarts.has(2)).toBe(true);
    await handleStreamEvent(ev({ type: 'content_block_stop', index: 2 }), session, sessionId, turn, thinking, livePartial);
    expect(thinking.blockStarts.has(2)).toBe(false);
    expect(thinking.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('input_json_delta accumulates tool_input_chars and streams the raw chunk', async () => {
    turn.streamBlockIndexMap.set(3, 'tool-msg-1');
    await handleStreamEvent(ev({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } }), session, sessionId, turn, thinking, livePartial);
    expect(turn.toolInputChars).toBe('{"a":1}'.length);
    const delta = received.find((e) => e.event === 'agent:stream_delta');
    expect((delta!.data as { delta: string }).delta).toBe('{"a":1}');
  });

  it('message_stop ends the active text stream when one is open', async () => {
    turn.streamTextMsgId = 'm-text';
    await handleStreamEvent(ev({ type: 'message_stop' }), session, sessionId, turn, thinking, livePartial);
    const end = received.find((e) => e.event === 'agent:stream_end');
    expect((end!.data as { message_id: string }).message_id).toBe('m-text');
  });

  it('message_stop is a no-op when no text stream is open', async () => {
    await handleStreamEvent(ev({ type: 'message_stop' }), session, sessionId, turn, thinking, livePartial);
    expect(received).toHaveLength(0);
  });

  it('stamps session.first_response_at on the first content_block_start, and only once', async () => {
    expect(session.first_response_at).toBeNull();
    await handleStreamEvent(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }), session, sessionId, turn, thinking, livePartial);
    const first = session.first_response_at;
    expect(first).not.toBeNull();
    await handleStreamEvent(ev({ type: 'content_block_start', index: 4, content_block: { type: 'text' } }), session, sessionId, turn, thinking, livePartial);
    expect(session.first_response_at).toBe(first);
  });
});
