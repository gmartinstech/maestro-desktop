// engine/src/agents/manager/streaming/handleAssistantMessage.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/handle_assistant_message.py: handle a complete
// AssistantMessage envelope from the SDK -- split its blocks into thinking/text/tool-use, fold the
// thinking into the consolidated pill, surface a friendly card for a router auth-expiry that
// arrived as assistant text, and commit the assistant + tool-call messages. Mutates the passed
// TurnState/ThinkingState by reference and writes through the manager's live-partial mirror +
// session registry, exactly as the Python original does.
//
// `AssistantMessageLike` mirrors the Python original's own duck-typed content-block access
// (`isinstance(block, ThinkingBlock/TextBlock/ToolUseBlock)`, `getattr(message, "usage", None)`) as
// a `type`-discriminated structural union rather than importing the TS SDK's `BetaContentBlock`
// union directly -- same rationale as handleStreamEvent.ts's `StreamEventLike`.

import { uuidHex } from '../../uuid';
import { wsManager } from '../../core/wsManager';
import { createMessage } from '../../sessionFactory';
import { upsertMessage } from './upsertMessage';
import { emitConsolidatedThinking, startTickerLoop, unavailableReasoningTokenProbe, type ReasoningTokenProbe } from './thinking';
import type { AgentSession } from '../../core/models';
import type { ThinkingState, TurnState } from './state';
import type { PartialReply } from './partialReply';

// settings/maestro.py's MAESTRO_NAME, redeclared locally per this codebase's existing convention
// (configureProviderEnv.ts / router/sync.ts both do the same rather than share a one-constant module).
const MAESTRO_NAME = 'Maestro';

// A loose, duck-typed shape (not a discriminated union) rather than TS's usual tagged-union
// pattern: TS's built-in `===` narrowing on a `type` discriminant only works cleanly across members
// whose discriminant is ENTIRELY literal types, but the SDK can also emit block kinds this handler
// doesn't care about (redacted_thinking, server_tool_use, ...) which have to type-check too without
// silently widening the known branches back to `unknown`. This mirrors the Python original's own
// access pattern more closely anyway (`getattr(block, "thinking", None) or getattr(block, "text",
// None)`, `isinstance` checks that simply don't match an unrecognized block and fall through) --
// duck-typed field reads with a fallback, not a statically-typed variant per block kind.
export interface ContentBlockLike {
  type: string;
  [k: string]: unknown;
}

export interface AssistantMessageLike {
  content: ContentBlockLike[];
  usage?: { output_tokens?: number; [k: string]: unknown } | null;
}

