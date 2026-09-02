// engine/src/agents/manager/streaming/handleResultMessage.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/handle_result_message.py: handle the SDK ResultMessage that
// closes a turn -- fold in authoritative output tokens, write the session's token + cost totals
// (recomputing cost off-Anthropic-rate routes), emit the final consolidated thinking pill, broadcast
// the context-usage update, and reset the per-turn TurnState/ThinkingState. Mutates the passed state
// by reference exactly as inline. `resolvedModel`/`apiType`/`globalSettings` are the loop's per-run
// config, threaded in (`globalSettings` is accepted but unused, matching the Python original's own
// unused parameter -- kept for call-site signature fidelity with TurnRunner.ts).
//
// `PricingLookup` DI seam: the Python original imports `get_openrouter_pricing`/`get_direct_pricing`
// from `providers/openrouter.py`, which AGT-1 deliberately did NOT port (its own row: "no catalog
// entry uses route=openrouter" in the differential gate, so `OPENROUTER_VALUE_PREFIX` was inlined
// and the rest of that file left unported). This file respects that same scope boundary rather than
// reaching around it: the default `PricingLookup` returns `null` for both lookups, which reproduces
// the Python original's OWN fallback for an unrecognized model in these families exactly ("Unknown
// model in this family: zero out rather than ship an Anthropic-rate estimate that's wildly wrong")
// -- not a stub that fakes a price. Whichever ticket ports openrouter.py should supply a real
// PricingLookup here rather than edit this file's fallback.

import { wsManager } from '../../core/wsManager';
import { emitConsolidatedThinking, unavailableReasoningTokenProbe, type ReasoningTokenProbe } from './thinking';
import type { AgentSession } from '../../core/models';
import type { ThinkingState, TurnState } from './state';

export interface ResultMessageLike {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    [k: string]: unknown;
  } | null;
  total_cost_usd?: number | null;
  session_id?: string | null;
}

export interface PricingLookup {
  getOpenrouterPricing(resolvedModel: string): [number, number] | null;
  getDirectPricing(model: string): [number, number] | null;
}

export const zeroPricingLookup: PricingLookup = {
  getOpenrouterPricing: () => null,
  getDirectPricing: () => null,
};

