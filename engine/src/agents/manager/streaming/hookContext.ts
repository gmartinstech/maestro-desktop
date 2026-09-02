// engine/src/agents/manager/streaming/hookContext.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/HookContext.py: captured per-run state for the SDK tool
// hooks (can_use_tool / pre / post / stop). Passed by reference into the extracted hook functions so
// they can mutate the shared counters without living inside the agent loop's closure. `session` is
// the SAME object the loop holds (a JS object reference needs no `InstanceOf`-equivalent to keep
// that true -- unlike pydantic, plain TS objects are never implicitly copied), so hook-side
// mutations to status/pending_approvals are visible to the loop.
//
// Only the fields stopHook.ts actually reads/writes are populated here (`session`, `sessionId`).
// The full field set (`prompt`, `builtinPerms`, `policyDefaults`, `sessions`, `toolStartTimes`,
// `tsLoopCount`, `mcpOfferSent`) backs the OTHER gate hooks (can_use_tool/pre_tool_hook/
// post_tool_hook, all AGT-5's "permission gates" territory) -- declared here for shape completeness
// since HookContext is a single shared object all of them read, but not yet populated by anything
// in this ticket's scope.

import type { AgentSession } from '../../core/models';

export interface HookContext {
  session: AgentSession;
  sessionId: string;
  prompt: string;
  builtinPerms: Record<string, string>;
  policyDefaults: Record<string, string>;
  // The manager's LIVE session registry -- a Map reference (not copied), so a sub-agent a hook
  // spawns is visible to the manager.
  sessions: Map<string, AgentSession>;
  // tool_use_id -> wall-clock start (ms); pre records it, post pops it for elapsed_ms.
  toolStartTimes: Map<string, number>;
  // Consecutive ToolSearch calls; a run of these is the "looping on ToolSearch" wedge.
  tsLoopCount: number;
  // One mid-run "connect this MCP" card per run; a stuck agent retries, the user sees it once.
  mcpOfferSent: boolean;
}

export function createHookContext(overrides: Pick<HookContext, 'session' | 'sessionId' | 'prompt' | 'sessions'> & Partial<HookContext>): HookContext {
  return {
    session: overrides.session,
    sessionId: overrides.sessionId,
    prompt: overrides.prompt,
    builtinPerms: overrides.builtinPerms ?? {},
    policyDefaults: overrides.policyDefaults ?? {},
    sessions: overrides.sessions,
    toolStartTimes: overrides.toolStartTimes ?? new Map(),
    tsLoopCount: overrides.tsLoopCount ?? 0,
    mcpOfferSent: overrides.mcpOfferSent ?? false,
  };
}
