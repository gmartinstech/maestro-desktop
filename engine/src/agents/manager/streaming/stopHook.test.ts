// engine/src/agents/manager/streaming/stopHook.test.ts -- AGT-4. Ports backend/tests/
// test_stop_hook.py's three cases (inert off view-builder mode, inert when not dirty, blocks on a
// render error under the retry cap), plus direct coverage of the cap-exhaustion give-up and the
// "renders fine" clean-exit path the ticket's stop-hook-behaviour instruction calls out.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopHook, type OutputsRuntime, type RenderState } from './stopHook';
import { VIEW_BUILDER_RENDER_MAX_RETRIES, viewBuilderDirtySessions, viewBuilderRenderRetryCounts } from '../viewBuilderState';
import { createHookContext } from './hookContext';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';

function ctx(mode: string, sessionId: string) {
  const session = createAgentSession({
    id: sessionId,
    name: 't',
    mode,
    created_at: '2026-01-01T00:00:00',
    branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
  });
  return createHookContext({ session, sessionId, prompt: 'hi', sessions: new Map([[sessionId, session]]) });
}

function fixedRuntime(state: RenderState, errorText = ''): OutputsRuntime {
  return {
    has: () => true,
    getRenderStateForWorkspace: () => [state, errorText],
  };
}

describe('stopHook', () => {
  let sessionId: string;
  let counter = 0;

  beforeEach(() => {
    sessionId = `sh-${counter++}`;
  });
  afterEach(() => {
    viewBuilderDirtySessions.delete(sessionId);
    viewBuilderRenderRetryCounts.delete(sessionId);
  });

  it('is inert when the session is not view-builder mode (ports test_stop_hook_inert_when_not_view_builder)', async () => {
    const c = ctx('agent', sessionId);
    expect(await stopHook(c, {}, null, null)).toEqual({});
  });

  it('is inert when the session is view-builder but not dirty (ports test_stop_hook_inert_when_not_dirty)', async () => {
    const c = ctx('view-builder', sessionId); // dirty set is empty -> nothing to gate
    expect(await stopHook(c, {}, null, null)).toEqual({});
  });

  it('blocks the stop on a render error under the retry cap (ports test_stop_hook_blocks_on_render_error_under_cap)', async () => {
    const c = ctx('view-builder', sessionId);
    viewBuilderDirtySessions.add(sessionId);
    const runtime = fixedRuntime('error', 'boom traceback');
    const out = await stopHook(c, {}, null, null, runtime);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('failed to render');
    expect(out.reason).toContain('boom traceback');
  });

  it('is inert when the session has no output workspace at all (default no-op runtime)', async () => {
    const c = ctx('view-builder', sessionId);
    viewBuilderDirtySessions.add(sessionId);
    expect(await stopHook(c, {}, null, null)).toEqual({});
  });

  it('clears dirty + retry state and lets the stop through once the preview renders fine', async () => {
    const c = ctx('view-builder', sessionId);
    viewBuilderDirtySessions.add(sessionId);
    viewBuilderRenderRetryCounts.set(sessionId, 1);
    const out = await stopHook(c, {}, null, null, fixedRuntime('ok'));
    expect(out).toEqual({});
    expect(viewBuilderDirtySessions.has(sessionId)).toBe(false);
    expect(viewBuilderRenderRetryCounts.has(sessionId)).toBe(false);
  });

  it('gives up and lets the stop through once the retry cap is exhausted', async () => {
    const c = ctx('view-builder', sessionId);
    viewBuilderDirtySessions.add(sessionId);
    viewBuilderRenderRetryCounts.set(sessionId, VIEW_BUILDER_RENDER_MAX_RETRIES);
    const out = await stopHook(c, {}, null, null, fixedRuntime('error', 'still broken'));
    expect(out).toEqual({});
    expect(viewBuilderRenderRetryCounts.has(sessionId)).toBe(false);
    expect(viewBuilderDirtySessions.has(sessionId)).toBe(false);
  });

  it('increments the retry counter across successive blocked attempts', async () => {
    const c = ctx('view-builder', sessionId);
    viewBuilderDirtySessions.add(sessionId);
    const runtime = fixedRuntime('error', 'still broken');
    const first = await stopHook(c, {}, null, null, runtime);
    expect(first.decision).toBe('block');
    expect(viewBuilderRenderRetryCounts.get(sessionId)).toBe(1);
    viewBuilderDirtySessions.add(sessionId); // stays dirty across the simulated re-render attempt
    const second = await stopHook(c, {}, null, null, runtime);
    expect(second.decision).toBe('block');
    expect(viewBuilderRenderRetryCounts.get(sessionId)).toBe(2);
  });
});
