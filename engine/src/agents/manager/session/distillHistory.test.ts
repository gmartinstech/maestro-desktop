// engine/src/agents/manager/session/distillHistory.test.ts -- AGT-5. Ports
// backend/tests/test_distill_history.py case-for-case. The Python suite's `monkeypatch.setattr(dh,
// "p_call_distiller", fake)` becomes this port's `deps.callDistiller` seam; the one test that
// exercises the REAL `p_call_distiller` path (`test_aux_call_requests_the_fixed_sections_in_order`)
// instead injects `deps.resolveAuxModel`/`deps.getAnthropicClientForModel`, leaving `callDistiller`
// on its real default -- same "only the provider plumbing is stubbed" shape the Python test's own
// docstring describes.

import { describe, expect, it } from 'vitest';
import { createAgentSession, createMessage } from '../../sessionFactory';
import type { AgentSession } from '../../core/models';
import { defaultAppSettings } from '../../../settings/models';
import { distilledHistorySummary, type AnthropicLikeMessage } from './distillHistory';

const SECTIONS = ['## GOAL', '## CONSTRAINTS', '## DECISIONS', '## PROGRESS', '## FILES & FACTS', '## OPEN THREADS'];

function pSession(n: number): AgentSession {
  const s = createAgentSession({ id: 's', name: 't', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
  s.messages = Array.from({ length: n }, (_, i) =>
    createMessage({ id: `m${i}`, role: 'user', content: `turn ${i}`, branch_id: 'main', timestamp: new Date().toISOString() }),
  );
  return s;
}

const settings = defaultAppSettings();

describe('distilledHistorySummary (ports test_distill_history.py)', () => {
  it('returns empty with no cutoff', async () => {
    const calls: string[] = [];
    const s = pSession(8);
    const out = await distilledHistorySummary(s, settings, {
      callDistiller: async (_s, _st, body) => {
        calls.push(body);
        return `SUMMARY[${body.length} chars]`;
      },
    });
    expect(out).toBe('');
    expect(calls).toEqual([]);
  });

  it('summarizes the dropped span and caches it', async () => {
    const calls: string[] = [];
    const s = pSession(8);
    s.compacted_through_msg_id = s.messages[3].id; // drop turns 0..3
    const callDistiller = async (_s: AgentSession, _st: typeof settings, body: string) => {
      calls.push(body);
      return `SUMMARY[${body.length} chars]`;
    };
    const out = await distilledHistorySummary(s, settings, { callDistiller });
    expect(out.startsWith('SUMMARY[')).toBe(true);
    expect(s.compacted_summary).toBe(out);
    expect(s.compacted_summary_through).toBe(s.messages[3].id);
    expect(calls[0]).toContain('turn 0');
    expect(calls[0]).toContain('turn 3');
    expect(calls[0]).not.toContain('turn 4'); // surviving turns aren't distilled

    // Second call at the same cutoff reuses the cache, no new aux call.
    const again = await distilledHistorySummary(s, settings, { callDistiller });
    expect(again).toBe(out);
    expect(calls.length).toBe(1);
  });

  it('recomputes when the cutoff advances', async () => {
    const calls: string[] = [];
    const s = pSession(10);
    s.compacted_through_msg_id = s.messages[3].id;
    const callDistiller = async (_s: AgentSession, _st: typeof settings, body: string) => {
      calls.push(body);
      return `SUMMARY[${body.length} chars]`;
    };
    await distilledHistorySummary(s, settings, { callDistiller });
    s.compacted_through_msg_id = s.messages[6].id; // cutoff moved forward
    await distilledHistorySummary(s, settings, { callDistiller });
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('turn 6');
  });

  it('fails open on an aux error', async () => {
    const s = pSession(8);
    s.compacted_through_msg_id = s.messages[3].id;
    const out = await distilledHistorySummary(s, settings, {
      callDistiller: async () => {
        throw new Error('provider down');
      },
    });
    expect(out).toBe('');
    expect(s.compacted_summary).toBeNull();
  });

  it('does not serve a stale cache when the cutoff left the branch', async () => {
    const s = pSession(8);
    s.compacted_through_msg_id = s.messages[3].id;
    const callDistiller = async () => 'SUMMARY[x]';
    await distilledHistorySummary(s, settings, { callDistiller }); // caches
    expect(s.compacted_summary).not.toBeNull();
    // Simulate a branch edit that dropped the cutoff message from the active branch.
    const droppedId = s.messages[3].id;
    s.messages = s.messages.filter((m) => m.id !== droppedId);
    const out = await distilledHistorySummary(s, settings, { callDistiller });
    expect(out).toBe(''); // membership check fires before the cache, so the stale summary is not served
  });

  it('the kill switch disables distillation', async () => {
    const calls: string[] = [];
    const s = pSession(8);
    s.compacted_through_msg_id = s.messages[3].id;
    const out = await distilledHistorySummary(s, settings, {
      distillEnabled: false,
      callDistiller: async (_s, _st, body) => {
        calls.push(body);
        return 'SUMMARY[x]';
      },
    });
    expect(out).toBe('');
    expect(calls).toEqual([]);
  });

  it('the real aux call requests the fixed sections in order', async () => {
    // Real distiller path (only the provider plumbing is stubbed): the prompt that actually
    // reaches the aux model must enumerate the fixed checkpoint sections, not ask for free prose.
    const captured: { messages?: Array<{ content: string }>; max_tokens?: number } = {};
    const s = pSession(8);
    s.compacted_through_msg_id = s.messages[3].id;
    const out = await distilledHistorySummary(s, settings, {
      resolveAuxModel: async () => ['claude-haiku-4-5-20251001', null],
      getAnthropicClientForModel: () => ({
        messages: {
          create: async (params) => {
            Object.assign(captured, params);
            return { content: [{ text: '## GOAL\n- ship it\n' }] } as AnthropicLikeMessage;
          },
        },
      }),
    });
    expect(out).toBe('## GOAL\n- ship it');
    const sent = captured.messages![0].content;
    expect(sent).toContain('turn 0');
    expect(sent).toContain('turn 3');
    const positions = SECTIONS.map((h) => sent.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // A bare header is worse than the free prose this replaced, so the empty-section escape
    // hatch has to survive edits.
    expect(sent).toContain('- none');
    // The six-section form needs more room than the old single-blob briefing or it stops mid-section.
    expect(captured.max_tokens!).toBeGreaterThanOrEqual(1600);
  });
});
