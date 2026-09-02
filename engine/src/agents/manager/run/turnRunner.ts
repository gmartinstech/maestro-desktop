// engine/src/agents/manager/run/turnRunner.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/run/TurnRunner.py: the streaming turn + capacity-retry loop. Ported as
// plain DI'd functions (this codebase's established convention -- see engine/src/router/process.ts
// and AgentManager.ts/MockAgent.ts's own headers) rather than a mixin method: `session`/`sessionId`/
// `turn`/`thinking`/`sessions`/`livePartial` are passed explicitly, exactly what TurnRunner.py reads
// off `self.*` via the AgentManagerProtocol mixin contract.
//
// TRANSPORT DI SEAM (the one deliberate architectural departure from a literal line-for-line port):
// the Python original calls `claude_agent_sdk.query(...)` and `ClaudeSDKClient(options).connect()` /
// `.query()` / `.receive_response()` directly. Building the real `ClaudeAgentOptions` this turn needs
// requires RunOptions.py's full assembly (gate hooks, tool composition, provider env, history
// rebuild) -- AGT-5's "permission gates, prompt composition, session lifecycle" ticket, not yet
// landed in the engine. Rather than block this ticket's retry/state-machine port on that (or fake a
// partial options builder that would just be wrong), `TurnRunnerDeps` below abstracts the message
// SOURCE: `queryOnce(...)` mirrors `query(prompt=prompt_stream(), options=options)` (a fresh
// AsyncIterable per attempt), and `connectPersistentClient(...)` mirrors `ClaudeSDKClient(options)`
// (an object exposing `.query()`+`.receiveResponse()`, matching the Python SDK's persistent-client
// shape -- NOT the TS Agent SDK's actual `query()`-returns-a-`Query`-you-call-`.streamInput()`-on
// shape, which is a genuinely different API; whoever wires the real SDK in adapts it to this shape
// at the deps boundary, same pattern `clientPool.ts`'s own header documents for `PooledClient`).
// Every retry-loop DECISION (backoff schedule, dead-client fast-retry, mid-stream stream_end
// finalization, resume-on-retry) is ported byte-for-byte; only the literal SDK call is behind DI.

import { capacityRetryWait, CAPACITY_BACKOFFS } from '../../core/errorClassify';
import { wsManager } from '../../core/wsManager';
import { acquireClient, bootFingerprint, disposeClient, persistentClientEnabled, type ClientHandle, type PooledClient } from './clientPool';
import { handleStreamEvent, type StreamEventLike } from '../streaming/handleStreamEvent';
import { handleAssistantMessage, type AssistantMessageLike } from '../streaming/handleAssistantMessage';
import { handleResultMessage, type ResultMessageLike, type PricingLookup, zeroPricingLookup } from '../streaming/handleResultMessage';
import { emitConsolidatedThinking, unavailableReasoningTokenProbe, type ReasoningTokenProbe } from '../streaming/thinking';
import type { AgentSession } from '../../core/models';
import type { ThinkingState, TurnState } from '../streaming/state';
import type { PartialReply } from '../streaming/partialReply';

/** One message from the SDK's turn stream, discriminated the same way the Python original's
 * `isinstance(message, ResultMessage/AssistantMessage/StreamEvent/SystemMessage)` chain does --
 * duck-typed by `type`, matching how the real TS SDK's `SDKMessage` union is itself shaped
 * (`'assistant' | 'result' | 'system' | 'stream_event' | ...`). */
