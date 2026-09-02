// engine/src/agents/manager/streaming/handleAssistantMessage.test.ts -- AGT-4. Ports
// backend/tests/test_assistant_message.py's four cases (plain text commit, router-auth-expiry
// friendly card instead of assistant text, tool-call commit, output-token accumulation), plus
// direct coverage of the thinking-pill fold-in and the ticker start-on-first-thinking-text branch.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAssistantMessage, type AssistantMessageLike } from './handleAssistantMessage';
import { createTurnState, createThinkingState } from './state';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';
import { wsManager, type AgentSocketLike } from '../../core/wsManager';

function asst(content: AssistantMessageLike['content'], usage?: AssistantMessageLike['usage']): AssistantMessageLike {
  return { content, usage: usage ?? { input_tokens: 1, output_tokens: 1 } };
}

describe('handleAssistantMessage', () => {
  let sessionId: string;
  let counter = 0;
  let sink: AgentSocketLike;
  let events: string[];
  let session: ReturnType<typeof createAgentSession>;
  let turn: ReturnType<typeof createTurnState>;
  let thinking: ReturnType<typeof createThinkingState>;
  let sessions: Map<string, ReturnType<typeof createAgentSession>>;

  beforeEach(() => {
    sessionId = `asst-${counter++}`;
    events = [];
    sink = {
      send(t: string) {
        events.push(JSON.parse(t).event);
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
  });
  afterEach(() => wsManager.disconnectSession(sessionId, sink));

  it('plain text commits an assistant message (ports test_plain_text_commits_assistant_message)', async () => {
    await handleAssistantMessage(asst([{ type: 'text', text: 'Hello there' }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(session.messages.some((m) => m.role === 'assistant' && String(m.content).includes('Hello there'))).toBe(true);
    expect(turn.number).toBe(1);
  });

  it('a router-auth-expiry text surfaces a friendly card, NOT committed as the assistant reply (ports test_router_auth_error_surfaces_card_not_assistant_text)', async () => {
    const txt = '[codex/gpt-5] Failed to authenticate: 401 provided authentication token is expired';
    await handleAssistantMessage(asst([{ type: 'text', text: txt }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(session.messages.some((m) => m.role === 'system')).toBe(true);
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(events).toContain('agent:auth_error');
  });

  it('a tool_use block commits a tool_call message (ports test_tool_use_block_commits_tool_call)', async () => {
    await handleAssistantMessage(asst([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(session.messages.some((m) => m.role === 'tool_call')).toBe(true);
  });

  it('output tokens accumulate onto the turn (ports test_output_tokens_accumulate_onto_turn)', async () => {
    await handleAssistantMessage(asst([{ type: 'text', text: 'hi' }], { input_tokens: 10, output_tokens: 42 }), session, sessionId, turn, thinking, new Map(), sessions);
    expect(turn.outputTokens).toBe(42);
  });

  it('folds thinking-block text into the pill and re-emits it on this AssistantMessage', async () => {
    await handleAssistantMessage(asst([{ type: 'thinking', thinking: 'pondering...' }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(thinking.textParts).toEqual(['pondering...']);
    expect(session.messages.some((m) => m.role === 'thinking')).toBe(true);
    expect(events).toContain('agent:message');
    // Ticker started because there is now consolidated thinking in flight.
    expect(thinking.tickerTask).not.toBeNull();
    thinking.tickerTask?.cancel();
    await thinking.tickerTask?.settle();
  });

  it('latches the latest thoughtSignature, preferring the newest field-name variant present', async () => {
    await handleAssistantMessage(asst([{ type: 'thinking', thinking: 'a', signature: 'sig1' }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(thinking.thoughtSignature).toBe('sig1');
    await handleAssistantMessage(asst([{ type: 'thinking', thinking: 'b', thoughtSignature: 'sig2' }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(thinking.thoughtSignature).toBe('sig2');
    thinking.tickerTask?.cancel();
    await thinking.tickerTask?.settle();
  });

  it('resets the per-message stream bookkeeping at the end (mirrors the trailing reset in the Python original)', async () => {
    turn.streamTextMsgId = 'was-open';
    turn.streamToolMsgIdsOrdered = ['t1'];
    turn.streamBlockIndexMap.set(0, 'x');
    await handleAssistantMessage(asst([{ type: 'text', text: 'ok' }]), session, sessionId, turn, thinking, new Map(), sessions);
    expect(turn.streamTextMsgId).toBeNull();
    expect(turn.streamToolMsgIdsOrdered).toEqual([]);
    expect(turn.streamBlockIndexMap.size).toBe(0);
  });
});
