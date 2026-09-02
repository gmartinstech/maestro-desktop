// engine/src/agents/manager/streaming/thinking.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/thinking.py: build the running 'Thought for Ns · N tokens ·
// N tools' consolidated-thinking message and broadcast it, plus the 1s ticker that keeps the
// elapsed counter moving between SDK events.
//
// DI seam: `ReasoningTokenProbe` stands in for the two `backend.apps.nine_router` calls the Python
// original makes inline (`is_running()` / `get_latest_reasoning_tokens(model_hint=...)`). 9Router
// itself has no TS port yet (a later, not-yet-scheduled ticket), so the default probe always reports
// "not running" -- the exact behavior the Python original falls back to today when nine_router's
// import fails or the process genuinely isn't up (`except Exception: pass` around the whole probe),
// NOT a stub that fakes availability. Once a real 9Router client exists in the engine, pass a real
// ReasoningTokenProbe implementation in rather than editing this file's fallback.

import { uuidHex } from '../../uuid';
import { wsManager } from '../../core/wsManager';
import { createMessage } from '../../sessionFactory';
import type { AgentSession } from '../../core/models';
import type { ThinkingState, TickerHandle, TurnState } from './state';

export interface ReasoningTokenProbe {
  isRunning(): Promise<boolean>;
  getLatestReasoningTokens(modelHint: string): Promise<number | null>;
}

/** Mirrors the Python original's fallback: no nine_router port exists yet, so every probe call
 * behaves exactly as an unreachable/not-installed 9Router does today (best-effort, silently
 * unavailable) -- see this file's header. */
export const unavailableReasoningTokenProbe: ReasoningTokenProbe = {
  isRunning: async () => false,
  getLatestReasoningTokens: async () => null,
};

async function probeUpstreamReasoningTokens(probe: ReasoningTokenProbe, modelHint: string): Promise<number | null> {
  try {
    if (await probe.isRunning()) {
      const rt = await probe.getLatestReasoningTokens(modelHint);
      if (rt && rt > 0) return rt;
    }
  } catch {
    // best-effort, mirrors the Python original's bare `except Exception: pass`
  }
  return null;
}

/** Build the running aggregate Message and broadcast it. Safe to call multiple times, uses a
 * stable per-turn id so the frontend dedupes by id and updates the bubble in place.
 *
 * Emission rule: emit when ANY of the following is true:
 *   1. Reasoning text exists (Anthropic happy path).
 *   2. Upstream provider reported reasoning tokens via 9Router (best-effort path for GPT/Gemini).
 *   3. `forceProviderUnavailable=true`, caller has determined this turn went through a translator
 *      that doesn't carry reasoning content (cx/ or gc/), and the user should see a "provider
 *      doesn't expose reasoning text" pill regardless of metric availability.
 */
