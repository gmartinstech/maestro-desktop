// engine/src/agents/RunSupport.ts -- AGT-3, a partial port of backend/apps/agents/manager/
// RunSupport.py: only `stream_text`, the one helper MockAgent.run_mock_turn calls. `stream_tool_input`
// (used by run_mock_agent, the SDK-missing dev fallback) and the rest of RunSupport.py's real-loop
// helpers (build_prompt_content, etc.) are out of scope -- later AGT tickets' job.

import { wsManager } from './core/wsManager';
import { upsertMessage } from './manager/streaming/upsertMessage';
import { createMessage } from './sessionFactory';
import type { AgentSession } from './core/models';
import type { PartialReply } from './manager/streaming/partialReply';

// AGT-4 reconciliation (see MockAgent.ts's header for the full story): sends go through
// `core/wsManager.ts`'s `ConnectionManager` singleton directly (`wsManager.sendToSession(...)`, not
// a rebound local -- `.bind` would lose the method's per-call generic inference), not the flat
// `agents/wsManager.ts` this file used to import (deleted in this same change).

/** Emits stream_start, word-by-word deltas, and stream_end for a text message -- mirrors
 * RunSupport.stream_text exactly, including its word-split chunking (`text.split(" ")`, each
 * chunk after the first re-prefixed with the separating space) and its default pacing delay. */
export async function streamText(sessionId: string, msgId: string, text: string, delay = 0.03): Promise<void> {
  await wsManager.sendToSession(sessionId, 'agent:stream_start', {
    session_id: sessionId,
    message_id: msgId,
    role: 'assistant',
  });
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i] : ' ' + words[i];
    await wsManager.sendToSession(sessionId, 'agent:stream_delta', {
      session_id: sessionId,
      message_id: msgId,
      delta: chunk,
    });
    // Always yields a tick, even at delay=0 -- mirrors asyncio.sleep(0) still ceding control to the
    // event loop rather than running the whole loop body synchronously.
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
  }
  await wsManager.sendToSession(sessionId, 'agent:stream_end', {
    session_id: sessionId,
    message_id: msgId,
  });
}

/** Persist the in-flight streamed assistant text as a real message and push it to the client,
 * idempotently. Lets a stop show the partial instantly instead of waiting out SDK teardown. Returns
 * true if it committed something. Mirrors `commit_partial_now` exactly, including the two early-outs
 * (nothing live; empty/whitespace-only text) and the id-already-present dedupe (a stream commit can
 * race a stop's early partial commit for the same message id). Failure to send is swallowed, same as
 * the Python original's bare `except Exception: pass`. */
export async function commitPartialNow(session: AgentSession, livePartial: Map<string, PartialReply>): Promise<boolean> {
  const live = livePartial.get(session.id);
  livePartial.delete(session.id);
  if (!live) return false;
  const text = live.text || '';
  const msgId = live.msgId;
  if (!msgId || !text.trim()) return false;
  if (session.messages.some((m) => m.id === msgId)) return false;
  const partial = createMessage({
    id: msgId,
    role: 'assistant',
    content: text,
    branch_id: live.branchId || session.active_branch_id,
    timestamp: new Date().toISOString(),
  });
  upsertMessage(session, partial);
  try {
    await wsManager.sendToSession(session.id, 'agent:message', {
      session_id: session.id,
      message: { ...partial },
    });
    await wsManager.sendToSession(session.id, 'agent:stream_end', {
      session_id: session.id,
      message_id: msgId,
    });
  } catch {
    // best-effort, mirrors the Python original
  }
  return true;
}

/** Await a cancelled task's (possibly slow) teardown off the hot path. JS analog of
 * `drain_task`: `task` here is a Promise (there is no cancel-then-await-the-same-object semantics
 * for a plain Promise the way there is for an asyncio.Task, so the caller is responsible for
 * whatever cancellation signal it used -- this just swallows the settle, success or failure). */
export async function drainTask(task: Promise<unknown> | undefined | null): Promise<void> {
  if (!task) return;
  try {
    await task;
  } catch {
    // mirrors the Python original's `except (asyncio.CancelledError, Exception): pass`
  }
}
