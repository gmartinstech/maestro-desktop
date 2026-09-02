// engine/src/apps/workflows/executor.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/executor.py: run a workflow by launching an agent session and feeding it
// the steps sequentially, leaning entirely on agentManager's existing launch + sendMessage path so
// a scheduled run looks identical to a manual chat (same MCP gate, action filtering, provider
// routing, history).
//
// The real (non-mock) agent turn loop is not yet implemented in this engine (AgentManager.ts's own
// header: runAgentLoop throws for anything but MAESTRO_MOCK_AGENT=1) -- this executor is agnostic
// to that distinction, exactly like the Python original is agnostic to which provider/CLI actually
// answers: it drives agentManager.launchAgent/sendMessage and polls session status, so it works
// today under MAESTRO_MOCK_AGENT=1 (the sanctioned path for proving the engine end-to-end per this
// repo's CLAUDE.md) and will keep working unmodified once a later ticket lands the real turn loop.

import type { AgentConfig, AgentSession } from '../../agents/core/models';
import { agentManager } from '../../agents/AgentManager';
import { wsManager } from '../../agents/core/wsManager';
import {
  clearWorkflowApprovalMemory,
  getWorkflowStepUsage,
  setWorkflowApprovalMemory,
  setWorkflowApprovalStep,
} from '../../agents/manager/permissions/workflowApproval';
import * as dashboardsStore from '../dashboards/store';
import * as storage from './store';
import { newWorkflowRun, type Workflow, type WorkflowRun } from './models';

// workflow_id -> currently running run id. Prevents two overlapping fires for the same workflow
// (e.g. a cron tick racing a manual Run button). Node is single-threaded and every check-then-set
// below runs with no `await` in between, so -- unlike the Python original, which needs an explicit
// asyncio.Lock even on a single event loop because its own check spans an await boundary -- no lock
// object is needed here for the same atomicity guarantee.
const running = new Map<string, string>();
// run_id -> "stop". Set by the stop endpoint so the executor loop (not the HTTP handler) owns the
// run's terminal write.
const runControl = new Map<string, 'stop'>();
// run_id -> [paused, expiresAtMs]. Keeps an explicit pause/resume control state authoritative
// briefly while the watcher's derived-from-session-status view catches up.
const runPauseOverride = new Map<string, [boolean, number]>();
// workflow_id -> session_id of the in-flight run, kept in step with `running` so pause/trash can
// halt a live run even for a workflow list_workflows() now filters out (deleted).
const runningSession = new Map<string, string>();

export function requestStop(runId: string): void {
  runControl.set(runId, 'stop');
}

/** Signal the in-flight run for this workflow to stop and return its session id (undefined if
 * nothing is running). */
export function stopActiveRun(workflowId: string): string | undefined {
  const runId = running.get(workflowId);
  if (!runId) return undefined;
  runControl.set(runId, 'stop');
  return runningSession.get(workflowId);
}

export function setPauseOverride(runId: string, paused: boolean, ttlS = 5.0): void {
  runPauseOverride.set(runId, [paused, Date.now() + ttlS * 1000]);
}

export function runningSnapshot(): Array<[string, string]> {
  return [...running.entries()];
}

function resolveSystemPrompt(wf: Workflow): string | null {
  if (wf.use_synced_prompt) return null;
  return wf.system_prompt || null;
}

export function resolveAllowedTools(wf: Workflow): string[] | null {
  if (!wf.actions.freeze) return null;
  return [...wf.actions.configured_sets];
}

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'AskUserQuestion'];

/** Pick the dashboard this run's agent attaches to -- mirrors resolve_workflow_dashboard_id. */
export function resolveWorkflowDashboardId(wf: Workflow, env: NodeJS.ProcessEnv = process.env): string | null {
  if (wf.dashboard_id) return wf.dashboard_id;
  if (wsManager.activeDashboardId) return wsManager.activeDashboardId;
  const dashboards = dashboardsStore.loadAll(env);
  if (dashboards.length > 0) {
    const sorted = [...dashboards].sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
    return sorted[0].id;
  }
  return null;
}

export function makeRememberApproval(workflowId: string, env: NodeJS.ProcessEnv = process.env): (toolName: string, behavior: string) => void {
  return (toolName: string, behavior: string) => {
    const fresh = storage.getWorkflow(workflowId, env);
    if (fresh === null) return;
    fresh.remembered_approvals = { ...fresh.remembered_approvals, [toolName]: behavior as 'allow' | 'deny' };
    storage.saveWorkflow(fresh, env);
    void wsManager.broadcastGlobal('workflow:updated', { workflow_id: fresh.id, workflow: fresh });
  };
}

