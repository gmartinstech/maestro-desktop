// engine/src/agents/providers/pricing.ts -- AGT-1, a faithful TypeScript port of
// backend/apps/agents/providers/pricing.py: model tier scoring + billing-kind classification for
// the picker hover card. Pure, no I/O, no external deps -- ported near-verbatim, comments included.

// --------------------------------------------------------------------------- Curated model tiers; Intelligence, Speed, Cost on a 1-5 scale --------------------------------------------------------------------------- Hand-tuned from public benchmarks + per-token pricing (knowledge cutoff Jan 2026). The tier numbers serve the picker hover card so users can pick a model that fits the task without reading a leaderboard. Intelligence:  5 = frontier reasoner, 1 = nano / specialised tiny Speed:         5 = sub-second TTFT + 250 tok/s, 1 = slow + thinking Cost:          5 = $25+/M output, 1 = under $0.50/M output (or free) Lookup order (computeTiers below): 1. Bare model_id direct 2. ":free" stripped (so anthropic/claude-opus-4.7:free shares scoring with anthropic/claude-opus-4.7) 3. Vendor-prefixed and bare-after-slash variants for cross-format coverage (so "claude-opus-4-7" matches "anthropic/claude-opus-4.7") 4. Last-path-component normalised (dashes <-> dots) Models not in this map fall through to a heuristic that uses cost bucket + reasoning flag + name-keyword adjustments. (intelligence, speed, cost) on a 1-5 scale. Tiers: 5 frontier, 4 top open / strong sub, 3 solid mid, 2 small specialised, 1 nano.
export type ModelTier = readonly [intelligence: number, speed: number, cost: number];

