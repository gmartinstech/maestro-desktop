// engine/src/agents/manager/streaming/upsertMessage.test.ts -- AGT-4.

import { describe, expect, it } from 'vitest';
import { upsertMessage } from './upsertMessage';
import { createAgentSession, createMessage, createMessageBranch } from '../../sessionFactory';

function session() {
  return createAgentSession({
    id: 's1',
    name: 'test',
    created_at: '2026-01-01T00:00:00',
    branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
  });
}

describe('upsertMessage', () => {
  it('appends a new id and records it in message_index', () => {
    const s = session();
    const m = createMessage({ id: 'm1', role: 'assistant', content: 'hi', branch_id: 'main', timestamp: 't' });
    upsertMessage(s, m);
    expect(s.messages).toEqual([m]);
    expect(s.message_index).toEqual({ m1: 0 });
  });

  it('replaces in place via the cached index when it is still valid', () => {
    const s = session();
    const m1 = createMessage({ id: 'm1', role: 'assistant', content: 'hi', branch_id: 'main', timestamp: 't' });
    upsertMessage(s, m1);
    const m1b = createMessage({ id: 'm1', role: 'assistant', content: 'hi v2', branch_id: 'main', timestamp: 't2' });
    upsertMessage(s, m1b);
    expect(s.messages).toEqual([m1b]);
    expect(s.message_index).toEqual({ m1: 0 });
  });

  it('falls back to a linear scan and repairs the cache when the id was never indexed', () => {
    const s = session();
    // Simulates ~35 other call sites pushing directly without updating message_index.
    const direct = createMessage({ id: 'm-direct', role: 'user', content: 'hi', branch_id: 'main', timestamp: 't' });
    s.messages.push(direct);
    const replacement = createMessage({ id: 'm-direct', role: 'user', content: 'edited', branch_id: 'main', timestamp: 't2' });
    upsertMessage(s, replacement);
    expect(s.messages).toEqual([replacement]);
    expect(s.message_index).toEqual({ 'm-direct': 0 });
  });

  it('a stale cached index (bounds or id mismatch) is not trusted -- falls back to scan', () => {
    const s = session();
    const m1 = createMessage({ id: 'm1', role: 'assistant', content: 'hi', branch_id: 'main', timestamp: 't' });
    upsertMessage(s, m1);
    // Corrupt the cache on purpose (as if something else reordered session.messages mid-turn).
    s.message_index['m1'] = 5;
    const m1b = createMessage({ id: 'm1', role: 'assistant', content: 'hi v2', branch_id: 'main', timestamp: 't2' });
    upsertMessage(s, m1b);
    expect(s.messages).toEqual([m1b]);
    expect(s.message_index).toEqual({ m1: 0 });
  });
});