export function persistStepToolUsage(
  workflowId: string,
  stepUsage: Record<string, Record<string, boolean>>,
  testedSignature: string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const fresh = storage.getWorkflow(workflowId, env);
  if (fresh === null) return;
  const liveIds = new Set(fresh.steps.map((s) => s.id));
  if (fresh.draft_steps !== null) for (const s of fresh.draft_steps) liveIds.add(s.id);
  const pruned: Record<string, Record<string, boolean>> = {};
  for (const [sid, tools] of Object.entries(stepUsage || {})) {
    if (liveIds.has(sid) && typeof tools === 'object' && tools !== null) pruned[sid] = { ...tools };
  }
  fresh.step_tool_usage = pruned;
  if (testedSignature !== null) fresh.tested_signature = testedSignature;
  storage.saveWorkflow(fresh, env);
  void wsManager.broadcastGlobal('workflow:updated', { workflow_id: fresh.id, workflow: fresh });
}

/** Merge run-side fields into the current on-disk workflow, re-reading it fresh so a PATCH the
 * user made mid-run isn't clobbered -- mirrors _persist_run_fields. Silently skips if the workflow
 * was deleted while the run was in flight. */
export function persistRunFields(
  wf: Workflow,
  runFields: Partial<Workflow>,
  scheduleRunsCountDelta = 0,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const fresh = storage.getWorkflow(wf.id, env);
  if (fresh === null) return;
  Object.assign(fresh, runFields);
  if (scheduleRunsCountDelta) {
    fresh.schedule = { ...fresh.schedule, runs_count: fresh.schedule.runs_count + scheduleRunsCountDelta };
  }
  storage.saveWorkflow(fresh, env);
}

function monthlySpendSoFar(wf: Workflow, env: NodeJS.ProcessEnv): number {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  let total = 0;
  for (const r of storage.listRuns(wf.id, 200, env)) {
    if (!r.started_at) continue;
    const started = new Date(r.started_at).getTime();
    if (started >= cutoff) total += r.cost_usd || 0;
  }
  return total;
}

export function ranLate(startedAtIso: string, scheduledForIso: string): boolean {
  const deltaS = (new Date(startedAtIso).getTime() - new Date(scheduledForIso).getTime()) / 1000;
  return deltaS > 300;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function toolCallLabel(session: AgentSession): string {
  const msgs = session.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'tool_call') continue;
    const content = m.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_use') {
          return String((b as Record<string, unknown>).name ?? '');
        }
      }
    } else if (content && typeof content === 'object') {
      return String((content as Record<string, unknown>).name ?? '');
    } else if (typeof content === 'string') {
      return content.slice(0, 60);
    }
  }
  return '';
}

interface WatcherHandle {
  stopped: boolean;
}

function startToolCallWatcher(wf: Workflow, run: WorkflowRun, sessionId: string): WatcherHandle {
  const handle: WatcherHandle = { stopped: false };
  let lastSeen = '';
  let lastPaused = false;
  const tick = async (): Promise<void> => {
    if (handle.stopped) return;
    const sess = agentManager.sessions.get(sessionId);
    if (!sess) return;
    const now = Date.now();
    const override = runPauseOverride.get(run.id);
    let pausedNow: boolean;
    if (override && override[1] >= now) {
      pausedNow = override[0];
    } else {
      if (override) runPauseOverride.delete(run.id);
      pausedNow = sess.status === 'stopped';
    }
    const label = toolCallLabel(sess);
    const labelChanged = Boolean(label) && label !== lastSeen;
    if (labelChanged || pausedNow !== lastPaused) {
      if (labelChanged) {
        lastSeen = label;
        run.last_tool_label = label;
      }
      lastPaused = pausedNow;
      run.paused = pausedNow;
      try {
        await wsManager.broadcastGlobal('workflow:run', { workflow_id: wf.id, run });
      } catch {
        // Best-effort.
      }
    }
    if (!handle.stopped) {
      const t = setTimeout(() => void tick(), 1500);
      t.unref?.();
    }
  };
  const t = setTimeout(() => void tick(), 1500);
  t.unref?.();
  return handle;
}

export interface ExecuteOptions {
  triggeredBy?: 'schedule' | 'manual' | 'retry';
  scheduledFor?: string;
  testedSignature?: string;
}