export const MODEL_TIERS: Readonly<Record<string, ModelTier>> = {
  // Anthropic
  'claude-fable-5': [5, 2, 5],
  'anthropic/claude-fable-5': [5, 2, 5],
  'claude-opus-4-8': [5, 2, 5],
  'claude-opus-4.8': [5, 2, 5],
  'anthropic/claude-opus-4.8': [5, 2, 5],
  'claude-opus-4-7': [5, 2, 5],
  'claude-opus-4.7': [5, 2, 5],
  'anthropic/claude-opus-4.7': [5, 2, 5],
  'claude-opus-4-6': [5, 2, 5],
  'claude-opus-4.6': [5, 2, 5],
  'anthropic/claude-opus-4.6': [5, 2, 5],
  'claude-opus-4-5': [5, 2, 5],
  'claude-opus-4': [5, 2, 5],
  'anthropic/claude-opus-4': [5, 2, 5],
  'claude-sonnet-4-6': [4, 4, 3],
  'claude-sonnet-4.6': [4, 4, 3],
  'anthropic/claude-sonnet-4.6': [4, 4, 3],
  'claude-sonnet-4-5': [4, 4, 3],
  'claude-sonnet-4.5': [4, 4, 3],
  'anthropic/claude-sonnet-4.5': [4, 4, 3],
  'claude-sonnet-4': [4, 4, 3],
  'anthropic/claude-sonnet-4': [4, 4, 3],
  'claude-3.7-sonnet': [4, 4, 3],
  'anthropic/claude-3.7-sonnet': [4, 4, 3],
  'claude-haiku-4-5': [3, 5, 2],
  'claude-haiku-4.5': [3, 5, 2],
  'anthropic/claude-haiku-4.5': [3, 5, 2],
  'claude-3.5-haiku': [2, 5, 2],
  'anthropic/claude-3.5-haiku': [2, 5, 2],
  'claude-3-haiku': [2, 5, 1],
  'anthropic/claude-3-haiku': [2, 5, 1],

  // OpenAI
  'gpt-5.5': [5, 2, 5],
  'openai/gpt-5.5': [5, 2, 5],
  'gpt-5.5-pro': [5, 1, 5],
  'openai/gpt-5.5-pro': [5, 1, 5],
  'gpt-5.4': [4, 3, 4],
  'openai/gpt-5.4': [4, 3, 4],
  'gpt-5.4-mini': [3, 4, 2],
  'openai/gpt-5.4-mini': [3, 4, 2],
  'gpt-5': [4, 3, 4],
  'openai/gpt-5': [4, 3, 4],
  'gpt-5-mini': [3, 4, 2],
  'openai/gpt-5-mini': [3, 4, 2],
  'gpt-5-nano': [2, 5, 1],
  'openai/gpt-5-nano': [2, 5, 1],
  'gpt-chat-latest': [3, 4, 2],
  'openai/gpt-chat-latest': [3, 4, 2],
  'gpt-oss-120b': [3, 3, 1],
  'openai/gpt-oss-120b': [3, 3, 1],
  'gpt-oss-20b': [2, 4, 1],
  'openai/gpt-oss-20b': [2, 4, 1],

  // Google
  'gemini-3.5-flash': [4, 5, 2],
  'google/gemini-3.5-flash': [4, 5, 2],
  'gemini-3.1-pro-preview': [5, 3, 4],
  'gemini-3.1-pro': [5, 3, 4],
  'google/gemini-3.1-pro': [5, 3, 4],
  'gemini-3.1-flash-lite-preview': [2, 5, 1],
  'gemini-3.1-flash-lite': [2, 5, 1],
  'google/gemini-3.1-flash-lite': [2, 5, 1],
  'gemini-3-pro-preview': [5, 3, 4],
  'gemini-3-pro': [5, 3, 4],
  'google/gemini-3-pro': [5, 3, 4],
  'gemini-3-flash-preview': [3, 5, 2],
  'gemini-3-flash': [3, 5, 2],
  'google/gemini-3-flash': [3, 5, 2],
  'gemini-2.5-pro': [4, 3, 3],
  'google/gemini-2.5-pro': [4, 3, 3],
  'gemini-2.5-flash': [3, 5, 1],
  'google/gemini-2.5-flash': [3, 5, 1],

  // xAI
  'x-ai/grok-4': [5, 3, 4],
  'x-ai/grok-4-0214': [5, 3, 4],
  'x-ai/grok-4.3': [5, 3, 4],
  'x-ai/grok-4-heavy': [5, 2, 5],
  'x-ai/grok-3': [4, 4, 3],
  'x-ai/grok-3-mini': [2, 5, 1],
  'x-ai/grok-code-fast': [3, 5, 2],

  // DeepSeek
  'deepseek/deepseek-r1': [5, 2, 2], // cheap-but-frontier reasoner
  'deepseek/deepseek-r1-0528': [5, 2, 2],
  'deepseek/deepseek-chat': [4, 4, 2],
  'deepseek/deepseek-v3': [4, 4, 2],
  'deepseek/deepseek-v3.1': [4, 4, 2],
  'deepseek/deepseek-v3.1-base': [4, 4, 2],
  'deepseek/deepseek-v3.1-terminus': [4, 4, 2],
  'deepseek/deepseek-chat-v3-0324': [4, 4, 2],
  'deepseek/deepseek-v3.2': [3, 4, 1],
  'deepseek/deepseek-v3.2-exp': [3, 4, 1],

  // Meta Llama
  'meta-llama/llama-4-maverick': [4, 4, 2],
  'meta-llama/llama-4-scout': [3, 4, 1],
  'meta-llama/llama-3.3-70b': [3, 4, 1],
  'meta-llama/llama-3.3-70b-instruct': [3, 4, 1],
  'meta-llama/llama-3.3-8b': [2, 5, 1],
  'meta-llama/llama-3.2-3b': [1, 5, 1],
  'meta-llama/llama-3.2-1b': [1, 5, 1],
  'meta-llama/llama-3.1-8b': [2, 5, 1],

  // Qwen
  'qwen/qwen3-coder': [4, 3, 2],
  'qwen/qwen3-235b-a22b': [4, 3, 2],
  'qwen/qwen3-72b': [3, 4, 1],
  'qwen/qwen3-32b': [2, 4, 1],
  'qwen/qwen3-14b': [2, 5, 1],
  'qwen/qwen3-vl-235b-thinking': [4, 2, 3],
  'qwen/qwen3-vl-8b-thinking': [2, 3, 1],
  'qwen/qwen3-next-80b-a3b-instruct': [3, 4, 1],

  // Mistral
  'mistralai/mistral-large-2501': [4, 4, 3],
  'mistralai/mistral-large': [4, 4, 3],
  'mistralai/mistral-medium-3-5': [3, 4, 2],
  'mistralai/mistral-medium-3': [3, 4, 2],
  'mistralai/mistral-small-3.1-24b-instruct': [2, 5, 1],
  'mistralai/codestral': [3, 5, 2],
  'mistralai/ministral-8b': [1, 5, 1],
  'mistralai/ministral-3b': [1, 5, 1],

  // Cohere
  'cohere/command-a-03-2025': [3, 4, 3],
  'cohere/command-r-plus': [3, 4, 2],
  'cohere/command-r': [2, 5, 1],

  // Misc frontier-ish
  'moonshotai/kimi-k2': [4, 3, 2],
  'moonshotai/kimi-k1.5': [4, 3, 2],
  'z-ai/glm-4.6': [4, 3, 2],
  'z-ai/glm-4.5': [4, 3, 2],
  'z-ai/glm-4.5-air': [3, 4, 1],
  'ai21/jamba-large-1.7': [3, 4, 2],
  'minimax/minimax-m2': [4, 3, 2],
  'minimax/minimax-m1': [4, 3, 2],
  'bytedance-seed/seed-1.6': [4, 4, 2],
  'bytedance-seed/seed-1.6-flash': [3, 5, 1],

  // Smaller/specialised
  'baidu/cobuddy': [2, 4, 1],
  'baidu/ernie-4.5-21b-a3b': [2, 5, 1],
  'nvidia/nemotron-3-nano-30b-a3b': [2, 5, 1],
  'nvidia/nemotron-3-super-120b-a12b': [3, 3, 2],
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': [2, 4, 1],
  'ibm-granite/granite-4.1-8b': [1, 5, 1],
  'ibm-granite/granite-3-8b': [1, 5, 1],
  'inception/mercury-coder': [2, 5, 1],
  'thedrummer/cydonia': [1, 5, 1],
  'sao10k/l3.3-euryale-70b': [2, 4, 1],
};

