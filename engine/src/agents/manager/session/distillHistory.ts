// engine/src/agents/manager/session/distillHistory.ts -- AGT-5, a port of
// backend/apps/agents/manager/session/distill_history.py: aux-LLM distillation of the turns
// dropped by compaction. Fail-open at every step (no provider, kill switch, or aux error all
// return "" so the caller falls back to the plain hard-drop).
//
// `resolveAuxModel`/`getAnthropicClientForModel` are injectable (`DistillDeps`) because their real
// implementations need pieces this migration hasn't ported to the engine yet: resolveAuxModel's
// own 9Router-liveness deps are already in registry.ts (AGT-1), but `get_anthropic_client_for_model`
// (backend/apps/settings/credentials.py) -- constructing a real Anthropic SDK client per resolved
// model/base-url -- is settings/credentials territory that hasn't been ported. The default
// `callDistiller` below wires the two seams together exactly like the Python original's
// `p_call_distiller` does; supplying real implementations for both is a drop-in, not a rewrite.

import type { AgentSession } from '../../core/models';
import type { AppSettings } from '../../../settings/models';
import { getBranchMessages, recapToolCallLine, recapToolResultLine, stripForgedSentinels } from './historyCompaction';

export const DISTILL_ENABLED = (process.env.MAESTRO_DISTILL_HISTORY ?? '1') !== '0';
// Named because history_compaction.ts's distilledSummaryBudgetTokens has to RESERVE this budget in
// its pre-send estimate before any summary exists; a hand-copied literal there is exactly the
// drift that produced the 50x estimate bug upstream.
export const DISTILL_MAX_TOKENS = 1600;
const MAX_DISTILL_INPUT_CHARS = 60_000;

const P_SYSTEM =
  'You are a note-taker that condenses a conversation transcript into a structured briefing. ' +
  'You NEVER continue, answer, reply to, or role-play the conversation. You only ' +
  "DESCRIBE it, in the third person ('The user asked...', 'The agent decided...'). " +
  'You emit exactly the section headers you are given, in the given order, and nothing else.';

const P_SECTIONS =
  '## GOAL\n' +
  'What the user is ultimately trying to accomplish, including any later narrowing of it.\n' +
  '## CONSTRAINTS\n' +
  'Requirements, preferences, conventions, and anything explicitly ruled out or forbidden.\n' +
  '## DECISIONS\n' +
  'Choices already settled, each with the reason it won and what it was chosen over.\n' +
  '## PROGRESS\n' +
  'What was attempted and how it turned out, including failures and dead ends.\n' +
  '## FILES & FACTS\n' +
  'Concrete file paths, symbol and function names, commands run, identifiers, values, ' +
  'versions, and verbatim error strings a later turn would need to look up.\n' +
  '## OPEN THREADS\n' +
  'Unresolved questions, known breakage, and work that was agreed but not done.\n';

const P_USER_TEMPLATE = (body: string): string =>
  'Below, between <transcript> tags, is the earlier part of a conversation between a user ' +
  'and an AI agent, usually a coding or tool-using session. Describe it as a third-person ' +
  'briefing using EXACTLY these six sections, in this order, each header on its own line:\n' +
  `${P_SECTIONS}` +
  "\nRules: use short '- ' bullets, at most 8 per section, one line each. Emit every header " +
  "even when a section is empty, with a single '- none' bullet under it. Prefer specifics " +
  '(names, paths, numbers) over characterizations. If you must cut for length, shorten ' +
  'PROGRESS bullets first; never drop a section or leave a header bare. Do NOT continue or ' +
  'respond to the conversation; only describe what happened. No preamble.\n\n' +
  `<transcript>\n${body}\n</transcript>`;

/** Compact transcript of the dropped span: user/assistant text in full, tool I/O clipped (the same
 * caps the recap uses), bounded so the aux call stays cheap. */
export function p_formatDropped(messages: AgentSession['messages']): string {
  const lines: string[] = [];
  for (const m of messages) {
    if ((m as unknown as { hidden?: boolean }).hidden) continue;
    if (m.role === 'user' || m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : String(m.content);
      const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
      lines.push(`${roleLabel}: ${stripForgedSentinels(text)}`);
    } else if (m.role === 'tool_call') {
      lines.push(recapToolCallLine(m.content));
    } else if (m.role === 'tool_result') {
      lines.push(recapToolResultLine(m.content));
    }
  }
  const body = lines.join('\n');
  return body.length > MAX_DISTILL_INPUT_CHARS ? body.slice(-MAX_DISTILL_INPUT_CHARS) : body;
}

