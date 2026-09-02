// engine/src/agents/manager/streaming/stopHook.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/stop_hook.py: the SDK Stop hook, an end-of-turn render gate
// for App Builder (view-builder) sessions. If the live preview failed to render, blocks the stop
// with the error so the agent fixes it, up to a retry cap, then lets the turn end.
//
// `OutputsRuntime` DI seam: the Python original reaches into `backend.apps.outputs.runtime.manager`
// (the App Builder dev-server/preview-render subsystem) for `.get(session.id)` and
// `.get_render_state_for_workspace(session.id)`. That subsystem has no TS port yet -- it's SUB's
// territory (the ticket queue names it explicitly: "outputs/App Builder (4.2k, hardest --
// npm/Vite/uvicorn spawning + signal semantics on Windows)"), not this ticket's. The default
// `OutputsRuntime` below returns "no workspace" for every session, which reproduces the Python
// original's OWN early-out (`if outputs_runtime_manager.get(session.id) is None: return {}`)
// exactly -- i.e. until a real outputs runtime exists in the engine, this hook is correctly a no-op
// for every session (never fabricates a render failure or a success), same as it is genuinely
// inert today for a session with no output workspace.

import { VIEW_BUILDER_RENDER_MAX_RETRIES, viewBuilderDirtySessions, viewBuilderRenderRetryCounts } from '../viewBuilderState';
import type { HookContext } from './hookContext';

export type RenderState = 'error' | 'ok' | null;

export interface OutputsRuntime {
  /** True when the session has an App Builder output workspace at all. */
  has(sessionId: string): boolean;
  /** [state, errorText] -- state is null while the render hasn't reported yet (the caller polls). */
  getRenderStateForWorkspace(sessionId: string): [RenderState, string];
}

/** Mirrors the Python original's `outputs_runtime_manager.get(session.id) is None` early-out --
 * see this file's header. */
export const noOutputsRuntime: OutputsRuntime = {
  has: () => false,
  getRenderStateForWorkspace: () => [null, ''],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StopHookResult {
  decision?: 'block';
  reason?: string;
}

/** End-of-turn render gate for App Builder sessions. Reads the browser-reported render-state of
 * the preview; if the app fails to render, blocks with the error so the agent fixes it, up to
 * MAX_RETRIES then lets the stop through. `inputData`/`toolUseId`/`context` are accepted for
 * signature parity with the SDK Stop hook protocol (mirrors the Python original's unused
 * parameters) but are not read. */
export async function stopHook(ctx: HookContext, _inputData: unknown, _toolUseId: unknown, _context: unknown, runtime: OutputsRuntime = noOutputsRuntime): Promise<StopHookResult> {
  const session = ctx.session;
  if (session.mode !== 'view-builder') return {};
  if (!viewBuilderDirtySessions.has(session.id)) return {};
  if (!runtime.has(session.id)) return {};

  let [state, errorText] = runtime.getRenderStateForWorkspace(session.id);
  let waited = 0;
  while (state === null && waited < 5000) {
    await sleep(250);
    waited += 250;
    [state, errorText] = runtime.getRenderStateForWorkspace(session.id);
  }

  if (state !== 'error') {
    viewBuilderRenderRetryCounts.delete(session.id);
    viewBuilderDirtySessions.delete(session.id);
    return {};
  }

  const attempts = viewBuilderRenderRetryCounts.get(session.id) ?? 0;
  if (attempts >= VIEW_BUILDER_RENDER_MAX_RETRIES) {
    viewBuilderRenderRetryCounts.delete(session.id);
    viewBuilderDirtySessions.delete(session.id);
    return {};
  }

  viewBuilderRenderRetryCounts.set(session.id, attempts + 1);
  const trimmed = errorText.length > 3000 ? errorText.slice(-3000) : errorText;
  return {
    decision: 'block',
    reason:
      `The preview failed to render (attempt ${attempts + 1}/${VIEW_BUILDER_RENDER_MAX_RETRIES}):\n\n` +
      `${trimmed}\n\n` +
      "Fix this so the app renders before finishing; the user currently sees an error instead of the app.",
  };
}