/** Fallback tier scoring for models not in MODEL_TIERS. Tries to
 * extract a parameter count from the label (8B/70B/235B/etc.) and
 * use that as a stronger size signal than cost alone, since open-
 * source vendors price aggressively low for marketing reasons.
 *
 * Distribution:
 *   Intelligence:
 *     - 200B+ params or $25+/M  -> 5
 *     - 70-200B or $5-$25/M     -> 4
 *     - 30-70B or $1-$5/M       -> 3
 *     - 8-30B or $0.20-$1/M     -> 2
 *     - <8B or <$0.20/M         -> 1
 *     + reasoning bumps tier 1-3 by 1; doesn't push 4->5 unless
 *       the model is genuinely huge.
 *   Speed:
 *     - inverse of size, with name keywords as +-1 nudges.
 *   Cost: pure cost bucket.
 */
export function heuristicTiers(label: string, outputCostPer1m: number, reasoning: boolean): ModelTier {
  const out = outputCostPer1m || 0.0;

  // Cost bucket; same 5-tier cost ladder as before.
  let cb: number;
  if (out < 0.5) cb = 1;
  else if (out < 2) cb = 2;
  else if (out < 7) cb = 3;
  else if (out < 25) cb = 4;
  else cb = 5;

  // Try to parse a parameter count. Label often carries something like "Llama 3.3 70B" or "Qwen3 235B". 235B -> 5, 70B -> 4, 30B -> 3, 14B -> 2, 7B -> 1. We only trust the param count when it's clearly above 1B (so we don't pick up version numbers).
  const lower = (label || '').toLowerCase();
  let paramB = 0.0;
  const paramRe = /\b(\d{1,4}(?:\.\d+)?)\s*b\b/g;
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(lower)) !== null) {
    const v = parseFloat(match[1]);
    if (!Number.isNaN(v) && v >= 1 && v > paramB) paramB = v;
  }

  let sizeTier: number;
  if (paramB >= 200) sizeTier = 5;
  else if (paramB >= 70) sizeTier = 4;
  else if (paramB >= 30) sizeTier = 3;
  else if (paramB >= 8) sizeTier = 2;
  else if (paramB > 0) sizeTier = 1;
  else sizeTier = 0; // unknown; fall back to cost

  // Intelligence is the max of cost bucket and parsed size tier. Cost is high-confidence for closed-source frontier; size is high-confidence for open-source ladders. Whichever is higher is closer to the truth.
  let intel = Math.max(cb, sizeTier);
  if (reasoning && intel < 4) {
    // Reasoning is a strong intelligence signal but only for genuinely smaller models; frontier closed-source already caps at 5, so don't double-count there.
    intel += 1;
  }

  // Speed inverse of intel.
  let speed = 6 - intel;
  if (/\b(mini|lite|flash|haiku|nano|small|fast|turbo|micro|tiny)\b/.test(lower)) speed += 1;
  if (/\b(opus|ultra|max|xlarge|titan|huge)\b/.test(lower)) speed -= 1;
  if (reasoning && intel >= 4) {
    // Frontier reasoning models burn lots of tokens on hidden thoughts; user-perceived speed drops.
    speed -= 1;
  }

  return [
    Math.max(1, Math.min(5, intel)),
    Math.max(1, Math.min(5, speed)),
    Math.max(1, Math.min(5, cb)),
  ];
}

