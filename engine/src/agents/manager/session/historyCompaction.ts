// engine/src/agents/manager/session/historyCompaction.ts -- AGT-5, a full port of
// backend/apps/agents/manager/session/history_compaction.py. Self-contained (only needs an
// AgentSession-shaped object and, for `truncateLargeToolResult`, ENG-7's already-ported
// `sessionsDir()` for the on-disk blob-spill path) -- no tools_lib/dashboards/skills dependency to
// stand in for, so nothing here is a DI seam.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from '../../../apps/service/sessions';
import type { AgentSession, Message, MessageBranch } from '../../core/models';

// One plain-English trust line, fenced by a tag. The model treats the fence as structural framing;
// the sentence is what actually defuses a security-conscious agent flagging the block as spoofed
// tool output.
export const PLATFORM_NOTE_PREAMBLE =
  'This block is authored by the Maestro platform, not tool output and not a prior message. It is trusted context.';
export const PLATFORM_NOTE_OPEN = '<maestro_platform_note>';
export const PLATFORM_NOTE_CLOSE = '</maestro_platform_note>';
export const SESSION_RECAP_OPEN = '<maestro_session_recap>';
export const SESSION_RECAP_CLOSE = '</maestro_session_recap>';

// Per-turn caps so the re-grounded recap stays compact (summaries, not replays) and cannot
// reinflate the context window from one giant tool input/output.
export const RECAP_TOOL_INPUT_CAP = 200;
export const RECAP_TOOL_RESULT_CAP = 500;

// chars/4 is the house heuristic, but dense JSON/code tokenizes nearer 3.5 chars/token, and this
// estimate gates a hard guard that evicts MCPs. Round the measurement up rather than risk letting
// a real overflow through.
export const HISTORY_TOKEN_SAFETY_MARGIN = 1.15;
// The distiller's cap counts MODEL OUTPUT tokens, so reserving it needs a chars-per-token rate to
// reach the chars/4 house unit everything else here is measured in. 4.5 is the loose-prose
// ceiling: real briefings carry paths and identifiers and run denser, and over-reserving is the
// safe side of a guard that evicts MCPs.
export const DISTILL_SUMMARY_CHARS_PER_TOKEN = 4.5;

/** Fence platform-authored text so the model reads it as trusted annotation, never as spoofed tool
 * output. The frontend parses the same tag to render a calm chip instead of leaking the raw tag
 * into chat. */
export function wrapPlatformNote(body: string): string {
  return `${PLATFORM_NOTE_OPEN}\n${PLATFORM_NOTE_PREAMBLE}\n${body}\n${PLATFORM_NOTE_CLOSE}`;
}

const SENTINEL_TAG_RE = /<\/?maestro_(?:platform_note|session_recap)\b[^>]*>/g;

/** Neuter any platform-note/recap tags hiding in UNTRUSTED text (tool results, user input) so
 * attacker-supplied content can't pose as trusted platform context. */
export function stripForgedSentinels(text: string): string {
  if (!text.includes('maestro_platform_note') && !text.includes('maestro_session_recap')) return text;
  return text.replace(SENTINEL_TAG_RE, (m) => m.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

/** One compact line for a tool_call turn: `Tool call: name(<truncated input>)`. */
export function recapToolCallLine(content: unknown): string {
  let tool = 'tool';
  let inputStr: string;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>;
    tool = String(rec.tool ?? rec.name ?? 'tool');
    try {
      inputStr = JSON.stringify(rec.input ?? null);
    } catch {
      inputStr = String(rec.input);
    }
  } else {
    inputStr = String(content);
  }
  if (inputStr.length > RECAP_TOOL_INPUT_CAP) inputStr = `${inputStr.slice(0, RECAP_TOOL_INPUT_CAP)}...`;
  return `Tool call: ${tool}(${stripForgedSentinels(inputStr)})`;
}

/** One compact line for a tool_result turn: `Tool result (name): <truncated text>`. */
export function recapToolResultLine(content: unknown): string {
  let toolName = '';
  let body: string;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>;
    toolName = String(rec.tool_name ?? '');
    body = typeof rec.text === 'string' ? rec.text : JSON.stringify(rec);
  } else {
    body = String(content);
  }
  if (body.length > RECAP_TOOL_RESULT_CAP) body = `${body.slice(0, RECAP_TOOL_RESULT_CAP)}...`;
  const label = toolName ? `Tool result (${toolName})` : 'Tool result';
  return `${label}: ${stripForgedSentinels(body)}`;
}