/** Wait out the current step's agent turn -- mirrors _await_session_idle. Returns a disposition:
 * 'idle' (advance), 'error', or 'stopped'. `holdOnPause` (a real run passes true) means a session
 * that goes 'stopped' WITHOUT a stop signal is a user PAUSE, not terminal -- hold until Resume or
 * Stop, refreshing the idle deadline so a long pause never trips the idle timeout. */
export async function awaitSessionIdle(sessionId: string, runId: string | null, idleTimeoutS = 1200): Promise<'idle' | 'error' | 'stopped'> {
  const holdOnPause = runId !== null;
  let lastActivityKey = '';
  let deadline = Date.now() + idleTimeoutS * 1000;
  for (;;) {
    if (runId !== null && runControl.get(runId) === 'stop') return 'stopped';
    const sess = agentManager.sessions.get(sessionId);
    if (!sess) return 'idle';
    const status = sess.status;
    if (status === 'stopped') {
      if (!holdOnPause) return 'stopped';
      deadline = Date.now() + idleTimeoutS * 1000;
      await sleep(100);
      continue;
    }
    if (status === 'error') return 'error';
    if (status === 'completed') return 'idle';
    const task = agentManager.tasks.get(sessionId);
    if (task && task.done() && status !== 'running' && status !== 'waiting_approval') return 'idle';
    if (status === 'waiting_approval') {
      deadline = Date.now() + idleTimeoutS * 1000;
    } else {
      const msgs = sess.messages || [];
      const last = msgs[msgs.length - 1];
      const partialLen = (agentManager.livePartial.get(sessionId) as { text?: string } | undefined)?.text?.length ?? 0;
      const activityKey = `${msgs.length}|${last?.id ?? ''}|${last?.timestamp ?? ''}|${partialLen}`;
      if (activityKey !== lastActivityKey) {
        lastActivityKey = activityKey;
        deadline = Date.now() + idleTimeoutS * 1000;
      }
    }
    if (Date.now() > deadline) throw new Error(`No agent activity for ${idleTimeoutS}s on session ${sessionId}`);
    await sleep(50);
  }
}

