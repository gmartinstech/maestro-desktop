// engine/src/agents/manager/Messaging.ts -- AGT-5, a port of
// backend/apps/agents/manager/Messaging.py: turn-producing message operations (send + edit), the
// ones that append a user Message and spawn the agent loop. Session-control ops (stop/approve/
// branch/update) live in SessionControl.py, not ported here (a different file, out of this
// ticket's named list).
//
// Same "explicit state parameter, not an implicit self" shape as SessionLifecycle.ts -- see that
// file's header for why. `runAgentLoop` is required DI: AgentManager.ts's real (non-mock) turn
// loop doesn't exist yet (its own header names this AGT-6+ territory), so there is no real default
// to call. `loadSessionData` (session_store.py) and the browser-fast-path classifier
// (browser_fast_path.py) are also required/optional DI respectively, for the same "not yet ported,
// don't invent behavior" reasoning as SessionLifecycle.ts.

import { randomUUID } from 'node:crypto';
import type { AgentSession, Message, MessageBranch } from '../core/models';
import { wsManager } from '../core/wsManager';
import { getApiType } from '../providers/registry';
import { applyContextWindow } from './session/applyContextWindow';
import { resolveMode } from './prompt/promptContext';

function defaultGetAllToolNames(): string[] {
  return [];
}

export interface SendMessageOptions {
  mode?: string;
  model?: string;
  images?: Array<Record<string, unknown>>;
  context_paths?: Array<Record<string, unknown>>;
  forced_tools?: string[];
  attached_skills?: Array<{ id: string; name: string; content?: string }>;
  hidden?: boolean;
  selected_browser_ids?: string[];
  selected_app_output_ids?: string[];
  selected_setting_ids?: string[];
  client_message_id?: string;
}

export interface MessagingDeps {
  loadSessionData?: (sessionId: string) => Record<string, unknown> | undefined;
  getAllToolNames?: () => string[];
  /** Runs the real agent turn. Required: AgentManager.ts's non-mock loop doesn't exist yet (see
   * this file's header) -- there is no honest default beyond "the caller must supply one". */
  runAgentLoop: (sessionId: string, prompt: string, opts: Record<string, unknown>) => void;
  generateTurnLabel?: (sessionId: string, userMsgId: string, prompt: string) => void;
  /** Stand-in for browser_fast_path.py -- not ported. Default: never eligible, so every send falls
   * through to the normal `runAgentLoop` path (the Python original's own behavior when the
   * classifier errors). */
  classifyBrowserFastPath?: (prompt: string, session: AgentSession) => Promise<{ verdict: 'yes' | 'no' | 'maybe'; brief: string }>;
  runBrowserFastPath?: (session: AgentSession, sessionId: string, prompt: string, selectedBrowserIds: string[] | undefined, brief: string, verdict: string) => void;
  newMessageId?: () => string;
}

/** Send a follow-up message to an existing session. Returns true when a turn was spawned for this
 * prompt, false when it was refused (a turn is already running) -- the caller must surface a false
 * rather than reporting success, or the prompt vanishes with the user seeing an idle run and no
 * error, per the Python original's own comment. */