export async function emitConsolidatedThinking(
  thinking: ThinkingState,
  turn: TurnState,
  session: AgentSession,
  sessionId: string,
  sessions: Map<string, AgentSession>,
  forceProviderUnavailable = false,
  probe: ReasoningTokenProbe = unavailableReasoningTokenProbe,
): Promise<void> {
  let upstreamReasoningTokens: number | null = null;
  // Probe for the upstream reasoning-token count whenever (a) there's no in-process text, OR (b)
  // the caller flagged this as a force-emit for a route that strips reasoning.
  if (thinking.textParts.length === 0 || forceProviderUnavailable) {
    upstreamReasoningTokens = await probeUpstreamReasoningTokens(probe, session.model);
    if (thinking.textParts.length === 0 && upstreamReasoningTokens === null && !forceProviderUnavailable) {
      // No text, no upstream signal, and caller didn't ask for the unavailable-pill -- nothing to show.
      return;
    }
  }

  const joinedText = thinking.textParts.join('\n');
  // Total turn output token estimate: SDK usage.output_tokens summed across completed
  // AssistantMessages (authoritative for finished blocks), OR'd with a chars/3.6 heuristic over the
  // running streams (covers in-flight blocks the SDK hasn't billed yet). Take the max so the number
  // doesn't visually shrink as the SDK's authoritative count overtakes the running heuristic.
  const runningChars = joinedText.length + turn.assistantTextChars + turn.toolInputChars;
  const heuristicTokens = runningChars ? Math.max(1, Math.round(runningChars / 3.6)) : 0;
  let turnTokens: number | null = null;
  if (upstreamReasoningTokens && upstreamReasoningTokens > 0) {
    turnTokens = upstreamReasoningTokens;
  } else if (turn.outputTokens > 0 || heuristicTokens > 0) {
    turnTokens = Math.max(turn.outputTokens, heuristicTokens);
  } else {
    turnTokens = await probeUpstreamReasoningTokens(probe, session.model);
  }

  if (turn.startedTs !== null) {
    turn.totalMs = Date.now() - turn.startedTs;
    // Accumulate into session-level "agent active time" and the per-model breakdown.
    try {
      session.agent_active_ms = (session.agent_active_ms || 0) + turn.totalMs;
      const m = session.model || 'unknown';
      session.time_per_model[m] = (session.time_per_model[m] || 0) + turn.totalMs;
    } catch {
      // best-effort, mirrors the Python original
    }
  }

  if (thinking.msgId === null) {
    thinking.msgId = uuidHex();
  }

  // Combined token total for the pill: parent input + output PLUS every direct sub-session's
  // (browser agents, invoke-agent forks) own usage, minus the turn-start baseline so the delta is
  // THIS TURN'S new tokens, not the whole session's running total.
  let cumIn = 0;
  let cumOut = 0;
  if (session.tokens && typeof session.tokens === 'object') {
    cumIn = Number(session.tokens.input_fresh || 0);
    cumOut = Number(session.tokens.output || 0);
  }
  let cumChildrenIn = 0;
  let cumChildrenOut = 0;
  try {
    const now = Date.now();
    if (turn.childSessionIds === null || now - turn.childSessionIdsCachedAt > 1000) {
      turn.childSessionIds = [];
      for (const [sid, child] of sessions) {
        if (child.parent_session_id === session.id) turn.childSessionIds.push(sid);
      }
      turn.childSessionIdsCachedAt = now;
    }
    for (const childId of turn.childSessionIds) {
      const child = sessions.get(childId);
      if (!child) continue;
      const ct = child.tokens;
      if (!ct || typeof ct !== 'object') continue;
      cumChildrenIn += Number(ct.input_fresh || 0);
      cumChildrenOut += Number(ct.output || 0);
    }
  } catch {
    // best-effort, mirrors the Python original
  }

  let parentIn: number;
  let parentOut: number;
  let childrenIn: number;
  let childrenOut: number;
  if (turn.baselineCaptured) {
    parentIn = Math.max(0, cumIn - turn.baselineSessionIn);
    parentOut = Math.max(0, cumOut - turn.baselineSessionOut);
    childrenIn = Math.max(0, cumChildrenIn - turn.baselineChildrenIn);
    childrenOut = Math.max(0, cumChildrenOut - turn.baselineChildrenOut);
  } else {
    parentIn = cumIn;
    parentOut = cumOut;
    childrenIn = cumChildrenIn;
    childrenOut = cumChildrenOut;
  }

  let turnTotalTokens: number | null = parentIn + parentOut + childrenIn + childrenOut;
  if (!turnTotalTokens || turnTotalTokens <= 0) turnTotalTokens = null;

  const consolidated = createMessage({
    id: thinking.msgId,
    role: 'thinking',
    content: joinedText,
    branch_id: session.active_branch_id,
    timestamp: new Date().toISOString(),
    elapsed_ms: turn.totalMs || null,
    tokens: turnTokens,
    input_tokens: turnTotalTokens,
    tool_count: turn.toolCount || null,
  });

  if (
    thinking.msgIndex !== null &&
    thinking.msgIndex < session.messages.length &&
    session.messages[thinking.msgIndex].id === thinking.msgId
  ) {
    session.messages[thinking.msgIndex] = consolidated;
  } else {
    // Safe fallback in case something else reordered session.messages mid-turn, making a cached
    // index wrong.
    const existingIdx = session.messages.findIndex((m) => m.id === thinking.msgId);
    if (existingIdx >= 0) {
      session.messages[existingIdx] = consolidated;
      thinking.msgIndex = existingIdx;
    } else {
      session.messages.push(consolidated);
      thinking.msgIndex = session.messages.length - 1;
    }
  }

  try {
    await wsManager.sendToSession(sessionId, 'agent:message', {
      session_id: sessionId,
      message: { ...consolidated },
    });
  } catch {
    // best-effort, mirrors the Python original's `except Exception: logger.exception(...)`
  }
}

/** Re-emit the consolidated thinking message every 1s so the elapsed-time counter keeps ticking
 * through gaps where no SDK events fire (e.g. while a tool is running or assistant text is being
 * generated). Cancelled at turn boundaries by the caller (via `TickerHandle.cancel()` +
 * `.settle()`). Mirrors `ticker_loop` exactly, including the "check cancelled, sleep, check
 * cancelled again" ordering (a cancel that lands mid-sleep is honored on wake, not retroactively). */
export function startTickerLoop(
  thinking: ThinkingState,
  turn: TurnState,
  session: AgentSession,
  sessionId: string,
  sessions: Map<string, AgentSession>,
  probe: ReasoningTokenProbe = unavailableReasoningTokenProbe,
): TickerHandle {
  let cancelled = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Wakes the pending sleep immediately on cancel -- without this, clearTimeout alone would leave
  // the awaited promise forever unsettled and `settle()` would never resolve (unlike a real
  // asyncio.Task, cancelling a plain JS timer doesn't reject/resolve the promise it was driving).
  let wake: (() => void) | null = null;

  function sleep1s(): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(() => {
        timer = null;
        wake = null;
        resolve();
      }, 1000);
    });
  }

  const run = (async () => {
    try {
      while (!cancelled) {
        await sleep1s();
        if (cancelled) break;
        await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, probe);
      }
    } finally {
      done = true;
    }
  })();

  return {
    isDone: () => done,
    cancel: () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (wake !== null) {
        const resolve = wake;
        wake = null;
        resolve();
      }
    },
    settle: () => run,
  };
}
