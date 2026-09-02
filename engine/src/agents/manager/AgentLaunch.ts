// engine/src/agents/manager/AgentLaunch.ts -- AGT-5, a port of
// backend/apps/agents/manager/AgentLaunch.py: launchAgent (a new top-level run) and invokeAgent
// (fork-and-send a sub-agent).
//
// PORTS THE FIXED BEHAVIOUR, not the bug it replaced: AgentLaunch.py's workspace-location fallback
// resolves through `p_state_home()` (the override-aware state home, `pStateHome()` here), which
// was itself a same-day fix for a real bug (raw `os.path.expanduser("~")` leaked real `git init`'d
// workspaces into the developer's actual home when MAESTRO_STATE_HOME was overridden -- CTR-4's
// row in txm-status.md has the original discovery). The fix introduced a DELIBERATE split that
// this port carries over exactly: `pStateHome()` decides the workspace LOCATION (so
// MAESTRO_STATE_HOME isolation actually isolates), but `ensureCwdGitRepo`'s second argument is
// `realHome()` -- the REAL, un-overridden home -- because that argument is used ONLY to build the
// never-git-init-here guard (never touch $HOME, `/`, or $HOME's parent). Passing the state home
// there instead would narrow that guard to the state home, so a user pointing target_directory at
// their ACTUAL home while MAESTRO_STATE_HOME is overridden would slip past it. Getting this
// backwards reintroduces the exact bug the same-day fix closed -- see this file's own tests for a
// standing regression check.
//
// Scope cuts (each a stand-in for a not-yet-ported subsystem, documented at its own call site
// below): the view-builder workspace-seed-and-register side effect (outputs.outputs, SUB-5), the
// "editing an existing App" single-selected-app rebind (outputs.workspace_io, SUB-5), and the
// analytics track_agent_created call (backend/apps/service/analytics, not yet ported) are all DI
// seams defaulting to a no-op, matching the Python original's own try/except-and-continue shape
// around each of those calls -- a launch still succeeds identically without them, just without the
// extra UI/analytics side effect.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentConfig, AgentSession, Message, MessageBranch } from '../core/models';
import { createAgentSession } from '../sessionFactory';
import { wsManager } from '../core/wsManager';
import { loadSettings } from '../../settings/store';
import { applyContextWindow } from './session/applyContextWindow';
import { detectGitIdentity, ensureCwdGitRepo } from './session/workspaceGit';
import { resolveMode } from './prompt/promptContext';
import { homeStateDir, pStateHome, realHome } from './statePaths';

function defaultGetAllToolNames(): string[] {
  return [];
}

export interface LaunchAgentDeps {
  getAllToolNames?: () => string[];
  loadSettings?: () => { settings: { default_folder: string | null; default_thinking_level: string } };
  /** Stand-in for outputs.outputs.ensure_webapp_workspace_seeded_and_registered (SUB-5, App
   * Builder). No default effect: a canvas-chat App Builder launch won't register an Output row
   * (so the Apps sidebar won't light up) until SUB-5 wires this, but the session itself still
   * launches and the agent can still write files into `effectiveCwd`. */
  ensureWebappWorkspaceSeededAndRegistered?: (args: { workspaceId: string; folder: string; sessionId: string }) => string | undefined;
  /** Stand-in for outputs.workspace_io.app_workspace_dir (SUB-5). No default: an "edit this one
   * selected App" launch falls through to the normal view-builder seed path instead of rebinding
   * to the existing app's workspace. */
  appWorkspaceDir?: (outputId: string) => string | undefined;
  /** Stand-in for the analytics.track_agent_created call. Default no-op. */
  trackAgentCreated?: (args: { id: string; dashboardId: string | null }) => void;
  newSessionId?: () => string;
}

/** Mirrors `launch_agent`: create and register a new session, resolving its working directory
 * through the same fallback chain (target_directory -> mode folder -> settings.default_folder ->
 * state home) the Python original uses, with the state-home-vs-real-home split described above. */