export async function sendMessage(
  sessions: Map<string, AgentSession>,
  tasks: Map<string, { done(): boolean } | undefined>,
  sessionId: string,
  prompt: string,
  options: SendMessageOptions = {},
  deps: MessagingDeps,
): Promise<boolean> {
  const getAllToolNames = deps.getAllToolNames ?? defaultGetAllToolNames;
  let session = sessions.get(sessionId);
  if (!session) {
    const data = deps.loadSessionData?.(sessionId);
    if (data) {
      session = { ...(data as unknown as AgentSession), closed_at: null };
      applyContextWindow(session);
      sessions.set(sessionId, session);
    } else {
      throw new Error(`Session ${sessionId} not found`);
    }
  }

  const existing = tasks.get(sessionId);
  if (existing && !existing.done()) {
    return false;
  }

  let sessionChanged = false;
  if (options.model && options.model !== session.model) {
    // Cross-provider model switches force a session fork -- see the Python original's comment for
    // the full corruption-avoidance reasoning.
    if (getApiType(session.model) !== getApiType(options.model)) {
      session.needs_fork = true;
    }
    session.model = options.model;
    applyContextWindow(session);
    sessionChanged = true;
  }
  if (options.mode && options.mode !== session.mode) {
    session.mode = options.mode;
    const { tools } = resolveMode(options.mode, getAllToolNames);
    session.allowed_tools = tools;
    sessionChanged = true;
  }
  if (sessionChanged) {
    await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: session.status, session } as never);
  }

  const skillMeta = (options.attached_skills ?? []).map((s) => ({ id: s.id, name: s.name }));
  const imageMeta = (options.images ?? []).map((img) => ({ data: img.data, media_type: img.media_type ?? 'image/png' }));
  const newMessageId = deps.newMessageId ?? (() => randomUUID().replace(/-/g, ''));
  const userMsg: Message = {
    id: newMessageId(),
    role: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
    branch_id: session.active_branch_id,
    parent_id: null,
    context_paths: options.context_paths?.length ? options.context_paths : null,
    attached_skills: skillMeta.length ? skillMeta : null,
    forced_tools: options.forced_tools?.length ? options.forced_tools : null,
    images: imageMeta.length ? imageMeta : null,
    hidden: options.hidden ?? false,
    client_message_id: options.client_message_id ?? null,
    elapsed_ms: null,
    tokens: null,
    tool_count: null,
    input_tokens: null,
  };
  session.messages.push(userMsg);
  await wsManager.sendToSession(sessionId, 'agent:message', { session_id: sessionId, message: userMsg } as never);

  // Fire a background aux LLM call to generate a short verb-phrase label for the narrator pill.
  // Non-blocking; failure is silent and the heuristic stays (mirrors the Python original's
  // fire-and-forget asyncio.create_task, best-effort by construction here too).
  if (!options.hidden && prompt) {
    try {
      deps.generateTurnLabel?.(sessionId, userMsg.id, prompt);
    } catch {
      // Best-effort.
    }
  }

  const isFirstMessage = session.messages.filter((m) => m.role === 'user').length === 1;

  session.status = 'running';
  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: 'running', session } as never);

  // Browser fast path: a plainly browser-only first message skips the orchestrator LLM entirely.
  let fastVerdict = 'no';
  let fastBrief = '';
  if (!options.hidden && deps.classifyBrowserFastPath) {
    try {
      const result = await deps.classifyBrowserFastPath(prompt, session);
      fastVerdict = result.verdict;
      fastBrief = result.brief;
      void isFirstMessage; // real eligibility gating lives in the (not-yet-ported) browser_fast_path.py
    } catch {
      // Best-effort, falls through to the normal path.
    }
  }

  if (fastVerdict !== 'no' && deps.runBrowserFastPath) {
    deps.runBrowserFastPath(session, sessionId, prompt, options.selected_browser_ids, fastBrief, fastVerdict);
  } else {
    deps.runAgentLoop(sessionId, prompt, {
      images: options.images,
      context_paths: options.context_paths,
      forced_tools: options.forced_tools,
      attached_skills: options.attached_skills,
      selected_browser_ids: options.selected_browser_ids,
      selected_app_output_ids: options.selected_app_output_ids,
      selected_setting_ids: options.selected_setting_ids,
    });
  }
  return true;
}

export interface EditMessageDeps {
  runAgentLoop: (sessionId: string, prompt: string, opts: Record<string, unknown>) => void;
  newBranchId?: () => string;
}

/** Edit a prior user message, creating a new branch (fork). */
export async function editMessage(
  sessions: Map<string, AgentSession>,
  tasks: Map<string, { cancel(): void; done(): boolean } | undefined>,
  sessionId: string,
  messageId: string,
  newContent: string,
  deps: EditMessageDeps,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const existing = tasks.get(sessionId);
  if (existing && !existing.done()) {
    existing.cancel();
    while (!existing.done()) await new Promise((r) => setTimeout(r, 10));
  }

  const targetMsg = session.messages.find((m) => m.id === messageId);
  if (!targetMsg || targetMsg.role !== 'user') throw new Error('Can only edit user messages');

  let forkPointId = messageId;
  let forkParentBranch = targetMsg.branch_id;

  const msgBranch = session.branches[targetMsg.branch_id];
  if (msgBranch?.fork_point_message_id) {
    const branchUserMsgs = session.messages.filter((m) => m.branch_id === targetMsg.branch_id && m.role === 'user');
    if (branchUserMsgs.length && branchUserMsgs[0].id === messageId) {
      forkPointId = msgBranch.fork_point_message_id;
      forkParentBranch = msgBranch.parent_branch_id || 'main';
    }
  }

  const newBranchId = (deps.newBranchId ?? (() => randomUUID().replace(/-/g, '')))();
  const newBranch: MessageBranch = {
    id: newBranchId,
    parent_branch_id: forkParentBranch,
    fork_point_message_id: forkPointId,
    created_at: new Date().toISOString(),
  };
  session.branches[newBranchId] = newBranch;
  session.active_branch_id = newBranchId;
  session.needs_fresh_session = true;

  const editedMsg: Message = {
    id: randomUUID().replace(/-/g, ''),
    role: 'user',
    content: newContent,
    timestamp: new Date().toISOString(),
    branch_id: newBranchId,
    parent_id: targetMsg.parent_id,
    images: targetMsg.images,
    context_paths: targetMsg.context_paths,
    forced_tools: targetMsg.forced_tools,
    attached_skills: targetMsg.attached_skills,
    hidden: false,
    client_message_id: null,
    elapsed_ms: null,
    tokens: null,
    tool_count: null,
    input_tokens: null,
  };
  session.messages.push(editedMsg);

  await wsManager.sendToSession(sessionId, 'agent:message', { session_id: sessionId, message: editedMsg } as never);
  await wsManager.sendToSession(sessionId, 'agent:branch_created', { session_id: sessionId, branch: newBranch, active_branch_id: newBranchId } as never);

  session.status = 'running';
  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: 'running', session } as never);

  deps.runAgentLoop(sessionId, newContent, {
    images: targetMsg.images,
    context_paths: targetMsg.context_paths,
    forced_tools: targetMsg.forced_tools,
    attached_skills: targetMsg.attached_skills,
    fork_session: true,
  });
}
