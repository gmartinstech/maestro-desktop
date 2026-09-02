// engine/src/agents/MockAgent.test.ts -- AGT-3. Structural coverage of runMockTurn (the gated,
// byte-identical-to-Python path) plus mockAgentEnabled's flag-string strictness. The actual
// byte-identical-to-Python proof lives outside vitest (see docs/plans/txm-status.md's AGT-3 row):
// this file exercises the TS side alone, in isolation, the way any other engine unit test does.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockAgentEnabled, MOCK_REPLY_PREFIX, runMockTurn } from './MockAgent';
import { createAgentSession, createMessageBranch } from './sessionFactory';
import type { AgentSession } from './core/models';
import { wsManager, type AgentSocketLike } from './core/wsManager';
import { uuidState } from './uuid';

// AGT-4: migrated off the deleted flat `agents/wsManager.ts`/`seqLog.ts` placeholders onto
// `core/wsManager.ts`'s real `ConnectionManager` singleton (see MockAgent.ts's header). That
// singleton has no public seq-reset, so each test gets its own fresh session id (a never-seen id
// always starts its SessionSeqLog at seq 0) instead of resetting shared state between tests --
// same effect (seq asserts start at 1 every time), no new API needed on the AGT-2 file.
let sessionCounter = 0;

describe('mockAgentEnabled', () => {
  const original = process.env.MAESTRO_MOCK_AGENT;
  afterEach(() => {
    if (original === undefined) delete process.env.MAESTRO_MOCK_AGENT;
    else process.env.MAESTRO_MOCK_AGENT = original;
  });

  it('is true only for the exact string "1"', () => {
    process.env.MAESTRO_MOCK_AGENT = '1';
    expect(mockAgentEnabled()).toBe(true);
  });

  it('is false when unset', () => {
    delete process.env.MAESTRO_MOCK_AGENT;
    expect(mockAgentEnabled()).toBe(false);
  });

  it.each(['true', 'yes', '0', ' 1', '1 '])('is false for %j (only "1" counts, matching the Python original)', (v) => {
    process.env.MAESTRO_MOCK_AGENT = v;
    expect(mockAgentEnabled()).toBe(false);
  });
});

describe('runMockTurn', () => {
  let sessionId: string;
  let sessions: Map<string, AgentSession>;
  let sink: AgentSocketLike;
  let received: Array<Record<string, unknown>>;

  beforeEach(() => {
    sessionId = `sess-test-${sessionCounter++}`;
    let n = 0;
    uuidState.generate = () => `deadbeefdeadbeefdeadbeefdeadbee${n++}`;

    received = [];
    sink = {
      send(text: string) {
        received.push(JSON.parse(text));
      },
    };
    wsManager.connectSession(sessionId, sink);

    sessions = new Map();
    sessions.set(
      sessionId,
      createAgentSession({
        id: sessionId,
        name: 'test session',
        created_at: '2026-01-01T00:00:00',
        branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
      }),
    );
  });

  afterEach(() => {
    wsManager.disconnectSession(sessionId, sink);
  });

  it('does nothing when the session is unknown', async () => {
    await runMockTurn(sessions, 'no-such-session', 'hi');
    expect(received).toEqual([]);
  });

  it('emits stream_start, one delta per word (of MOCK_REPLY_PREFIX + prompt), stream_end, agent:message, agent:status(completed) -- in that order', async () => {
    await runMockTurn(sessions, sessionId, 'hi'); // "[maestro-mock] echo: hi" -> 3 words -> 3 deltas
    const events = received.map((e) => e.event);
    expect(events).toEqual([
      'agent:stream_start',
      'agent:stream_delta',
      'agent:stream_delta',
      'agent:stream_delta',
      'agent:stream_end',
      'agent:message',
      'agent:status',
    ]);
  });

  it('assigns strictly increasing seq numbers starting at 1', async () => {
    await runMockTurn(sessions, sessionId, 'hi');
    const seqs = received.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('prefixes the echoed prompt with MOCK_REPLY_PREFIX and reassembles it losslessly across deltas', async () => {
    await runMockTurn(sessions, sessionId, 'hello from the gate');
    const deltas = received.filter((e) => e.event === 'agent:stream_delta');
    const text = deltas.map((e) => (e.data as { delta: string }).delta).join('');
    expect(text).toBe(`${MOCK_REPLY_PREFIX}hello from the gate`);
  });

  it('leaves the session completed with the mock reply appended to messages', async () => {
    await runMockTurn(sessions, sessionId, 'hi');
    const session = sessions.get(sessionId)!;
    expect(session.status).toBe('completed');
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('assistant');
    expect(session.messages[0].content).toBe(`${MOCK_REPLY_PREFIX}hi`);
  });

  it('the final agent:status event embeds the full completed session', async () => {
    await runMockTurn(sessions, sessionId, 'hi');
    const statusEvent = received.find((e) => e.event === 'agent:status')!;
    const data = statusEvent.data as { session_id: string; status: string; session: AgentSession };
    expect(data.session_id).toBe(sessionId);
    expect(data.status).toBe('completed');
    expect(data.session.id).toBe(sessionId);
    expect(data.session.status).toBe('completed');
  });
});