export type SdkMessageLike =
  | ({ type: 'stream_event' } & StreamEventLike)
  | ({ type: 'assistant' } & AssistantMessageLike)
  | ({ type: 'result' } & ResultMessageLike)
  | { type: 'system'; subtype?: string; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

export interface PersistentSdkClient extends PooledClient {
  query(promptContent: unknown): Promise<void>;
  receiveResponse(): AsyncIterable<SdkMessageLike>;
}

export interface TurnRunnerDeps {
  /** One-shot transport: a fresh message stream per retry attempt. Mirrors
   * `query(prompt=prompt_stream(), options=options)`. `options` is passed through opaquely (this
   * file never inspects it -- RunOptions.ts/AGT-5 owns its real shape). */
  queryOnce(promptContent: unknown, options: unknown): AsyncIterable<SdkMessageLike>;
  /** Persistent-client transport pieces -- only exercised when `usePersistentClient()` is true. */
  clientPool: Map<string, ClientHandle<PersistentSdkClient>>;
  connectPersistentClient(options: unknown): Promise<PersistentSdkClient>;
  /** Defaults to `persistentClientEnabled()` (the real `MAESTRO_PERSISTENT_CLIENT` env check);
   * overridable so a test can force either branch without touching `process.env`. */
  usePersistentClient?: () => boolean;
  /** Called right before a retry's `continue` when `session.sdk_session_id` is set, mirroring
   * `options_kwargs["resume"] = session.sdk_session_id; options = ClaudeAgentOptions(**options_kwargs)`
   * -- the caller (holding the real `optionsKwargs`/`options` closure state RunOptions.ts builds)
   * is responsible for actually rebuilding its own options; this file only tells it when to. */
  onResumeRebuild?(sdkSessionId: string): void;
  pricing?: PricingLookup;
  reasoningTokenProbe?: ReasoningTokenProbe;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Consumes one turn's message stream, dispatching each message to the matching streaming handler.
 * Mirrors `p_run_streaming_turn`'s inner loop exactly: the first-non-Result-message wall-clock stamp
 * + baseline-token capture + translator pre-emit, the first-event/system-message log hooks, and the
 * `stream_event`/`assistant`/`result` dispatch. `resolvedModel` drives the pre-emit's cx/gc/ag/gemini/
 * route check, same as the Python original's `resolved_model.startswith((...))`. */
export async function consumeTurnMessages(
  stream: AsyncIterable<SdkMessageLike>,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  livePartial: Map<string, PartialReply>,
  sessions: Map<string, AgentSession>,
  resolvedModel: string | null,
  apiType: string | null,
  globalSettings: unknown,
  deps: Pick<TurnRunnerDeps, 'pricing' | 'reasoningTokenProbe'> = {},
): Promise<void> {
  const pricing = deps.pricing ?? zeroPricingLookup;
  const probe = deps.reasoningTokenProbe ?? unavailableReasoningTokenProbe;

  for await (const message of stream) {
    if (message.type === 'result') {
      turn.currentTurnEmitted = false;
    } else {
      turn.currentTurnEmitted = true;
      // Stamp the turn's wall-clock start at the FIRST non-Result message (when the user actually
      // started waiting) -- the same basis "Thought for Ns" uses, so the duration covers thinking +
      // tool exec + assistant text generation.
      if (turn.startedTs === null) {
        turn.startedTs = Date.now();
        try {
          // Baselines track the SAME fresh lane the pill reads, so the per-turn delta is fresh-minus-fresh.
          if (session.tokens && typeof session.tokens === 'object') {
            turn.baselineSessionIn = Number(session.tokens.input_fresh ?? 0);
            turn.baselineSessionOut = Number(session.tokens.output ?? 0);
          }
          let chIn = 0;
          let chOut = 0;
          for (const child of sessions.values()) {
            if (child.parent_session_id !== session.id) continue;
            const ct = child.tokens;
            if (!ct || typeof ct !== 'object') continue;
            chIn += Number(ct.input_fresh ?? 0);
            chOut += Number(ct.output ?? 0);
          }
          turn.baselineChildrenIn = chIn;
          turn.baselineChildrenOut = chOut;
          turn.baselineCaptured = true;
        } catch {
          // best-effort, mirrors the Python original
        }
        // Pre-emit thinking pill for routes whose translator strips reasoning content. Without
        // this, the pill emits at turn end and lands BELOW the assistant text -- pre-emitting here
        // gives it the same ordering as Anthropic's natural streaming path.
        try {
          const routeStripsReasoningPre = typeof resolvedModel === 'string' && ['cx/', 'gc/', 'ag/', 'gemini/'].some((p) => resolvedModel.startsWith(p));
          if (routeStripsReasoningPre) {
            await emitConsolidatedThinking(thinking, turn, session, sessionId, sessions, true, probe);
          }
        } catch {
          // best-effort, mirrors the Python original's `logger.exception("pre-emit ... continuing")`
        }
      }
    }

    if (turn.firstEvent) {
      turn.firstEvent = false;
    }

    if (message.type === 'system') {
      if ((message as { subtype?: string }).subtype === 'compact_boundary') {
        turn.compactBoundaries += 1;
      }
    }

    if (message.type === 'stream_event') {
      await handleStreamEvent(message as StreamEventLike, session, sessionId, turn, thinking, livePartial);
    } else if (message.type === 'assistant') {
      await handleAssistantMessage(message as AssistantMessageLike, session, sessionId, turn, thinking, livePartial, sessions, probe);
    } else if (message.type === 'result') {
      await handleResultMessage(message as ResultMessageLike, session, sessionId, turn, thinking, sessions, resolvedModel, apiType, globalSettings, pricing, probe);
    }
  }
}

async function runOneShotTurn(
  deps: TurnRunnerDeps,
  promptContent: unknown,
  options: unknown,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  livePartial: Map<string, PartialReply>,
  sessions: Map<string, AgentSession>,
  resolvedModel: string | null,
  apiType: string | null,
  globalSettings: unknown,
): Promise<void> {
  const stream = deps.queryOnce(promptContent, options);
  await consumeTurnMessages(stream, session, sessionId, turn, thinking, livePartial, sessions, resolvedModel, apiType, globalSettings, deps);
}

async function runPersistentTurn(
  deps: TurnRunnerDeps,
  promptContent: unknown,
  options: unknown,
  optionsKwargs: Record<string, unknown>,
  session: AgentSession,
  sessionId: string,
  turn: TurnState,
  thinking: ThinkingState,
  livePartial: Map<string, PartialReply>,
  sessions: Map<string, AgentSession>,
  resolvedModel: string | null,
  apiType: string | null,
  globalSettings: unknown,
  forceRespawn: boolean,
): Promise<void> {
  const fp = bootFingerprint(optionsKwargs, session);
  const handle = await acquireClient(deps.clientPool, sessionId, fp, () => deps.connectPersistentClient(options), forceRespawn);
  await handle.lock.acquire();
  try {
    handle.turnsServed += 1;
    try {
      await handle.client.query(promptContent);
      await consumeTurnMessages(handle.client.receiveResponse(), session, sessionId, turn, thinking, livePartial, sessions, resolvedModel, apiType, globalSettings, deps);
      // LRU by turn-END so a session mid-long-turn isn't first cap-evicted the instant it finishes.
      handle.lastUsed = performance.now() / 1000;
    } catch (e) {
      // Fail-safe: an error or stop mid-turn poisons the live conversation; drop the client so the
      // next attempt/turn reconnects fresh (== today's one-shot behavior, never worse).
      await disposeClient(deps.clientPool, sessionId);
      throw e;
    }
  } finally {
    handle.lock.release();
  }
}

/** The streaming turn + capacity-retry loop. Mirrors `run_turn_with_retry` exactly: dispatches to
 * the persistent-client or one-shot transport per turn, and on a transient-capacity exception,
 * finalizes any in-flight stream messages, sleeps the scheduled backoff, and retries with a fresh
 * transport call -- up to `CAPACITY_BACKOFFS.length` attempts, after which the error is rethrown. */
export async function runTurnWithRetry(
  session: AgentSession,
  sessionId: string,
  promptContent: unknown,
  options: unknown,
  optionsKwargs: Record<string, unknown>,
  turn: TurnState,
  thinking: ThinkingState,
  pStderrBuffer: string[],
  resolvedModel: string | null,
  apiType: string | null,
  globalSettings: unknown,
  sessions: Map<string, AgentSession>,
  livePartial: Map<string, PartialReply>,
  deps: TurnRunnerDeps,
  forceRespawn = false,
): Promise<void> {
  const usePersistent = (deps.usePersistentClient ?? persistentClientEnabled)();
  let capacityRetryAttempt = 0;

  while (true) {
    try {
      if (usePersistent) {
        await runPersistentTurn(deps, promptContent, options, optionsKwargs, session, sessionId, turn, thinking, livePartial, sessions, resolvedModel, apiType, globalSettings, forceRespawn);
      } else {
        await runOneShotTurn(deps, promptContent, options, session, sessionId, turn, thinking, livePartial, sessions, resolvedModel, apiType, globalSettings);
      }
      break;
    } catch (e) {
      // Make sure the consolidated-thinking ticker doesn't outlive the turn on error/retry.
      if (thinking.tickerTask !== null && !thinking.tickerTask.isDone()) {
        thinking.tickerTask.cancel();
        try {
          await thinking.tickerTask.settle();
        } catch {
          // mirrors `except (asyncio.CancelledError, Exception): pass`
        }
      }
      thinking.tickerTask = null;

      const stderrSnapshot = pStderrBuffer.slice(-50).join('\n');
      let wait = capacityRetryWait(e, capacityRetryAttempt, stderrSnapshot);
      // Persistent-client fail-safe: a dead/wedged CLI raises a connection-class error the capacity
      // classifier won't retry. The client is already disposed (see runPersistentTurn), so ONE
      // immediate retry reconnects fresh == today's cold behavior; a second failure surfaces normally.
      if (wait === null && usePersistent && capacityRetryAttempt === 0 && !turn.currentTurnEmitted) {
        const name = (e as { constructor?: { name?: string } })?.constructor?.name ?? '';
        if (name.includes('CLIConnection') || name.includes('ProcessError') || name.includes('Transport')) {
          wait = 0.0;
        }
      }
      if (wait !== null) {
        capacityRetryAttempt += 1;
        // Finalize any in-flight stream messages so the UI doesn't leave them pinned as "still
        // streaming" while we wait and restart. On resume the CLI re-runs the last turn from
        // scratch, so the partial assistant text / tool call is now orphaned -- cap it with
        // stream_end and start the fresh turn under a new message id.
        if (turn.streamTextMsgId) {
          await wsManager.sendToSession(sessionId, 'agent:stream_end', {
            session_id: sessionId,
            message_id: turn.streamTextMsgId,
          });
          turn.streamTextMsgId = null;
        }
        turn.streamTextAccum = '';
        livePartial.delete(sessionId);
        for (const toolMsgId of turn.streamToolMsgIdsOrdered) {
          await wsManager.sendToSession(sessionId, 'agent:stream_end', {
            session_id: sessionId,
            message_id: toolMsgId,
          });
        }
        turn.streamToolMsgIdsOrdered = [];
        turn.streamBlockIndexMap.clear();
        turn.currentTurnEmitted = false;
        await sleep(wait * 1000);
        pStderrBuffer.length = 0;
        if (session.sdk_session_id) {
          deps.onResumeRebuild?.(session.sdk_session_id);
        }
        continue;
      }
      throw e;
    }
  }
}

// Re-exported for callers/tests that want the schedule length without importing errorClassify.ts
// directly (e.g. to assert "gave up after CAPACITY_BACKOFFS.length attempts").
export { CAPACITY_BACKOFFS };
