// engine/src/agents/AgentManager.ts -- AGT-3, a port of the ONE seam in backend/apps/agents/
// agent_manager.py's run_agent_loop that this ticket is about: where MAESTRO_MOCK_AGENT=1 is
// checked, and where in the call order that check sits relative to provider/CLI resolution.
//
// Per docs/HANDOFF.md's file map and this ticket's own instructions, the Python original checks
// mock_agent_enabled() BEFORE build_agent_options() (provider resolution / configure_provider_env)
// and before importing claude_agent_sdk (the CLI spawn path) -- so a mock turn never touches a key,
// a CLI, or the network. This file mirrors that ordering literally: the mock check is the FIRST
// thing runAgentLoop does after resolving the session, and the real (non-mock) path is a single
// throw placed AFTER it -- there is nothing here for a later AGT ticket to accidentally slot ahead
// of the mock check, because a real implementation has to replace the throw, which is textually
// below the check. That is the ordering guarantee this ticket is asked to establish, not just
// satisfy once: whoever lands provider resolution in the engine must edit code that already comes
// after the mock branch, not add a new call in front of it.
//
// Everything about the real (non-mock) turn -- providers/registry.py's get_api_type,
// build_prompt_content, build_agent_options, the CLI spawn itself -- is explicitly OUT of scope for
// AGT-3 and is not stubbed beyond the loud NotImplementedError below; see this repo's
// docs/plans/txm-status.md AGT-3 row for what's deferred to AGT-4+.

import type { AgentConfig, AgentSession } from './core/models';
import { mockAgentEnabled, runMockTurn } from './MockAgent';
import { launchAgent as launchAgentImpl, type LaunchAgentDeps } from './manager/AgentLaunch';
import { sendMessage as sendMessageImpl, editMessage as editMessageImpl, type SendMessageOptions } from './manager/Messaging';
import {
  getSession as getSessionImpl,
  getAllSessions as getAllSessionsImpl,
  getHistory as getHistoryImpl,
  getBrowserAgentChildren as getBrowserAgentChildrenImpl,
  closeSession as closeSessionImpl,
  deleteSession as deleteSessionImpl,
  type SessionLifecycleState,
  type HistoryPage,
} from './manager/session/SessionLifecycle';
import { stopAgent as stopAgentImpl, switchBranch as switchBranchImpl, updateSession as updateSessionImpl } from './manager/SessionControl';
import { wsManager, type ApprovalDecision } from './core/wsManager';

export async function runAgentLoop(sessions: Map<string, AgentSession>, sessionId: string, prompt: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  // MAESTRO_MOCK_AGENT=1 seam: mirrors agent_manager.py's run_agent_loop -- checked here, ahead of
  // any provider/CLI resolution, so a mock turn can never reach either.
  if (mockAgentEnabled()) {
    await runMockTurn(sessions, sessionId, prompt);
    return;
  }

  // Real path: provider resolution + CLI turn. Not yet ported (AGT-4 onward) -- fails loudly
  // instead of silently no-op'ing, the same "no silent fallback" stance WIRE-1 took for a missing
  // engine/dist/main.js.
  throw new Error('runAgentLoop: the real (non-mock) agent turn is not yet implemented in the engine (AGT-4+ ports provider resolution and the CLI spawn)');
}

// ---------------------------------------------------------------------------------------------
// AGT-6: the stateful AgentManager singleton -- what actually gets wired into server.ts's native
// dispatch (engine/src/agents/http.ts + ws.ts). Everything above this point (runAgentLoop) is
// AGT-3's seam, kept as a free function with its own test file (AgentManager.test.ts asserts on it
// directly with a hand-built sessions Map, not through this class) -- this class is additive, not a
// replacement, and calls the same free function internally for the actual turn.
//
// Owns exactly the state the already-ported AGT-5 building blocks (Messaging.ts/AgentLaunch.ts/
// SessionLifecycle.ts/SessionControl.ts) declare as their explicit state parameter -- no
// self/implicit-this the way agent_manager.py's mixins share it, per each of those files' own
// header comments on why. `livePartial`/`hookCtxs`/`stderrBuffers` are unused by anything this
// ticket wires up (they exist only so purgeSessionMemory's single chokepoint has somewhere real to
// delete from) -- populated by whichever ticket ports the real (non-mock) turn loop that writes to
// them.
// ---------------------------------------------------------------------------------------------

export interface TrackedTask {
  cancel(): void;
  done(): boolean;
}

/** Fires `run` immediately (fire-and-forget, mirrors Python's `asyncio.create_task`) and returns a
 * handle whose `done()` flips true once it settles. A rejection is logged, not thrown -- there is
 * no caller left `await`ing this promise by the time it rejects, same as an uncaught exception
 * inside an asyncio.Task getting logged by the loop's exception handler rather than propagating
 * anywhere. `cancel()` is a documented no-op: real cancellation needs an AbortController wired
 * through TurnRunner.ts's client/stream, which doesn't exist yet for the (still-unported) real
 * turn loop -- the mock loop this ticket gates against already resolves in milliseconds, so there
 * is no meaningful "stop mid-turn" race to close here today. */
