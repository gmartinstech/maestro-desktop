// engine/src/agents/manager/session/compactSession.test.ts -- AGT-5. Ports
// backend/tests/test_compact_endpoint.py's business-logic assertions minus the FastAPI/HTTP layer
// (native `/api/agents/*` routing is AGT-6's milestone, not this ticket's): the session mutation
// (`compacted`/`needs_fresh_session`) and the "unknown session" case, expressed as `found: false`
// instead of an HTTP 404 (the route wiring's job to translate).

import { describe, expect, it } from 'vitest';
import { createAgentSession, createMessage } from '../../sessionFactory';
import type { AgentSession } from '../../core/models';
import { compactSession } from './compactSession';

function pSeed(n: number): AgentSession {
  const s = createAgentSession({ id: `sess-${n}`, name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
  s.context_window = 100;
  s.tokens = { input: 90, output: 0 }; // 0.90 -> over threshold
  s.messages = Array.from({ length: n }, (_, i) =>
    createMessage({ id: `m${i}`, role: 'user', content: `m${i}`, branch_id: 'main', timestamp: new Date().toISOString() }),
  );
  s.sdk_session_id = 'sdk-live-123';
  return s;
}

describe('compactSession (ports test_compact_endpoint.py)', () => {
  it('sets needs_fresh_session so the next turn rebuilds', async () => {
    const s = pSeed(10);
    const sessions = new Map([[s.id, s]]);
    const result = await compactSession(sessions, s.id);
    expect(result.found).toBe(true);
    expect(result.compacted).toBe(true);
    expect(s.compacted_through_msg_id).not.toBeNull();
    // The whole point: the button opts into the rebuild, so the next turn drops the SDK convo and
    // applies the cutoff/distill.
    expect(s.needs_fresh_session).toBe(true);
  });

  it('is a no-op when there is nothing to trim, and leaves state clean', async () => {
    const s = pSeed(3); // too few messages to compact
    const sessions = new Map([[s.id, s]]);
    const result = await compactSession(sessions, s.id);
    expect(result.found).toBe(true);
    expect(result.compacted).toBe(false);
    expect(s.needs_fresh_session).toBe(false);
  });

  it('reports not found for an unknown session', async () => {
    const result = await compactSession(new Map(), 'no-such-session');
    expect(result.found).toBe(false);
  });
});