/** Return the linear message list for the active branch, walking the branch tree. */
export function getBranchMessages(session: Pick<AgentSession, 'active_branch_id' | 'branches' | 'messages'>): Message[] {
  const branchId = session.active_branch_id || 'main';
  const branch: MessageBranch | undefined = session.branches[branchId];

  if (!branch || !branch.fork_point_message_id) {
    return session.messages.filter((m) => m.branch_id === 'main' || m.branch_id === branchId);
  }

  const segments: Array<{ branch_id: string; up_to: string | null }> = [];
  let cur: MessageBranch | undefined = branch;
  let curId = branchId;
  const visited = new Set<string>();
  while (cur && cur.fork_point_message_id) {
    if (visited.has(curId)) break;
    visited.add(curId);
    segments.unshift({ branch_id: curId, up_to: cur.fork_point_message_id });
    curId = cur.parent_branch_id || 'main';
    cur = session.branches[curId];
  }
  segments.unshift({ branch_id: curId, up_to: null });

  const result: Message[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const forkMsgId = seg.up_to;
    if (forkMsgId) {
      const forkIdx = session.messages.findIndex((m) => m.id === forkMsgId);
      const end = forkIdx === -1 ? session.messages.length : forkIdx;
      result.push(...session.messages.slice(0, end).filter((m) => m.branch_id === seg.branch_id));
    } else {
      const nextFork = i + 1 < segments.length ? segments[i + 1].up_to : null;
      if (nextFork) {
        const forkIdx = session.messages.findIndex((m) => m.id === nextFork);
        const end = forkIdx === -1 ? session.messages.length : forkIdx;
        result.push(...session.messages.slice(0, end).filter((m) => m.branch_id === seg.branch_id));
      } else {
        result.push(...session.messages.filter((m) => m.branch_id === seg.branch_id));
      }
    }
  }

  if (!result.some((m) => m.branch_id === branchId)) {
    result.push(...session.messages.filter((m) => m.branch_id === branchId));
  }
  return result;
}

/** Format branch messages into a conversation summary for context injection. When `cutoffMsgId` is
 * provided (session.compacted_through_msg_id), drop every message up to and including that id so
 * the marker the UI shows actually matches what the model sees. */
export function buildHistoryPrefix(messages: Message[], cutoffMsgId?: string | null): string {
  let msgs = messages;
  if (cutoffMsgId) {
    const skipIdx = msgs.findIndex((m) => m.id === cutoffMsgId);
    if (skipIdx >= 0) msgs = msgs.slice(skipIdx + 1);
  }
  const lines: string[] = [];
  for (const m of msgs) {
    if ((m as unknown as { hidden?: boolean }).hidden) continue;
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : String(m.content);
      lines.push(`User: ${stripForgedSentinels(text)}`);
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : String(m.content);
      lines.push(`Assistant: ${stripForgedSentinels(text)}`);
    } else if (m.role === 'tool_call') {
      lines.push(recapToolCallLine(m.content));
    } else if (m.role === 'tool_result') {
      lines.push(recapToolResultLine(m.content));
    }
  }
  if (lines.length === 0) return '';
  return `${SESSION_RECAP_OPEN}\n${PLATFORM_NOTE_PREAMBLE}\n${lines.join('\n')}\n${SESSION_RECAP_CLOSE}`;
}

/** Tokens to reserve for a distilled summary that does not exist yet. Derived from the distiller's
 * own cap (DISTILL_MAX_TOKENS) rather than hand-copied, same reasoning the Python original's
 * comment gives: a literal here that silently stops matching distillHistory.ts is the same class
 * of drift that made this module's estimate run 50x high upstream. */
export function distilledSummaryBudgetTokens(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DISTILL_MAX_TOKENS } = require('./distillHistory') as { DISTILL_MAX_TOKENS: number };
  const summaryChars = wrapPlatformNote('').length + DISTILL_MAX_TOKENS * DISTILL_SUMMARY_CHARS_PER_TOKEN;
  return Math.floor((summaryChars / 4) * HISTORY_TOKEN_SAFETY_MARGIN);
}