export async function launchAgent(sessions: Map<string, AgentSession>, config: AgentConfig, deps: LaunchAgentDeps = {}): Promise<AgentSession> {
  const getAllToolNames = deps.getAllToolNames ?? defaultGetAllToolNames;
  const loadSettingsFn = deps.loadSettings ?? (() => loadSettings());
  const sessionId = (deps.newSessionId ?? (() => randomUUID().replace(/-/g, '')))();

  // Editing an existing App: when exactly one App card was selected in App Builder mode with no
  // explicit target_directory, point the chat at that app's workspace so it edits in place.
  let targetDirectory = config.target_directory;
  if (config.mode === 'view-builder' && !targetDirectory && config.selected_app_output_ids?.length === 1 && deps.appWorkspaceDir) {
    const bound = deps.appWorkspaceDir(config.selected_app_output_ids[0]);
    if (bound) targetDirectory = bound;
  }

  const { tools: modeTools, default_folder: modeFolder } = resolveMode(config.mode, getAllToolNames);
  const globalSettings = loadSettingsFn().settings;

  let effectiveCwd = targetDirectory || modeFolder || globalSettings.default_folder || pStateHome();

  if ((config.mode === 'view-builder' || config.mode === 'skill-builder') && !targetDirectory) {
    effectiveCwd = join(effectiveCwd, sessionId);
  }

  mkdirSync(effectiveCwd, { recursive: true });

  // Canvas-chat App Builder launch: seed the React template + register an Output row so the app
  // shows up in the Apps sidebar immediately. See this file's header for the scope cut.
  if (config.mode === 'view-builder' && !targetDirectory && deps.ensureWebappWorkspaceSeededAndRegistered) {
    try {
      deps.ensureWebappWorkspaceSeededAndRegistered({ workspaceId: sessionId, folder: effectiveCwd, sessionId });
    } catch {
      // Best-effort, mirrors the Python original's logged-and-continue.
    }
  }

  // If the fallback chain landed on the state-home directory (no project dir, no default_folder
  // set), re-route to a dedicated scratch workspace under <state_home>/.maestro/workspaces/
  // <session_id>. This prevents writing .git/ (or anything else) into the real $HOME (or
  // MAESTRO_STATE_HOME override) directly.
  const home = pStateHome();
  if (resolve(effectiveCwd) === resolve(home)) {
    effectiveCwd = homeStateDir('workspaces', sessionId);
    mkdirSync(effectiveCwd, { recursive: true });
  }

  // Pass the REAL home, not the state home -- see this file's header for why. Handing it
  // pStateHome() would narrow the never-git-init-here guard to the state home, so a user pointing
  // target_directory at their actual home while MAESTRO_STATE_HOME is overridden would slip past it.
  ensureCwdGitRepo(effectiveCwd, realHome());

  const [repoUrl, branchName] = detectGitIdentity(effectiveCwd);

  const session = createAgentSession({
    id: sessionId,
    name: config.name,
    provider: config.provider || 'anthropic',
    model: config.model,
    mode: config.mode,
    system_prompt: config.system_prompt,
    allowed_tools: modeTools,
    max_turns: config.max_turns,
    cwd: effectiveCwd,
    repo_url: repoUrl ?? null,
    branch: branchName ?? null,
    dashboard_id: config.dashboard_id,
    workflow_run_id: config.workflow_run_id,
    workflow_edit_id: config.workflow_edit_id,
    thinking_level: (globalSettings.default_thinking_level as AgentSession['thinking_level']) ?? 'auto',
    created_at: new Date().toISOString(),
    branches: {},
  });
  applyContextWindow(session);
  sessions.set(sessionId, session);

  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: 'running', session } as never);

  try {
    deps.trackAgentCreated?.({ id: session.id, dashboardId: session.dashboard_id });
  } catch {
    // Best-effort, mirrors the Python original's try/except pass.
  }

  return session;
}

export interface InvokeAgentDeps {
  runAgentLoop?: (sessionId: string, prompt: string, opts: { forkSession: boolean }) => Promise<void>;
  newId?: () => string;
}