export function trackTask(run: () => Promise<void>): TrackedTask {
  let finished = false;
  void run()
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[agents] background agent turn failed:', err);
    })
    .finally(() => {
      finished = true;
    });
  return {
    cancel() {
      // See doc comment above -- not wired yet.
    },
    done: () => finished,
  };
}

export class AgentManager {
  readonly sessions = new Map<string, AgentSession>();
  readonly tasks = new Map<string, TrackedTask | undefined>();
  readonly livePartial = new Map<string, unknown>();
  readonly cancelEvents = new Map<string, { set(): void } | undefined>();
  readonly hookCtxs = new Map<string, unknown>();
  readonly stderrBuffers = new Map<string, unknown>();

  private get lifecycleState(): SessionLifecycleState {
    return {
      sessions: this.sessions,
      tasks: this.tasks,
      livePartial: this.livePartial,
      cancelEvents: this.cancelEvents,
      hookCtxs: this.hookCtxs,
      stderrBuffers: this.stderrBuffers,
    };
  }

  private spawnTurn(sessionId: string, prompt: string): void {
    this.tasks.set(sessionId, trackTask(() => runAgentLoop(this.sessions, sessionId, prompt)));
  }

  async launchAgent(config: AgentConfig, deps: LaunchAgentDeps = {}): Promise<AgentSession> {
    return launchAgentImpl(this.sessions, config, deps);
  }

  /** Returns true when a turn was actually spawned for this prompt -- false means a turn was
   * already running and the caller must surface that rather than report success (see
   * Messaging.ts's sendMessage doc). */
  async sendMessage(sessionId: string, prompt: string, options: SendMessageOptions = {}): Promise<boolean> {
    return sendMessageImpl(this.sessions, this.tasks, sessionId, prompt, options, {
      runAgentLoop: (sid, p) => this.spawnTurn(sid, p),
    });
  }

  async editMessage(sessionId: string, messageId: string, newContent: string): Promise<void> {
    return editMessageImpl(this.sessions, this.tasks, sessionId, messageId, newContent, {
      runAgentLoop: (sid, p) => this.spawnTurn(sid, p),
    });
  }

  async stopAgent(sessionId: string): Promise<void> {
    return stopAgentImpl({ sessions: this.sessions, tasks: this.tasks, cancelEvents: this.cancelEvents }, sessionId);
  }

  handleApproval(requestId: string, decision: ApprovalDecision): void {
    wsManager.resolveApproval(requestId, decision);
  }

  async switchBranch(sessionId: string, branchId: string): Promise<void> {
    return switchBranchImpl(this.sessions, sessionId, branchId);
  }

  async updateSession(sessionId: string, fields: Record<string, unknown>): Promise<void> {
    return updateSessionImpl(this.sessions, sessionId, fields);
  }

  getSession(sessionId: string): AgentSession | undefined {
    return getSessionImpl(this.lifecycleState, sessionId);
  }

  getAllSessions(dashboardId?: string): AgentSession[] {
    return getAllSessionsImpl(this.lifecycleState, dashboardId);
  }

  /** No persistence layer exists yet (session_store.py isn't ported -- see SessionLifecycle.ts's
   * header), so history is always empty: this only reflects sessions still resident in memory,
   * never a closed/restarted-away session loaded from disk. Documented scope cut, not a bug. */
  getHistory(opts: { q?: string; limit?: number; offset?: number; dashboardId?: string } = {}): HistoryPage {
    return getHistoryImpl(() => [], opts);
  }

  getBrowserAgentChildren(parentSessionId: string): Array<Record<string, unknown>> {
    return getBrowserAgentChildrenImpl(this.lifecycleState, parentSessionId);
  }

  /** `saveSession` is a no-op: no persistence layer exists yet, so a closed session's data does not
   * survive a process restart (documented scope cut, same as getHistory above). The in-memory
   * close semantics (status flip, pending-approval denial, agent:closed broadcast, purge from every
   * in-memory map) are otherwise faithful. */
  async closeSession(sessionId: string): Promise<void> {
    return closeSessionImpl(this.lifecycleState, sessionId, {
      saveSession: () => {
        // No persistence layer yet -- see doc comment above.
      },
      stopAgent: (childId) => this.stopAgent(childId),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    return deleteSessionImpl(this.lifecycleState, sessionId, {
      deleteSessionFile: () => {
        // No persistence layer yet -- nothing on disk to remove.
      },
      stopAgent: (childId) => this.stopAgent(childId),
    });
  }

  /** How many agent turns are live right now -- backs GET /api/agents/activity, which drives the
   * desktop's idle-update gate. */
  activeCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t && !t.done()) n++;
    return n;
  }
}

/** The one process-wide instance real traffic uses (engine/src/agents/http.ts + ws.ts default to
 * it). A test builds its own AgentManager instead of touching this, same convention
 * screencastServer.ts's getSharedBrowserScreencastRegistry() establishes. */
export const agentManager = new AgentManager();
