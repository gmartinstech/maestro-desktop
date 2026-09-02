// engine/src/agents/manager/streaming/state.ts -- AGT-4, a faithful port of backend/apps/agents/
// manager/streaming/state.py's ThinkingState/TurnState: mutable per-turn state for the agent
// streaming loop.
//
// Python's pydantic models exist there so `validate_assignment` catches a type-shape regression on
// every field write; TS has no runtime-validation equivalent worth reproducing here (the compiler
// already enforces the shape statically, and these objects are mutated at very high frequency --
// once per streamed token/tool-input chunk -- so JIT'd plain-object field writes are also just
// faster). Both are therefore plain, mutable interfaces plus a `create*` factory that fills the same
// defaults pydantic's field declarations do, matching this codebase's sessionFactory.ts convention.
// Passed by reference and mutated in place by the streaming handlers below, exactly like the Python
// originals (a JS object reference needs no `nonlocal`-equivalent to mutate from a callee).

/** JS analog of an awaitable, cancellable asyncio.Task -- see thinking.ts's `startTickerLoop` for
 * the one implementation. */
export interface TickerHandle {
  isDone(): boolean;
  cancel(): void;
  /** Resolves once the loop has actually stopped (mirrors `await thinking.ticker_task` after
   * `.cancel()`); never rejects, matching the Python original's `except (CancelledError, Exception):
   * pass` around that await. */
  settle(): Promise<void>;
}

/** The consolidated-thinking side-channel for one turn: the live 'Thought for Ns · N tokens · N
 * tools' pill. A single persisted message id is reused across a multi-step turn so the bubble
 * updates in place; everything resets at the next turn boundary. */
export interface ThinkingState {
  /** block index -> wall-clock start (ms, via Date.now()); popped to accumulate totalMs when a
   * block ends. (Python uses time.time() seconds; this file uses ms throughout -- see totalMs.) */
  blockStarts: Map<number, number>;
  totalMs: number;
  /** Stable id for the turn's single thinking message (frontend dedupe replaces in place). */
  msgId: string | null;
  textParts: string[];
  /** Latest Gemini thoughtSignature, re-attached on later turns for reasoning continuity. */
  thoughtSignature: string | null;
  /** Background ticker handle; re-emits the pill every 1s so the elapsed counter keeps moving.
   * JS has no asyncio.Task-equivalent cancel-then-await; `TickerHandle` (thinking.ts) reproduces
   * just the two operations the streaming handlers need: `isDone()`/`cancel()`/`settle()` (await the
   * cancelled run's own settle, mirroring `await thinking.ticker_task` after `.cancel()`). */
  tickerTask: TickerHandle | null;
  /** Cached index of the thinking message in session.messages once known, so repeated emits (the 1s
   * ticker, every AssistantMessage chunk) don't re-scan the full list by id on every call. */
  msgIndex: number | null;
}

export function createThinkingState(): ThinkingState {
  return {
    blockStarts: new Map(),
    totalMs: 0,
    msgId: null,
    textParts: [],
    thoughtSignature: null,
    tickerTask: null,
    msgIndex: null,
  };
}

/** Mutable per-turn streaming state: the live streaming-message ids, the accumulated assistant
 * text, and the running token/char/timing counters. Reset at each turn boundary. */
export interface TurnState {
  streamTextMsgId: string | null;
  streamToolMsgIdsOrdered: string[];
  streamBlockIndexMap: Map<number, string>;
  streamTextAccum: string;
  currentTurnEmitted: boolean;
  number: number;
  firstEvent: boolean;
  toolCount: number;
  /** Wall-clock ms (Date.now()), or null before the turn's first non-Result message. */
  startedTs: number | null;
  totalMs: number;
  outputTokens: number;
  assistantTextChars: number;
  toolInputChars: number;
  // Cumulative-token snapshot taken at turn start; subtracted at emit time so the thinking pill
  // shows THIS turn's new tokens, not the whole session's running total.
  baselineSessionIn: number;
  baselineSessionOut: number;
  baselineChildrenIn: number;
  baselineChildrenOut: number;
  baselineCaptured: boolean;
  // CLI compact_boundary events seen this turn; one plus a ProcessError = the autocompact-thrash
  // death the context-pressure valve retries.
  compactBoundaries: number;
  // Cached list of this turn's child-session ids (sub-agent forks), refreshed at most once per
  // second -- see thinking.ts's emitConsolidatedThinking for the cache-invalidation window.
  childSessionIds: string[] | null;
  childSessionIdsCachedAt: number;
}

export function createTurnState(): TurnState {
  return {
    streamTextMsgId: null,
    streamToolMsgIdsOrdered: [],
    streamBlockIndexMap: new Map(),
    streamTextAccum: '',
    currentTurnEmitted: false,
    number: 0,
    firstEvent: true,
    toolCount: 0,
    startedTs: null,
    totalMs: 0,
    outputTokens: 0,
    assistantTextChars: 0,
    toolInputChars: 0,
    baselineSessionIn: 0,
    baselineSessionOut: 0,
    baselineChildrenIn: 0,
    baselineChildrenOut: 0,
    baselineCaptured: false,
    compactBoundaries: 0,
    childSessionIds: null,
    childSessionIdsCachedAt: 0,
  };
}
