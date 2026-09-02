// engine/src/agents/manager/permissions/gateHooks.test.ts -- AGT-5. Ports
// backend/tests/test_gate_hooks.py case-for-case, using this port's DI-seam pattern (an injected
// `deps` object) in place of the Python suite's `unittest.mock.patch.object` module monkeypatching
// -- same behavior pinned (policy -> allow/deny, the ToolSearch loop-breaker fire + reset), a
// different (and, for this codebase, more idiomatic) mechanism for injecting the fakes.

import { describe, expect, it } from 'vitest';
import { createAgentSession } from '../../sessionFactory';
import { createHookContext } from '../streaming/hookContext';
import { canUseTool, preToolHook } from './gateHooks';
import { TOOLSEARCH_LOOP_THRESHOLD } from '../prompt/promptContext';

function pCtx() {
  const session = createAgentSession({ id: 's1', name: 't', model: 'sonnet', dashboard_id: 'd', created_at: new Date().toISOString(), branches: {} });
  return createHookContext({ session, sessionId: session.id, prompt: 'hi', sessions: new Map([[session.id, session]]) });
}

describe('canUseTool (ports test_gate_hooks.py::test_can_use_tool_*)', () => {
  it('always_allow returns allow', async () => {
    const ctx = pCtx();
    const result = await canUseTool(ctx, 'Read', { file_path: '/x' }, {
      maybeOverridePolicy: () => ['always_allow', undefined],
    });
    expect(result.behavior).toBe('allow');
  });

  it('deny returns deny', async () => {
    const ctx = pCtx();
    const result = await canUseTool(ctx, 'Bash', { command: 'rm -rf /' }, {
      maybeOverridePolicy: () => ['deny', undefined],
    });
    expect(result.behavior).toBe('deny');
  });

  it('ask routes through approval', async () => {
    const ctx = pCtx();
    const result = await canUseTool(ctx, 'Write', { file_path: '/x' }, {
      maybeOverridePolicy: () => ['ask', undefined],
      resolveAsk: async () => ({ behavior: 'allow' }),
    });
    expect(result.behavior).toBe('allow');
  });
});

describe('preToolHook (ports test_gate_hooks.py::test_pre_tool_hook_*)', () => {
  it('the ToolSearch loop-breaker fires at threshold', async () => {
    const ctx = pCtx();
    ctx.tsLoopCount = TOOLSEARCH_LOOP_THRESHOLD - 1;
    const out = await preToolHook(ctx, { tool_name: 'ToolSearch' }, 'tu1', {
      gatedMcpServerNames: () => ['gmail'],
      toolsearchLoopRedirect: () => 'Stop calling ToolSearch; use MCPActivate',
    });
    expect('hookSpecificOutput' in out).toBe(true);
    const deny = (out as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string } }).hookSpecificOutput;
    expect(deny.permissionDecision).toBe('deny');
    expect(deny.permissionDecisionReason).toContain('MCPActivate');
  });

  it('the counter resets on a non-ToolSearch call', async () => {
    const ctx = pCtx();
    ctx.tsLoopCount = 5;
    const out = await preToolHook(ctx, { tool_name: 'Read', tool_input: {} }, 'tu1', {
      maybeOverridePolicy: () => ['always_allow', undefined],
    });
    expect(ctx.tsLoopCount).toBe(0);
    expect(out).toEqual({});
    expect(ctx.toolStartTimes.has('tu1')).toBe(true); // an allowed tool records its start time
  });
});