export async function handleResultMessage(
  message: ResultMessageLike,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  sessions: Map<string, AgentSession>,
  resolvedModel: string | null,
  apiType: string | null,
  globalSettings: unknown,
  pricing: PricingLookup = zeroPricingLookup,
  probe: ReasoningTokenProbe = unavailableReasoningTokenProbe,
): Promise<void> {
  void globalSettings;

  // ResultMessage carries the AUTHORITATIVE per-turn output_tokens count. Some providers (notably
  // OpenAI/Gemini through 9Router) only populate this here, not on individual AssistantMessages.
  // Fold this in BEFORE emitting the final consolidated thinking message so the pill reflects
  // ground truth on those providers too.
  try {
    const resultOut = Number(message.usage?.output_tokens ?? 0);
    // Take the max: if individual AssistantMessages already summed to a larger number, trust that;
    // otherwise ResultMessage's count fills the gap.
    if (resultOut > turn.outputTokens) turn.outputTokens = resultOut;
  } catch {
    // best-effort, mirrors the Python original
  }

  // Pre-populate session.tokens BEFORE emitting the final consolidated thinking pill. Order
  // matters: emitConsolidatedThinking reads session.tokens for the combined-total stamp on the
  // pill -- emitting first would freeze the pill at input=0.
  try {
    const preUsage = message.usage ?? {};
    const preIn = Number(preUsage.input_tokens ?? 0);
    const preCreate = Number(preUsage.cache_creation_input_tokens ?? 0);
    const preRead = Number(preUsage.cache_read_input_tokens ?? 0);
    const preTotalIn = preIn + preCreate + preRead;
    const preOut = Number(preUsage.output_tokens ?? 0);
    if (preTotalIn > 0) session.tokens.input = preTotalIn;
    // Pill reads the fresh lane: uncached input only, so re-read/cached context doesn't inflate it.
    session.tokens.input_fresh = preIn;
    if (preOut > 0) session.tokens.output = preOut;
  } catch {
    // best-effort, mirrors the Python original
  }

  // Final consolidated emission with the full duration + authoritative tokens. For routes whose
  // translator strips reasoning content (cx/gc/ag/gemini/), force-emit a pill even with no text/
  // upstream token count captured, otherwise those turns show no thinking bubble at all.
  const routeStripsReasoning = typeof resolvedModel === 'string' && ['cx/', 'gc/', 'ag/', 'gemini/'].some((p) => resolvedModel.startsWith(p));
  if (thinking.textParts.length > 0 || routeStripsReasoning) {
    try {
      await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, routeStripsReasoning, probe);
    } catch {
      // best-effort, mirrors the Python original's bare except
    }
  }
  if (thinking.tickerTask !== null && !thinking.tickerTask.isDone()) {
    thinking.tickerTask.cancel();
    try {
      await thinking.tickerTask.settle();
    } catch {
      // mirrors `except (asyncio.CancelledError, Exception): pass`
    }
  }
  thinking.tickerTask = null;
  thinking.msgId = null;
  thinking.textParts = [];
  turn.toolCount = 0;
  turn.startedTs = null;
  turn.totalMs = 0;
  turn.outputTokens = 0;
  turn.assistantTextChars = 0;
  turn.toolInputChars = 0;
  thinking.thoughtSignature = null;
  turn.baselineSessionIn = 0;
  turn.baselineSessionOut = 0;
  turn.baselineChildrenIn = 0;
  turn.baselineChildrenOut = 0;
  turn.baselineCaptured = false;
  thinking.totalMs = 0;
  thinking.blockStarts.clear();

  session.sdk_session_id = message.session_id ?? null;
  // Pull usage first; the SDK's total_cost_usd assumes Anthropic rates and is recomputed below.
  const usage = message.usage ?? {};
  const inp = Number(usage.input_tokens ?? 0);
  const out = Number(usage.output_tokens ?? 0);
  const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const totalInput = inp + cacheCreate + cacheRead;
  session.tokens.input = totalInput;
  session.tokens.input_fresh = inp;
  session.tokens.output = out;

  let cost = message.total_cost_usd ?? null;
  if (cost !== null) {
    let freeRoute = false;
    if (typeof resolvedModel === 'string') {
      if (['cc/', 'cx/', 'gc/', 'ag/'].some((p) => resolvedModel.startsWith(p))) {
        freeRoute = true;
      } else if (resolvedModel.startsWith('openrouter/') && resolvedModel.includes(':free')) {
        freeRoute = true;
      } else if (resolvedModel.startsWith('cp-')) {
        // User-configured custom OpenAI-compatible provider (Ollama Cloud, Together, Groq, local
        // LMs, etc.). Pricing is unknowable without per-provider rate tables that would rot fast.
        freeRoute = true;
      }
    }
    if (freeRoute) {
      cost = 0.0;
    } else if (typeof resolvedModel === 'string' && resolvedModel.startsWith('openrouter/')) {
      // SDK assumes Anthropic rates -> 50-100x off for OR.
      const orPricing = pricing.getOpenrouterPricing(resolvedModel);
      if (orPricing) {
        const [inRate, outRate] = orPricing;
        cost = ((inp + cacheCreate + cacheRead) * inRate + out * outRate) / 1_000_000;
      }
    } else if (
      apiType === 'openai' ||
      apiType === 'gemini' ||
      (typeof resolvedModel === 'string' && (resolvedModel.startsWith('cp-openai/') || resolvedModel.startsWith('cp-gemini/') || resolvedModel.startsWith('cp-google/')))
    ) {
      // Direct OpenAI/Gemini API key lane -- use published per-model rates, not Anthropic's.
      const directPricing = pricing.getDirectPricing(resolvedModel ?? '') ?? pricing.getDirectPricing(session.model);
      if (directPricing) {
        const [inRate, outRate] = directPricing;
        cost = ((inp + cacheCreate + cacheRead) * inRate + out * outRate) / 1_000_000;
      } else {
        // Unknown model in this family: zero out rather than ship an Anthropic-rate estimate.
        cost = 0.0;
      }
    }

    session.cost_usd = cost;
    await wsManager.sendToSession(sessionId, 'agent:cost_update', {
      session_id: sessionId,
      cost_usd: session.cost_usd,
    });
  }

  // Per-turn context-usage broadcast. Drives the UI status pill and the auto-compact threshold.
  const ctxWindow = Math.max(1, session.context_window || 200_000);
  const ctxUsedPct = totalInput ? Math.round((totalInput / ctxWindow) * 10_000) / 10_000 : 0.0;
  const cacheReadPct = totalInput ? Math.round((cacheRead / totalInput) * 10_000) / 10_000 : 0.0;
  try {
    await wsManager.sendToSession(sessionId, 'agent:context_update', {
      session_id: sessionId,
      input_tokens: totalInput,
      output_tokens: out,
      cache_read_tokens: cacheRead,
      cache_read_pct: cacheReadPct,
      ctx_used_pct: ctxUsedPct,
      context_window: ctxWindow,
      framework_overhead_tokens: session.framework_overhead_tokens,
      active_mcps: [...session.active_mcps],
    });
  } catch {
    // best-effort, mirrors the Python original's `logger.exception`
  }
}
