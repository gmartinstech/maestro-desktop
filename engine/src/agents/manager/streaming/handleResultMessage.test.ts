// engine/src/agents/manager/streaming/handleResultMessage.test.ts -- AGT-4. Ports
// backend/tests/test_result_message.py's three cases (session-tokens write + context_update
// broadcast, free-route cost zeroing, per-turn state reset at completion).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleResultMessage, type ResultMessageLike } from './handleResultMessage';
import { createTurnState, createThinkingState } from './state';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';
import { wsManager, type AgentSocketLike } from '../../core/wsManager';

function result(usage?: ResultMessageLike['usage'], cost?: number | null): ResultMessageLike {
  return {
    usage: usage ?? { input_tokens: 100, output_tokens: 50 },
    total_cost_usd: cost ?? null,
    session_id: 'sdk-1',
  };
}

describe('handleResultMessage', () => {
  let sessionId: string;
  let counter = 0;
  let sink: AgentSocketLike;
  let events: string[];
  let session: ReturnType<typeof createAgentSession>;
  let turn: ReturnType<typeof createTurnState>;
  let thinking: ReturnType<typeof createThinkingState>;
  let sessions: Map<string, ReturnType<typeof createAgentSession>>;

  beforeEach(() => {
    sessionId = `result-${counter++}`;
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

  it('writes session tokens and emits context_update (ports test_writes_session_tokens_and_emits_context_update)', async () => {
    await handleResultMessage(
      result({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 }),
      session,
      sessionId,
      turn,
      thinking,
      sessions,
      'sonnet',
      'anthropic',
      undefined,
    );
    expect(session.tokens.input).toBe(120); // 100 fresh + 0 create + 20 cache-read
    expect(session.tokens.input_fresh).toBe(100);
    expect(session.tokens.output).toBe(50);
    expect(events).toContain('agent:context_update');
  });

  it('zeroes cost for a free (subscription) route (ports test_free_route_zeroes_cost)', async () => {
    await handleResultMessage(result(undefined, 9.99), session, sessionId, turn, thinking, sessions, 'cc/opus', 'anthropic', undefined);
    expect(session.cost_usd).toBe(0.0); // cc/ is server-funded, never billed per-token
  });

  it('resets per-turn state at completion (ports test_resets_per_turn_state_at_completion)', async () => {
    turn.outputTokens = 999;
    turn.toolCount = 5;
    thinking.totalMs = 100; // textParts left empty so no pill emit fires
    await handleResultMessage(result(), session, sessionId, turn, thinking, sessions, 'sonnet', 'anthropic', undefined);
    expect(turn.outputTokens).toBe(0);
    expect(turn.toolCount).toBe(0);
    expect(thinking.totalMs).toBe(0);
    expect(thinking.blockStarts.size).toBe(0);
  });

  it('recomputes cost at direct-key rates when a PricingLookup is supplied, instead of the SDK Anthropic-rate estimate', async () => {
    await handleResultMessage(
      result({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 30.0),
      session,
      sessionId,
      turn,
      thinking,
      sessions,
      'gpt-5.4-mini',
      'openai',
      undefined,
      { getOpenrouterPricing: () => null, getDirectPricing: () => [0.25, 2.0] },
    );
    expect(session.cost_usd).toBeCloseTo(0.25 + 2.0, 5);
  });

  it('zeroes cost for an unknown model in a priced family, rather than keeping the SDK estimate', async () => {
    await handleResultMessage(result(undefined, 30.0), session, sessionId, turn, thinking, sessions, 'cp-openai/some-unknown-model', 'openai', undefined);
    expect(session.cost_usd).toBe(0.0);
  });

  it('does not touch cost or emit agent:cost_update when the SDK reports no cost at all', async () => {
    await handleResultMessage(result(), session, sessionId, turn, thinking, sessions, 'sonnet', 'anthropic', undefined);
    expect(events).not.toContain('agent:cost_update');
  });
});