export async function handleAssistantMessage(
  message: AssistantMessageLike,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  livePartial: Map<string, PartialReply>,
  sessions: Map<string, AgentSession>,
  probe: ReasoningTokenProbe = unavailableReasoningTokenProbe,
): Promise<void> {
  const contentParts: string[] = [];
  const newThinkingParts: string[] = [];
  const toolUses: Array<{ id: string; tool: string; input: Record<string, unknown> }> = [];
  // Capture the latest Gemini thoughtSignature (and Anthropic's signature_delta if present) off any
  // thinking block. Stored on the turn's consolidated thinking message so it survives persistence,
  // and re-attached on the next request so Google's continuity check passes.
  let newThoughtSignature: string | null = null;

  for (const block of message.content) {
    if (block.type === 'thinking') {
      const thinkingText = (block.thinking as string | undefined) || (block.text as string | undefined) || '';
      if (thinkingText) newThinkingParts.push(thinkingText);
      // Try multiple field-name variants -- SDK versions and 9Router translations have used
      // `signature`, `thoughtSignature`, and `thought_signature` over time.
      const sig = (block.signature as string | undefined) || (block.thoughtSignature as string | undefined) || (block.thought_signature as string | undefined);
      if (sig) newThoughtSignature = sig;
    } else if (block.type === 'text') {
      contentParts.push(block.text as string);
    } else if (block.type === 'tool_use') {
      toolUses.push({ id: block.id as string, tool: block.name as string, input: block.input as Record<string, unknown> });
    }
  }

  // Accumulate this AssistantMessage's contributions into the turn-level thinking pill. Re-emits
  // the SAME message id each time so the frontend dedupes and the bubble updates live. Tool count is
  // incremented in handleStreamEvent's content_block_start (tool_use) branch, NOT here -- that path
  // fires for both Anthropic and 9Router-translated providers; counting again here would double.
  if (newThinkingParts.length > 0) {
    thinking.textParts.push(...newThinkingParts);
  }
  // Latch the most recent thoughtSignature -- Gemini only validates against the LATEST one in the
  // conversation history, so older signatures from earlier think-steps in the same turn are superseded.
  if (newThoughtSignature) {
    thinking.thoughtSignature = newThoughtSignature;
  }
  // Accumulate this message's total output tokens (thinking text + visible text + tool-call JSON
  // args). Summing across the turn's AssistantMessages gives "all output the model produced this
  // turn," which is what users intuit when they see a token count.
  try {
    const outputTokens = Number(message.usage?.output_tokens ?? 0);
    if (outputTokens > 0) turn.outputTokens += outputTokens;
  } catch {
    // best-effort, mirrors the Python original
  }

  // Re-emit the consolidated thinking message on every AssistantMessage (event-driven). The
  // background ticker keeps it updating between events too, so the elapsed counter ticks even
  // during tool execution / slow text generation gaps.
  if (thinking.textParts.length > 0) {
    await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, false, probe);
    if (thinking.tickerTask === null || thinking.tickerTask.isDone()) {
      thinking.tickerTask = startTickerLoop(thinking, turn, session, sessionId, sessions, probe);
    }
  }

  if (contentParts.length > 0) {
    const asstText = contentParts.join('\n');
    // 9Router sometimes returns upstream 401s as the assistant reply (no SDK exception), so the
    // catch-all auth handler never fires. Match the text pattern and surface a friendly system
    // bubble instead.
    const lowerText = asstText.toLowerCase();
    const looksLikeRouterAuthError =
      (lowerText.includes('failed to authenticate') && lowerText.includes('401')) ||
      lowerText.includes('authentication token is expired') ||
      lowerText.includes('authentication token has expired') ||
      (lowerText.includes('provided authentication token') && (lowerText.includes('401') || lowerText.includes('expired'))) ||
      // The Maestro gateway's own rejection reason for a dead Keycloak access token.
      lowerText.includes('jwt expired');

    if (looksLikeRouterAuthError) {
      let friendly: string;
      let reason: string;
      if (lowerText.includes('codex/') || lowerText.includes('[codex')) {
        friendly =
          'GPT subscription token expired. Open Settings → Models and click ' +
          'Reconnect on the OpenAI / GPT row to refresh, should take ~10s, ' +
          'then send your message again.';
        reason = 'codex_token_expired';
      } else if (lowerText.includes('gemini-cli/') || lowerText.includes('[gemini')) {
        friendly =
          'Gemini subscription token expired. Open Settings → Models and click ' +
          'Reconnect on the Google / Gemini row, then send your message again.';
        reason = 'gemini_token_expired';
      } else if (lowerText.includes('jwt expired') || (session.model || '').toLowerCase().includes(MAESTRO_NAME.toLowerCase())) {
        // A Maestro token is a 10h Keycloak access token, refreshed automatically; the renderer
        // replaces this text with the sign-in card.
        friendly = 'Maestro Studio sign-in expired. Sign in again to get a fresh access code, then send your message again.';
        reason = 'maestro_token_expired';
      } else {
        friendly = 'Provider authentication expired. Open Settings → Models and reconnect, then send your message again.';
        reason = 'router_auth_expired';
      }
      const errMsg = createMessage({
        id: uuidHex(),
        role: 'system',
        content: friendly,
        branch_id: session.active_branch_id,
        timestamp: new Date().toISOString(),
      });
      session.messages.push(errMsg);
      await wsManager.sendToSession(sessionId, 'agent:auth_error', {
        session_id: sessionId,
        reason,
        message: friendly,
        model: session.model,
      });
      await wsManager.sendToSession(sessionId, 'agent:message', {
        session_id: sessionId,
        message: { ...errMsg },
      });
    } else {
      const asstMsg = createMessage({
        id: turn.streamTextMsgId || uuidHex(),
        role: 'assistant',
        content: asstText,
        branch_id: session.active_branch_id,
        timestamp: new Date().toISOString(),
      });
      upsertMessage(session, asstMsg);
      turn.streamTextAccum = '';
      livePartial.delete(sessionId);
      await wsManager.sendToSession(sessionId, 'agent:message', {
        session_id: sessionId,
        message: { ...asstMsg },
      });
    }
  }

  for (let i = 0; i < toolUses.length; i++) {
    const tu = toolUses[i];
    const msgId = i < turn.streamToolMsgIdsOrdered.length ? turn.streamToolMsgIdsOrdered[i] : uuidHex();
    const toolMsg = createMessage({
      id: msgId,
      role: 'tool_call',
      content: tu,
      branch_id: session.active_branch_id,
      timestamp: new Date().toISOString(),
    });
    upsertMessage(session, toolMsg);
    await wsManager.sendToSession(sessionId, 'agent:message', {
      session_id: sessionId,
      message: { ...toolMsg },
    });
  }

  turn.number += 1;
  turn.streamTextMsgId = null;
  turn.streamToolMsgIdsOrdered = [];
  turn.streamBlockIndexMap.clear();
}
