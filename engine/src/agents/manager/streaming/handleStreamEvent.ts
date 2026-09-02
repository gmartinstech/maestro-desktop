// engine/src/agents/manager/streaming/handleStreamEvent.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/handle_stream_event.py: handle one streaming StreamEvent
// from the SDK -- the incremental content_block_start/delta/stop/message_stop path that drives live
// text, thinking, and tool streaming to the UI. Mutates the passed TurnState/ThinkingState by
// reference and writes the manager's live-partial mirror, exactly as the Python original does.
//
// `StreamEventLike` is a deliberately narrow, dict-shaped structural type (mirrors the Python
// original's own `event.get("type")`/`.get("content_block", {})` dict access -- the SDK's real
// `event` field IS a plain dict there, not a typed model) rather than importing the TS SDK's full
// `BetaRawMessageStreamEvent` discriminated union. The real SDK's stream events satisfy this shape
// structurally (so real wiring needs no adapter), and tests can hand in a plain fixture object
// without constructing the SDK's full generated types.

import { uuidHex } from '../../uuid';
import { wsManager } from '../../core/wsManager';
import type { AgentSession } from '../../core/models';
import type { ThinkingState, TurnState } from './state';
import type { PartialReply } from './partialReply';

export interface StreamEventLike {
  event: {
    type?: string;
    index?: number;
    content_block?: { type?: string; name?: string; [k: string]: unknown };
    delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; [k: string]: unknown };
  };
}

export async function handleStreamEvent(
  message: StreamEventLike,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  livePartial: Map<string, PartialReply>,
): Promise<void> {
  const event = message.event;
  const eventType = event.type;

  if (eventType === 'content_block_start') {
    // Stamp the first stream event of the session so the session list can show "first response at
    // HH:MM" on reload. Only the first turn sets this; later turns leave it untouched.
    if (session.first_response_at === null) {
      session.first_response_at = new Date().toISOString();
    }

    const block = event.content_block ?? {};
    const index = event.index;
    const blockType = block.type;

    if (blockType === 'text') {
      if (turn.streamTextMsgId === null) {
        turn.streamTextMsgId = uuidHex();
        await wsManager.sendToSession(sessionId, 'agent:stream_start', {
          session_id: sessionId,
          message_id: turn.streamTextMsgId,
          role: 'assistant',
        });
      }
      if (index !== undefined) turn.streamBlockIndexMap.set(index, turn.streamTextMsgId);
    } else if (blockType === 'thinking') {
      // Reasoning trace from thinking-capable models. Rendered as a collapsible "thinking" message
      // via the existing stream infrastructure -- the frontend already handles role="thinking".
      const thinkingMsgId = uuidHex();
      if (index !== undefined) {
        turn.streamBlockIndexMap.set(index, thinkingMsgId);
        // Server-stamp start so per-turn elapsed_ms accumulates across multiple thinking blocks
        // (think -> tool -> think -> answer turns sum correctly).
        thinking.blockStarts.set(index, Date.now());
      }
      await wsManager.sendToSession(sessionId, 'agent:stream_start', {
        session_id: sessionId,
        message_id: thinkingMsgId,
        role: 'thinking',
      });
    } else if (blockType === 'tool_use') {
      const toolMsgId = uuidHex();
      turn.streamToolMsgIdsOrdered.push(toolMsgId);
      if (index !== undefined) turn.streamBlockIndexMap.set(index, toolMsgId);
      // Stream-level tool count for the thinking pill -- see handleAssistantMessage.ts's header
      // note on why the AssistantMessage path doesn't double-count this.
      turn.toolCount += 1;
      await wsManager.sendToSession(sessionId, 'agent:stream_start', {
        session_id: sessionId,
        message_id: toolMsgId,
        role: 'tool_call',
        tool_name: block.name ?? '',
      });
    }
  } else if (eventType === 'content_block_delta') {
    const index = event.index;
    const delta = event.delta ?? {};
    const deltaType = delta.type;
    const msgId = index !== undefined ? turn.streamBlockIndexMap.get(index) : undefined;

    if (msgId && deltaType === 'text_delta') {
      const textChunk = delta.text ?? '';
      turn.assistantTextChars += textChunk.length;
      turn.streamTextAccum += textChunk;
      livePartial.set(sessionId, { msgId: turn.streamTextMsgId, text: turn.streamTextAccum, branchId: session.active_branch_id });
      await wsManager.sendToSession(sessionId, 'agent:stream_delta', {
        session_id: sessionId,
        message_id: msgId,
        delta: textChunk,
      });
    } else if (msgId && deltaType === 'thinking_delta') {
      // Thinking content streams as thinking_delta with a "thinking" field (not "text").
      const thinkChunk = delta.thinking ?? '';
      await wsManager.sendToSession(sessionId, 'agent:stream_delta', {
        session_id: sessionId,
        message_id: msgId,
        delta: thinkChunk,
      });
    } else if (msgId && deltaType === 'input_json_delta') {
      const jsonChunk = delta.partial_json ?? '';
      turn.toolInputChars += jsonChunk.length;
      await wsManager.sendToSession(sessionId, 'agent:stream_delta', {
        session_id: sessionId,
        message_id: msgId,
        delta: jsonChunk,
      });
    }
  } else if (eventType === 'content_block_stop') {
    const index = event.index;
    const msgId = index !== undefined ? turn.streamBlockIndexMap.get(index) : undefined;
    // If this was a thinking block, accumulate elapsed_ms server-side. The pill stays in
    // "Thinking…" until the AssistantMessage lands carrying the per-turn aggregate values -- no
    // per-block elapsed/tokens go on the WS event itself.
    if (index !== undefined && thinking.blockStarts.has(index)) {
      const startedAt = thinking.blockStarts.get(index)!;
      thinking.blockStarts.delete(index);
      thinking.totalMs += Date.now() - startedAt;
    }
    if (msgId && msgId !== turn.streamTextMsgId) {
      await wsManager.sendToSession(sessionId, 'agent:stream_end', {
        session_id: sessionId,
        message_id: msgId,
      });
    }
  } else if (eventType === 'message_stop') {
    if (turn.streamTextMsgId) {
      await wsManager.sendToSession(sessionId, 'agent:stream_end', {
        session_id: sessionId,
        message_id: turn.streamTextMsgId,
      });
    }
  }
}
