// engine/src/agents/core/auxLlm.ts -- AGT-5, a full port of backend/apps/agents/core/aux_llm.py:
// small, pure helpers shared by every aux-LLM label-generation call (metadata.ts). Self-contained.

// Refusal/meta tells from aux label calls; any hit means "show the fallback, not this".
const REJECT_STARTS = ['i ', "i'm", "i'll", "i've", 'as an', 'sorry', 'unfortunately', 'please', 'here'];
const REJECT_ANYWHERE = ['cannot', "can't", 'unable', 'no information', 'not enough', 'need more', 'provide more'];

/** Squeeze an aux-LLM reply into a safe short label: first line only, markdown stripped,
 * word/char capped; returns "" when it smells like an answer or refusal so the caller falls back
 * instead of showing "I cannot..." as a title. */
export function cleanShortLabel(raw: string, maxWords = 4, maxChars = 36): string {
  const firstNonEmpty = (raw || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  let line = firstNonEmpty.replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/^[#*>\-•\s]+/, '').replace(/\*\*/g, '').replace(/`/g, '');
  line = line.replace(/[\s.,:;!]+$/, '').trim();
  const low = line.toLowerCase();
  if (!line || REJECT_STARTS.some((t) => low.startsWith(t)) || REJECT_ANYWHERE.some((t) => low.includes(t))) return '';
  let label = line.split(/\s+/).slice(0, maxWords).join(' ');
  if (label.length > maxChars) {
    const truncated = label.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    label = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).replace(/[\s.,:;!]+$/, '') || truncated;
  }
  return label;
}

/** GPT-5 reasoners burn reasoning tokens before output; floor at 2K so a label can land. */
export function auxMaxTokensFor(model: string | null | undefined, base = 100): number {
  if (typeof model === 'string' && model.toLowerCase().includes('gpt-5')) return Math.max(base, 2048);
  return base;
}

export interface AnthropicLikeContentBlock {
  text?: string;
}
export interface AnthropicLikeResponse {
  content?: AnthropicLikeContentBlock[];
}

/** Extract text from an Anthropic-shape response, tolerating Gemini/OpenAI edge cases (an empty
 * `content: []`, e.g. safety stop, function-call-only turn). Returns "" if no text block exists. */
export function safeRespText(resp: AnthropicLikeResponse | null | undefined): string {
  try {
    for (const block of resp?.content ?? []) {
      if (typeof block?.text === 'string' && block.text) return block.text;
    }
    return '';
  } catch {
    return '';
  }
}
