// engine/src/agents/manager/metadata.test.ts -- AGT-5. Ports backend/tests/test_metadata.py
// case-for-case: the no-session guards and the fail-open fallback paths when the aux LLM is
// unavailable (this port's DI seam has no default, so simply not injecting resolveAuxModel/
// getAnthropicClientForModel reproduces the Python suite's `resolve_aux_model` monkeypatched to
// raise -- no mock needed, the absence itself is the failure).

import { describe, expect, it, vi } from 'vitest';
import { createAgentSession } from '../sessionFactory';
import { wsManager } from '../core/wsManager';
import { generateGroupMeta, generateTitle, generateTurnLabel } from './metadata';

function pCaptureWs() {
  const sent: Array<[string, unknown]> = [];
  const spy = vi.spyOn(wsManager, 'sendToSession').mockImplementation(async (_sid, event, data) => {
    sent.push([event, data]);
  });
  return { sent, spy };
}

describe('generateTitle (ports test_metadata.py)', () => {
  it('raises without a session', async () => {
    await expect(generateTitle(null, 'sid', 'hello')).rejects.toThrow();
  });

  it('falls back to the truncated prompt when the aux model is unavailable', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const session = createAgentSession({ id: 'x', name: 'x', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      const prompt = 'Plan me a really long trip to Tokyo with many stops and details everywhere';
      const title = await generateTitle(session, 'sid', prompt); // no deps injected -> aux path throws
      expect(title).toBe(prompt.slice(0, 40).trim());
      expect(session.name).toBe(title);
      expect(sent.some(([e]) => e === 'agent:name_updated')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('generateTurnLabel (ports test_metadata.py)', () => {
  it('is silent on aux failure', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const session = createAgentSession({ id: 'x', name: 'x', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      // best-effort: must NOT throw, and emits no label (the heuristic narrator stands in)
      await generateTurnLabel(session, 'sid', 'turn-1', 'do a thing');
      expect(sent.some(([e]) => e === 'agent:turn_label')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('generateGroupMeta (ports test_metadata.py)', () => {
  it('raises without a session', async () => {
    await expect(generateGroupMeta(null, 'sid', 'g1', [{ tool: 'Gmail' }])).rejects.toThrow();
  });

  it('falls back to a humanized tool name when the aux model is unavailable', async () => {
    const { sent, spy } = pCaptureWs();
    try {
      const session = createAgentSession({ id: 'x', name: 'x', model: 'sonnet', created_at: new Date().toISOString(), branches: {} });
      const result = await generateGroupMeta(session, 'sid', 'g1', [{ tool: 'mcp__gmail__send_email' }]);
      expect(result.name).toBe('Send Email'); // fallback: last __ segment, humanized
      expect(result.svg).toBe('');
      expect(session.tool_group_meta.g1).toBeTruthy(); // still records the group
      expect(sent.some(([e]) => e === 'agent:group_meta_updated')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
