// engine/src/agents/manager/contextBudget.ts -- AGT-5, a full port of
// backend/apps/agents/manager/context_budget.py: token accounting + the context-ratio compaction
// trigger. Both operate on a passed AgentSession (no manager state). `emitContextUpdate` writes the
// live token counts onto the session and broadcasts them to the UI; `maybeCompact` decides, from
// the same input_tokens/context_window ratio, whether to mark history for trimming.
//
// Compaction here only MARKS (sets compacted_through_msg_id); it never mutates session.messages --
// see backend/CLAUDE.md: "compaction must actually trim, not just mark".

import type { AgentSession } from '../core/models';
import { wsManager } from '../core/wsManager';
import { getBranchMessages } from './session/historyCompaction';

/** Mark history for compaction when ctx_used_pct >= compact_threshold_pct (or force). Returns true
 * if a NEW summary boundary was set. Summarizes everything up to (but not including) the last 6
 * messages so recent intent stays visible to the model. Never touches session.messages. */
export function maybeCompact(session: AgentSession, force = false): boolean {
  const windowSize = Math.max(1, session.context_window);
  // Fire at the TIGHTER of the pct or the absolute ceiling: on a 200K window the pct wins (130K),
  // on a 1M window the ceiling wins (180K, not 650K). Not "just 65%".
  const absPct = Math.min(1.0, session.compact_abs_ceiling_tokens / windowSize);
  const trigger = Math.min(session.compact_threshold_pct, absPct);
  const ctxUsed = (session.tokens.input ?? 0) / windowSize;
  if (!force && ctxUsed < trigger) return false;
  const msgs = getBranchMessages(session);
  if (msgs.length < 4) return false;
  const cutoff = Math.max(0, msgs.length - 6);
  if (cutoff === 0) return false;
  const lastId = msgs[cutoff - 1].id;
  if (session.compacted_through_msg_id === lastId && !force) return false;
  session.compacted_through_msg_id = lastId;
  return true;
}

export interface EmitContextUpdateOptions {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_read_pct?: number;
}

/** Persist the live token counts onto the session and broadcast the context-usage meter to the UI.
 * When input/output aren't supplied, the session's current counts are reused. */
export async function emitContextUpdate(sessionId: string, session: AgentSession, options: EmitContextUpdateOptions = {}): Promise<void> {
  const inputTokens = options.input_tokens ?? Math.trunc(session.tokens.input ?? 0);
  const outputTokens = options.output_tokens ?? Math.trunc(session.tokens.output ?? 0);
  session.tokens.input = inputTokens;
  session.tokens.output = outputTokens;
  const ctxWindow = Math.max(1, session.context_window || 200_000);
  await wsManager.sendToSession(sessionId, 'agent:context_update', {
    session_id: sessionId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: options.cache_read_tokens ?? 0,
    cache_read_pct: options.cache_read_pct ?? 0.0,
    ctx_used_pct: inputTokens ? Math.round((inputTokens / ctxWindow) * 10_000) / 10_000 : 0.0,
    context_window: ctxWindow,
    framework_overhead_tokens: session.framework_overhead_tokens,
    active_mcps: [...session.active_mcps],
  });
}