export async function execute(wf: Workflow, options: ExecuteOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<WorkflowRun> {
  const triggeredBy = options.triggeredBy ?? 'schedule';
  const run = newWorkflowRun({
    workflow_id: wf.id,
    status: 'running',
    scheduled_for: options.scheduledFor ?? null,
    started_at: new Date().toISOString(),
    triggered_by: triggeredBy,
  });

  // Cost cap pre-check happens before claiming `running` so a capped workflow doesn't block its
  // own next fire. Still recorded so the user sees it in History with a clear reason.
  if (wf.cost_cap_usd_monthly !== null) {
    const spent = monthlySpendSoFar(wf, env);
    if (spent >= wf.cost_cap_usd_monthly) {
      run.status = 'skipped';
      run.error = `Monthly cost cap reached ($${spent.toFixed(2)} / $${wf.cost_cap_usd_monthly.toFixed(2)})`;
      run.finished_at = new Date().toISOString();
      storage.recordRun(run, env);
      persistRunFields(wf, { last_run_at: run.finished_at, last_run_status: 'skipped', last_run_id: run.id }, 0, env);
      return run;
    }
  }

  storage.recordRun(run, env);

  if (running.has(wf.id)) {
    run.status = 'skipped';
    run.error = 'Previous run still active';
    run.finished_at = new Date().toISOString();
    storage.recordRun(run, env);
    return run;
  }
  running.set(wf.id, run.id);

  let session: AgentSession | null = null;
  let watcher: WatcherHandle | null = null;
  try {
    wf.last_run_at = run.started_at;
    wf.last_run_status = 'running';
    wf.last_run_id = run.id;
    persistRunFields(wf, { last_run_at: run.started_at, last_run_status: 'running', last_run_id: run.id }, 0, env);

    try {
      await wsManager.broadcastGlobal('workflow:run', { workflow_id: wf.id, run });
    } catch {
      // Best-effort.
    }

    const steps = wf.steps.filter((s) => s.enabled && s.text && s.text.trim());
    if (steps.length === 0) throw new Error('Workflow has no steps');

    const resolvedAllowedTools = resolveAllowedTools(wf);
    const config: AgentConfig = {
      name: wf.title || 'Workflow',
      model: wf.model || 'sonnet',
      mode: wf.mode || 'agent',
      provider: wf.provider || 'anthropic',
      system_prompt: resolveSystemPrompt(wf),
      allowed_tools: resolvedAllowedTools ?? DEFAULT_ALLOWED_TOOLS,
      max_turns: null,
      target_directory: null,
      dashboard_id: resolveWorkflowDashboardId(wf, env),
      workflow_run_id: run.id,
      workflow_edit_id: null,
      selected_app_output_ids: null,
      initial_message: null,
    };

    session = await agentManager.launchAgent(config);
    run.session_id = session.id;
    runningSession.set(wf.id, session.id);
    storage.recordRun(run, env);

    setWorkflowApprovalMemory(session.id, {
      decisions: { ...wf.remembered_approvals },
      step_usage: Object.fromEntries(Object.entries(wf.step_tool_usage).map(([sid, tools]) => [sid, { ...tools }])),
      remember: makeRememberApproval(wf.id, env),
      ask_timeout_ms: (triggeredBy === 'schedule' ? 30.0 : 600.0) * 1000,
    });

    watcher = startToolCallWatcher(wf, run, session.id);

    let stepError: string | null = null;
    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      if (runControl.get(run.id) === 'stop') {
        stepError = 'Stopped by user';
        break;
      }
      const freshWf = storage.getWorkflow(wf.id, env);
      if (freshWf === null || freshWf.deleted_at !== null) {
        stepError = 'Workflow deleted';
        break;
      }
      if (triggeredBy === 'schedule' && !freshWf.schedule.enabled) {
        stepError = 'Workflow paused';
        break;
      }
      run.active_step_idx = idx;
      run.last_tool_label = null;
      run.paused = false;
      setWorkflowApprovalStep(session.id, step.id);
      try {
        await wsManager.broadcastGlobal('workflow:run', { workflow_id: wf.id, run });
      } catch {
        // Best-effort.
      }
      await agentManager.sendMessage(session.id, step.text);
      const disp = await awaitSessionIdle(session.id, run.id);
      if (disp === 'stopped') {
        stepError = 'Stopped by user';
        break;
      }
      if (disp === 'error') {
        stepError = 'Agent session entered error state';
        break;
      }
    }

    run.finished_at = new Date().toISOString();
    run.paused = false;
    const sessState = agentManager.sessions.get(session.id);
    if (sessState) run.cost_usd = sessState.cost_usd || 0;

    if (stepError !== null) {
      run.status = 'failure';
      run.error = stepError;
      wf.last_run_status = 'failure';
    } else if (options.scheduledFor && ranLate(run.started_at, options.scheduledFor)) {
      run.status = 'ran_late';
      wf.last_run_status = 'ran_late';
    } else {
      run.status = 'success';
      wf.last_run_status = 'success';
    }
    const runsDelta = triggeredBy === 'schedule' && (run.status === 'success' || run.status === 'ran_late' || run.status === 'failure') ? 1 : 0;
    storage.recordRun(run, env);
    wf.last_run_at = run.finished_at;
    const runFields: Partial<Workflow> = { last_run_at: run.finished_at, last_run_status: wf.last_run_status };
    if (triggeredBy === 'manual' && (run.status === 'success' || run.status === 'ran_late') && typeof options.testedSignature === 'string') {
      runFields.tested_signature = options.testedSignature;
    }
    persistRunFields(wf, runFields, runsDelta, env);
  } catch (e) {
    run.status = 'failure';
    run.error = String(e instanceof Error ? e.message : e).slice(0, 500);
    run.finished_at = new Date().toISOString();
    run.paused = false;
    storage.recordRun(run, env);
    wf.last_run_status = 'failure';
    persistRunFields(wf, { last_run_status: 'failure', last_run_at: run.finished_at }, 0, env);
  } finally {
    runControl.delete(run.id);
    runPauseOverride.delete(run.id);
    if (watcher) watcher.stopped = true;
    if (session !== null) {
      try {
        persistStepToolUsage(wf.id, getWorkflowStepUsage(session.id), null, env);
      } catch {
        // Best-effort.
      }
      setWorkflowApprovalStep(session.id, undefined);
      clearWorkflowApprovalMemory(session.id);
      try {
        await agentManager.closeSession(session.id);
      } catch {
        // Best-effort, mirrors the Python original's logged-and-continue.
      }
    }
    running.delete(wf.id);
    runningSession.delete(wf.id);
  }

  try {
    const notifier = await import('./notifier');
    await notifier.notifyRunComplete(wf, run);
  } catch {
    // Best-effort.
  }

  try {
    await wsManager.broadcastGlobal('workflow:run', { workflow_id: wf.id, run });
  } catch {
    // Best-effort.
  }

  return run;
}