/** Mirrors `invoke_agent`: fork an existing session and send it a new message, returning the
 * result. `runAgentLoop` is DI'd -- wiring the fork to the REAL turn loop (AGT-4's TurnRunner, via
 * whichever ticket completes AgentManager.ts's non-mock path) is the caller's job, not this file's;
 * a default that throws would be wrong here because a caller that only wants the fork side effect
 * (no actual turn) is a legitimate use, so the default is a no-op that leaves the forked session
 * exactly as constructed (no assistant reply). */
export async function invokeAgent(
  sessions: Map<string, AgentSession>,
  sourceSessionId: string,
  message: string,
  opts: { parentSessionId?: string; dashboardId?: string } = {},
  deps: InvokeAgentDeps = {},
): Promise<{ forkedSessionId: string; sourceName: string; response: string; costUsd: number }> {
  const source = sessions.get(sourceSessionId);
  if (!source) throw new Error(`Session ${sourceSessionId} not found`);
  const sourceName = source.name;

  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, ''));
  const oldToNewMsg = new Map<string, string>();
  const newMessages: Message[] = source.messages.map((msg) => {
    const newMsgId = newId();
    oldToNewMsg.set(msg.id, newMsgId);
    return {
      ...msg,
      id: newMsgId,
      parent_id: msg.parent_id ? (oldToNewMsg.get(msg.parent_id) ?? null) : null,
      // Sub-agents do NOT inherit the parent's attached files -- see the Python original's comment
      // for the cost-explosion reasoning.
      context_paths: null,
    };
  });

  const newBranches: Record<string, MessageBranch> = {};
  for (const [bid, branch] of Object.entries(source.branches)) {
    newBranches[bid] = {
      ...branch,
      fork_point_message_id: branch.fork_point_message_id ? (oldToNewMsg.get(branch.fork_point_message_id) ?? null) : null,
    };
  }

  const fork = createAgentSession({
    id: newId(),
    name: `${sourceName} (invoked)`,
    status: 'running',
    model: source.model,
    mode: 'invoked-agent',
    sdk_session_id: source.sdk_session_id,
    system_prompt: source.system_prompt,
    allowed_tools: [...source.allowed_tools],
    max_turns: source.max_turns || 25,
    cwd: source.cwd,
    created_at: new Date().toISOString(),
    messages: newMessages,
    branches: newBranches,
    active_branch_id: source.active_branch_id,
    tool_group_meta: { ...source.tool_group_meta },
    dashboard_id: opts.dashboardId ?? source.dashboard_id,
    parent_session_id: opts.parentSessionId ?? null,
  });
  applyContextWindow(fork);

  sessions.set(fork.id, fork);

  await wsManager.broadcastGlobal('agent:status', { session_id: fork.id, status: fork.status, session: fork } as never);

  const userMsg: Message = {
    id: newId(),
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
    branch_id: fork.active_branch_id,
    parent_id: null,
    context_paths: null,
    attached_skills: null,
    forced_tools: null,
    images: null,
    hidden: false,
    client_message_id: null,
    elapsed_ms: null,
    tokens: null,
    tool_count: null,
    input_tokens: null,
  };
  fork.messages.push(userMsg);
  await wsManager.sendToSession(fork.id, 'agent:message', { session_id: fork.id, message: userMsg } as never);

  if (deps.runAgentLoop) {
    await deps.runAgentLoop(fork.id, message, { forkSession: true });
  }

  let lastAssistant: string | undefined;
  for (let i = fork.messages.length - 1; i >= 0; i--) {
    const msg = fork.messages[i];
    if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        lastAssistant = content;
      } else if (Array.isArray(content)) {
        const texts = content
          .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
          .map((b) => b.text ?? '');
        lastAssistant = texts.join('\n');
      } else {
        lastAssistant = String(content);
      }
      break;
    }
  }

  return {
    forkedSessionId: fork.id,
    sourceName,
    response: lastAssistant || 'No response from invoked agent.',
    costUsd: fork.cost_usd,
  };
}
