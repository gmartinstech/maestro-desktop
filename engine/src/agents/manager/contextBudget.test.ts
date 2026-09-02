// engine/src/agents/manager/contextBudget.test.ts -- AGT-5. Ports backend/tests/test_context_
// budget.py case-for-case: every branch of maybeCompact, plus emitContextUpdate's token
// persistence and the exact broadcast payload.

import { describe, expect, it, vi } from 'vitest';
import { createAgentSession, createMessage } from '../sessionFactory';
import type { AgentSession } from '../core/models';
import { wsManager } from '../core/wsManager';
import { emitContextUpdate, maybeCompact } from './contextBudget';

function pSessionWith(messages: number, inputTokens: number, contextWindow = 100, threshold = 0.65): AgentSession {
  const s = createAgentSession({ id: 's', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
  s.context_window = contextWindow;
  s.compact_threshold_pct = threshold;
  s.tokens = { input: inputTokens, output: 0 };
  s.messages = Array.from({ length: messages }, (_, i) =>
    createMessage({ id: `m${i}`, role: 'user', content: `m${i}`, branch_id: 'main', timestamp: new Date().toISOString() }),
  );
  return s;
}

function pCaptureWs() {
  const sent: Array<[string, unknown]> = [];
  const spy = vi.spyOn(wsManager, 'sendToSession').mockImplementation(async (_sid, event, data) => {
    sent.push([event, data]);
  });
  return { sent, spy };
}

describe('maybeCompact: every branch', () => {
  it('skips below threshold', () => {
    const s = pSessionWith(10, 10); // 0.10 < 0.65
    expect(maybeCompact(s)).toBe(false);
    expect(s.compacted_through_msg_id).toBeNull();
  });

  it('fires over threshold and marks the boundary', () => {
    const s = pSessionWith(7, 80); // 0.80 >= 0.65; cutoff = 7-6 = 1
    expect(maybeCompact(s)).toBe(true);
    expect(s.compacted_through_msg_id).toBe(s.messages[0].id);
  });

  it('keeps the last six messages', () => {
    const s = pSessionWith(10, 80); // cutoff = 10-6 = 4 -> boundary at msgs[3]
    expect(maybeCompact(s)).toBe(true);
    expect(s.compacted_through_msg_id).toBe(s.messages[3].id);
  });

  it('skips with six or fewer messages', () => {
    const s = pSessionWith(6, 80); // cutoff = max(0, 6-6) = 0
    expect(maybeCompact(s)).toBe(false);
  });

  it('skips under four messages', () => {
    const s = pSessionWith(3, 80);
    expect(maybeCompact(s)).toBe(false);
  });

  it('is idempotent', () => {
    const s = pSessionWith(7, 80);
    expect(maybeCompact(s)).toBe(true);
    const boundary = s.compacted_through_msg_id;
    expect(maybeCompact(s)).toBe(false); // already marked through that id
    expect(s.compacted_through_msg_id).toBe(boundary);
  });

  it('force bypasses the threshold and idempotency', () => {
    const s = pSessionWith(7, 1); // 0.01 < 0.65
    expect(maybeCompact(s, true)).toBe(true); // force ignores the ratio
    expect(maybeCompact(s, true)).toBe(true); // force re-marks even when unchanged
  });

  it('the absolute ceiling fires earlier than pct on a big window', () => {
    // 1M window, 200K used = 0.20: below the 0.65 pct but above the 180K ceiling (0.18), so it fires.
    const s = pSessionWith(7, 200_000, 1_000_000);
    expect(maybeCompact(s)).toBe(true);
  });

  it('the absolute ceiling does not fire below it on a big window', () => {
    const s = pSessionWith(7, 150_000, 1_000_000); // 0.15 < 0.18
    expect(maybeCompact(s)).toBe(false);
  });

  it('a small window is still governed by pct', () => {
    // 200K window: 130K (0.65) is tighter than the 180K ceiling, so pct still rules.
    const s = pSessionWith(7, 120_000, 200_000); // 0.60 < 0.65
    expect(maybeCompact(s)).toBe(false);
    const s2 = pSessionWith(7, 140_000, 200_000); // 0.70 >= 0.65
    expect(maybeCompact(s2)).toBe(true);
  });
});

describe('emitContextUpdate', () => {
  it('persists tokens and broadcasts', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const s = createAgentSession({ id: 's', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      s.context_window = 1000;
      await emitContextUpdate('sid', s, { input_tokens: 250, output_tokens: 40, cache_read_tokens: 10, cache_read_pct: 0.5 });
      expect(s.tokens.input).toBe(250);
      expect(s.tokens.output).toBe(40);
      expect(sent.length).toBe(1);
      const [event, data] = sent[0] as [string, Record<string, unknown>];
      expect(event).toBe('agent:context_update');
      expect(data.input_tokens).toBe(250);
      expect(data.output_tokens).toBe(40);
      expect(data.cache_read_tokens).toBe(10);
      expect(data.cache_read_pct).toBe(0.5);
      expect(data.ctx_used_pct).toBe(Math.round((250 / 1000) * 10_000) / 10_000);
      expect(data.context_window).toBe(1000);
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to the existing session tokens', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const s = createAgentSession({ id: 's', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      s.tokens = { input: 123, output: 7 };
      await emitContextUpdate('sid', s); // no explicit tokens -> reuse the session's
      const [, data] = sent[0] as [string, Record<string, unknown>];
      expect(data.input_tokens).toBe(123);
      expect(data.output_tokens).toBe(7);
    } finally {
      spy.mockRestore();
    }
  });

  it('zero input yields zero ctx pct', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const s = createAgentSession({ id: 's', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      await emitContextUpdate('sid', s, { input_tokens: 0 });
      const [, data] = sent[0] as [string, Record<string, unknown>];
      expect(data.ctx_used_pct).toBe(0.0);
    } finally {
      spy.mockRestore();
    }
  });
});