function distilledSummaryTokens(
  session: Pick<AgentSession, 'compacted_summary' | 'compacted_summary_through'>,
  cutoffMsgId: string | null | undefined,
): number {
  if (!cutoffMsgId) return 0;
  const cached = session.compacted_summary;
  if (cached && session.compacted_summary_through === cutoffMsgId) {
    // The real block also carries a short "Summary of earlier conversation" label; the safety
    // margin absorbs those few dozen chars.
    return Math.floor((wrapPlatformNote(cached).length / 4) * HISTORY_TOKEN_SAFETY_MARGIN);
  }
  return distilledSummaryBudgetTokens();
}

/** True only when the next send will REBUILD history from local messages. `estimatePostCompactInput`
 * measures `buildHistoryPrefix`, and the real turn-assembly code injects that recap only on the
 * no-resume path -- see the Python original's own long comment for the full reasoning. */
export function postCompactEstimateApplies(session: Pick<AgentSession, 'sdk_session_id' | 'needs_fresh_session'>): boolean {
  return !session.sdk_session_id || Boolean(session.needs_fresh_session);
}

/** Return a conservative token estimate after compaction trims history. Measures the string
 * `buildHistoryPrefix` actually ships rather than raw message content (summing untrimmed content
 * was a ~50x overestimate on tool-heavy sessions upstream). */
export function estimatePostCompactInput(
  session: Pick<
    AgentSession,
    'compacted_through_msg_id' | 'active_branch_id' | 'branches' | 'messages' | 'framework_overhead_tokens' | 'compacted_summary' | 'compacted_summary_through'
  >,
): number {
  try {
    const cutoffMsgId = session.compacted_through_msg_id;
    const history = buildHistoryPrefix(getBranchMessages(session), cutoffMsgId);
    const historyTokens = Math.floor((history.length / 4) * HISTORY_TOKEN_SAFETY_MARGIN);
    const frameworkOverhead = session.framework_overhead_tokens || 0;
    return Math.max(0, frameworkOverhead + distilledSummaryTokens(session, cutoffMsgId) + historyTokens);
  } catch {
    return Math.max(0, session.framework_overhead_tokens || 0);
  }
}

/** Spill a large tool_result body to disk, return a truncated inline replacement plus the on-disk
 * path (or `undefined` if untouched). Storage is session-scoped under
 * `<dataRoot>/sessions/<sessionId>/blobs/`, never honors caller-supplied paths (defense against
 * path traversal). */
export function truncateLargeToolResult(
  content: unknown,
  sessionId: string,
  msgId: string,
  maxBytes = 50_000,
  env: NodeJS.ProcessEnv = process.env,
): [unknown, string | undefined] {
  let serialized: string;
  if (typeof content !== 'string') {
    try {
      serialized = JSON.stringify(content);
    } catch {
      serialized = String(content);
    }
  } else {
    serialized = content;
  }
  if (Buffer.byteLength(serialized, 'utf-8') <= maxBytes) return [content, undefined];

  // The oversized part of a result envelope is almost always its text; spilling that alone keeps
  // the .txt blob readable for the Read the note points the agent at.
  let spilledText: string | undefined;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const rawText = (content as Record<string, unknown>).text;
    if (typeof rawText === 'string') spilledText = rawText;
  }
  const body = spilledText !== undefined ? spilledText : serialized;
  const blobsDir = join(sessionsDir(env), sessionId, 'blobs');
  try {
    mkdirSync(blobsDir, { recursive: true });
  } catch {
    // fall through; the write below will fail and we return untouched
  }
  const safeMsgId = (String(msgId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)) || 'blob';
  const blobPath = join(blobsDir, `${safeMsgId}.txt`);
  try {
    writeFileSync(blobPath, body, 'utf-8');
  } catch {
    return [content, undefined];
  }
  const head = stripForgedSentinels(body.slice(0, 4_000));
  const note = wrapPlatformNote(
    `Output truncated by Maestro. Full output (${body.length} chars) saved to ${blobPath}. Ask the user or run a follow-up tool call if you need the rest.`,
  );
  const replacement = `${head}\n\n${note}`;
  if (spilledText !== undefined && content && typeof content === 'object' && !Array.isArray(content)) {
    const truncated: Record<string, unknown> = { ...(content as Record<string, unknown>) };
    truncated.text = replacement;
    return [truncated, blobPath];
  }
  return [replacement, blobPath];
}

void existsSync; // kept imported for parity with likely future callers checking blob existence