/** Look up a (intelligence, speed, cost) triple. Curated map first;
 * heuristic fallback for the long tail. */
export function computeTiers(modelId: string, label: string, outputCostPer1m: number, reasoning: boolean): ModelTier {
  const candidates: string[] = [modelId];
  if (modelId.includes(':free')) candidates.push(modelId.replace(':free', ''));
  if (modelId.includes('/')) {
    const tail = modelId.split('/').slice(1).join('/');
    candidates.push(tail);
    if (tail.includes(':free')) candidates.push(tail.replace(':free', ''));
  }
  // Try dashes-vs-dots normalisations for each candidate.
  for (const c of [...candidates]) {
    if (c.includes('.')) candidates.push(c.replace(/\./g, '-'));
    if (c.includes('-')) candidates.push(c.replace(/-/g, '.'));
  }

  // Dedup while preserving order.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      ordered.push(c);
    }
  }

  for (const c of ordered) {
    const tier = MODEL_TIERS[c];
    if (tier) return tier;
  }

  return heuristicTiers(label, outputCostPer1m, reasoning);
}

export type BillingKind = 'subscription' | 'api_key' | 'free' | 'paid';

/** Return one of:
 *     'subscription'; covered by an OAuth sub or Pro plan; hide cost row
 *     'api_key'     ; direct API-key path (Anthropic / OpenAI / Gemini)
 *     'free'        ; genuinely $0 per token (rate-limited OR :free tier)
 *     'paid'        ; per-token metering through OpenRouter; show pricing
 *
 * Why 'api_key' is split from 'paid': both meter per-token, but the user
 * is paying a different counterparty. Letting the picker filter chips
 * "API key" vs "Subscription" gives users a clear way to scope to their
 * billing relationship; direct API key vs OAuth subscription; instead
 * of conflating them under a generic "paid" bucket.
 *
 * Subscription paths:
 *   - api=codex (Codex sub via 9Router)
 *   - api=gemini-cli (Gemini CLI sub via 9Router)
 *   - route="cc" (Claude sub via 9Router)
 *   - api=anthropic, adaptive route, Pro mode active with bearer
 */
export function computeBillingKind(params: { api: string; route: string | null; isOrFree: boolean }): BillingKind {
  const { api, route, isOrFree } = params;
  if (api === 'codex') return 'subscription';
  if (api === 'gemini-cli') return 'subscription';
  if (route === 'cc') return 'subscription';
  if (route === 'api') return 'api_key';
  if (isOrFree) return 'free';
  return 'paid';
}