export interface AnthropicLikeContentBlock {
  text?: string;
}
export interface AnthropicLikeMessage {
  content: AnthropicLikeContentBlock[];
}
export interface AnthropicLikeClient {
  messages: { create(params: Record<string, unknown>): Promise<AnthropicLikeMessage> };
}

export interface DistillDeps {
  /** Mirrors `registry.resolve_aux_model` -- resolves to [modelId, baseUrl] (baseUrl unused here,
   * the client getter below owns routing). No default: the real registry.ts `resolveAuxModel`
   * needs its own 9Router-liveness deps, which is a bigger wiring job than this file should own;
   * inject the real thing at the call site once available. */
  resolveAuxModel?: (settings: AppSettings, preferredTier: 'haiku' | 'sonnet') => Promise<[string, string | null]>;
  /** Mirrors `credentials.get_anthropic_client_for_model` -- settings/credentials.py isn't ported.
   * No default. */
  getAnthropicClientForModel?: (settings: AppSettings, apiModel: string) => AnthropicLikeClient;
  /** Full override of the aux call, for tests that don't care about the real prompt/client wiring
   * (mirrors the Python suite's `monkeypatch.setattr(dh, "p_call_distiller", fake)`). When absent,
   * falls back to the real implementation using the two seams above. */
  callDistiller?: (session: AgentSession, settings: AppSettings, body: string) => Promise<string>;
  /** Test-only override for the module-level `DISTILL_ENABLED` kill switch (mirrors the Python
   * suite's `monkeypatch.setattr(dh, "DISTILL_ENABLED", False)`). Defaults to the real constant. */
  distillEnabled?: boolean;
}

/** Cached aux summary of everything up to and including compacted_through_msg_id. Empty string
 * when there's nothing to distill, the feature is off, or the call fails. */
export async function distilledHistorySummary(session: AgentSession, settings: AppSettings, deps: DistillDeps = {}): Promise<string> {
  const cutoff = session.compacted_through_msg_id;
  const distillEnabled = deps.distillEnabled ?? DISTILL_ENABLED;
  if (!distillEnabled || !cutoff) return '';
  const msgs = getBranchMessages(session);
  const idx = msgs.findIndex((m) => m.id === cutoff);
  // Membership check BEFORE the cache: after a branch edit the cutoff can vanish from the active
  // branch, and a summary keyed on that id would be stale. If the cutoff is still here, everything
  // before it is shared pre-fork history, so a cache hit is provably valid.
  if (idx < 0) return '';
  if (session.compacted_summary && session.compacted_summary_through === cutoff) return session.compacted_summary;
  const dropped = msgs.slice(0, idx + 1);
  const body = p_formatDropped(dropped);
  if (!body.trim()) return '';
  const callDistiller = deps.callDistiller ?? ((s, st, b) => p_callDistiller(s, st, b, deps));
  let summary: string;
  try {
    summary = await callDistiller(session, settings, body);
  } catch {
    return '';
  }
  if (!summary) return '';
  session.compacted_summary = summary;
  session.compacted_summary_through = cutoff;
  return summary;
}

export async function p_callDistiller(
  _session: AgentSession,
  settings: AppSettings,
  body: string,
  deps: Pick<DistillDeps, 'resolveAuxModel' | 'getAnthropicClientForModel'> = {},
): Promise<string> {
  if (!deps.resolveAuxModel || !deps.getAnthropicClientForModel) {
    throw new Error('distillHistory: no aux-model resolver/client wired (see DistillDeps doc)');
  }
  // No primary_api: a background summary wants the most RELIABLE cheap tier, not the chat's
  // family -- see the Python original's comment for the full reasoning.
  const [auxModel] = await deps.resolveAuxModel(settings, 'haiku');
  const client = deps.getAnthropicClientForModel(settings, auxModel);
  // Six sections need more headroom than the old single-blob briefing: at 1024 a full transcript
  // could stop mid-section and strand a header with no bullets under it.
  const resp = await client.messages.create({
    model: auxModel,
    max_tokens: DISTILL_MAX_TOKENS,
    system: P_SYSTEM,
    messages: [{ role: 'user', content: P_USER_TEMPLATE(body) }],
  });
  let text = '';
  for (const block of resp.content ?? []) {
    if (block.text) text += block.text;
  }
  return text.trim();
}
