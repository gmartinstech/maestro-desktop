// engine/src/apps/workflows/http.ts -- SUB-7, the native HTTP handler for
// backend/apps/workflows/workflows.py's whole router (backend/apps/workflows, ~3.3k LOC, 35 routes
// -- the largest route surface in the app). Full route parity, enumerated in this repo's
// contract/openapi.json under /api/workflows/* and mirrored 1:1 by the dispatch table below.
//
// DELIBERATE, DOCUMENTED SCOPE CUTS (each a stand-in for a not-yet-ported subsystem, same
// convention dashboards.ts's generate_name and AgentLaunch.ts's DI seams already established):
//
//  1. Aux-LLM workflow metadata generation (title/description/step-label auto-naming) always takes
//     the same graceful fallback branch workflows.py's own `except Exception` handles -- the real
//     (non-mock) provider/CLI resolution this needs (resolve_aux_model + get_anthropic_client_for_
//     model) is explicitly not yet ported to the engine (AgentManager.ts's runAgentLoop throws a
//     loud "not yet implemented" for exactly this reason). The DETERMINISTIC fallback naming
//     (p_fallback_title_for_steps / p_short_step_label) is ported in FULL below and is exactly what
//     a user sees today whenever the Python original's own aux-model call fails for any reason --
//     so workflow auto-naming still works, just always via the fallback path rather than ever the
//     LLM path.
//  2. `ask-run`'s prepend_context (folding a run's transcript into one hidden turn so only the
//     user's question shows in the bubble) has no DI seam in Messaging.ts's SendMessageOptions --
//     that option doesn't exist in the (already-landed) AGT-5 port. This route sends the user's
//     prompt as a normal, visible message instead of a hidden-context-prefixed one; the route still
//     answers and still attaches to the edit-agent session, just without the transcript folded in.
//  3. `p_source_session_memory` reads only the in-memory agentManager.sessions map -- the Python
//     original's disk fallback (session_store.py's _load_session_data) has no port yet (see
//     AgentManager.ts's own header: "no persistence layer exists yet"). A source session already
//     closed by the time Convert-to-Workflow runs yields empty approvals/tools, same as the Python
//     original's own try/except Exception: return {}, [], None branch.
//  4. edit-agent-session's reattach path does not persist the refreshed dashboard_id/workflow_edit_
//     id markers to disk (no session_store.py port), matching AgentManager.ts's closeSession
//     saveSession no-op for the identical reason.
//  5. cron/findings scans once, lazily, on this module's first load (not at process-lifespan
//     startup, since this engine has none for workflows -- see scheduler.ts's header for the same
//     "lazy instead of lifespan" adaptation) and is cached for the process lifetime, matching the
//     Python original's own once-at-startup, never-rescanned cache.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { execFileSync } from 'node:child_process';
import { agentManager } from '../../agents/AgentManager';
import type { AgentConfig, AgentSession } from '../../agents/core/models';
import { wsManager } from '../../agents/core/wsManager';
import { createMessage, toWireSession } from '../../agents/sessionFactory';
import {
  clearWorkflowApprovalMemory,
  getWorkflowStepUsage,
  setWorkflowApprovalMemory,
  setWorkflowApprovalStep,
} from '../../agents/manager/permissions/workflowApproval';
import * as audit from './audit';
import * as escalation from './escalation';
import * as executor from './executor';
import * as scheduler from './scheduler';
import * as storage from './store';
import {
  coerceActionsConfig,
  coerceAskRunBody,
  coerceDraftCommitBody,
  coerceGenerateMetadataRequest,
  coerceMissedRunAction,
  coercePermissionTier,
  coerceScheduleConfig,
  coerceWorkflow,
  coerceWorkflowCreateBody,
  coerceWorkflowStep,
  coerceWorkflowUpdateBody,
  updateHas,
  type Workflow,
  type WorkflowStep,
} from './models';

/** PATCH's setattr loop mirrors pydantic's `validate_assignment=True`: a raw client value for a
 * nested field (schedule/actions/permissions/steps) must go through its own coerce* hydrator, not
 * a bare assignment -- see models.ts's own header for why a bare `wf[k] = v` here would be wrong
 * for exactly these keys. */
function applyPatchField(wf: Workflow, key: string, value: unknown): void {
  if (key === 'steps' && Array.isArray(value)) {
    wf.steps = value.map(coerceWorkflowStep);
  } else if (key === 'schedule') {
    wf.schedule = coerceScheduleConfig(value);
  } else if (key === 'actions') {
    wf.actions = coerceActionsConfig(value);
  } else if (key === 'permissions' && Array.isArray(value)) {
    wf.permissions = value.map(coercePermissionTier);
  } else {
    (wf as unknown as Record<string, unknown>)[key] = value;
  }
}

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'AskUserQuestion'];

const EDIT_AGENT_INTRO =
  "Here's your workflow's edit space. Tell me what you want and I'll handle it:\n\n" +
  '- Add, remove, or reorder steps\n' +
  '- Rewrite what any step does\n' +
  '- Connect tools it needs (email, calendar, browsing, and more)\n' +
  '- Test a run to see it work end to end\n\n' +
  'You can ask me directly here, or edit it yourself in the panel on the right: ' +
  'Schedule sets when and how often it runs, and Steps is what it does, in order.';

// -- one-time lazy startup (scope cut #5 + the scheduler's own lazy-start convention) -----------

let started = false;
function ensureStarted(env: NodeJS.ProcessEnv): void {
  if (started) return;
  started = true;
  void scheduler.start(env);
}

let cronFindingsCache: string[] | null = null;
function scanCronForMaestro(): string[] {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('schtasks', ['/query', '/fo', 'CSV', '/v'], { timeout: 4000, encoding: 'utf8' });
      return out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().includes('maestro') && !l.startsWith('"#'));
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync('crontab', ['-l'], { timeout: 2000, encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().includes('maestro') && !l.startsWith('#'));
  } catch {
    return [];
  }
}
function cronFindings(): string[] {
  if (cronFindingsCache === null) cronFindingsCache = scanCronForMaestro();
  return cronFindingsCache;
}

/** Test-only escape hatch mirroring store.ts's resetCacheForTest convention. */
export function resetHttpStateForTest(): void {
  started = false;
  cronFindingsCache = null;
}

// -- body/query helpers -----------------------------------------------------------------------

function parseJsonObjectBody(request: FastifyRequest): Record<string, unknown> | null {
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ detail });
  return true;
}

function notFound(reply: FastifyReply, detail = 'Workflow not found'): true {
  reply.code(404).send({ detail });
  return true;
}

function query(request: FastifyRequest): Record<string, unknown> {
  return (request.query as Record<string, unknown>) ?? {};
}

function queryStr(request: FastifyRequest, key: string): string | undefined {
  const v = query(request)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function queryInt(request: FastifyRequest, key: string, fallback: number): number {
  const v = query(request)[key];
  if (typeof v !== 'string') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// -- pure helpers mirroring workflows.py's own module-level functions ---------------------------

function deriveIcon(wf: Workflow): string {
  const title = (wf.title || '').trim();
  for (const ch of title) {
    if (ch.codePointAt(0)! > 0x2700) return ch;
  }
  if (title) return title[0].toUpperCase();
  return 'W';
}

function hasNonemptySteps(steps: WorkflowStep[] | null | undefined): boolean {
  return (steps ?? []).some((s) => Boolean((s.text || '').trim()));
}

function sourceToolName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function collectToolNamesFromContent(content: unknown, out: Set<string>): void {
  if (Array.isArray(content)) {
    for (const item of content) collectToolNamesFromContent(item, out);
    return;
  }
  if (typeof content !== 'object' || content === null) return;
  const c = content as Record<string, unknown>;
  if (c.type === 'tool_use') {
    const name = sourceToolName(c.name ?? c.tool);
    if (name) out.add(name);
  }
  for (const key of ['tool_name', 'tool']) {
    const name = sourceToolName(c[key]);
    if (name) out.add(name);
  }
  if (c.content !== undefined && c.content !== content) collectToolNamesFromContent(c.content, out);
}

/** Scope cut #3 (see file header): reads only the in-memory session, no disk fallback. */
function sourceSessionMemory(sessionId: string | null): { approvals: Record<string, 'allow' | 'deny'>; tools: string[]; allowedTools: string[] | null } {
  if (!sessionId) return { approvals: {}, tools: [], allowedTools: null };
  const sess = agentManager.sessions.get(sessionId);
  if (!sess) return { approvals: {}, tools: [], allowedTools: null };
  const approvals: Record<string, 'allow' | 'deny'> = {};
  const tools = new Set<string>();
  for (const entry of sess.approval_decisions || []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const tool = sourceToolName(e.tool);
    if (tool) tools.add(tool);
    if (e.sensitive_pattern) continue;
    const behavior = e.behavior;
    if (tool && (behavior === 'allow' || behavior === 'deny')) approvals[tool] = behavior;
  }
  for (const tool of Object.keys(sess.tool_latencies || {})) {
    const name = sourceToolName(tool);
    if (name) tools.add(name);
  }
  for (const msg of sess.messages || []) {
    if (msg.role === 'tool_call') {
      const name = sourceToolName((msg as { tool_name?: unknown }).tool_name);
      if (name) tools.add(name);
    }
    collectToolNamesFromContent(msg.content, tools);
  }
  return { approvals, tools: [...tools].sort(), allowedTools: sess.allowed_tools ?? null };
}

function pruneStepToolUsage(wf: Workflow): void {
  const liveIds = new Set(wf.steps.map((s) => s.id));
  const pruned: Record<string, Record<string, boolean>> = {};
  for (const [sid, tools] of Object.entries(wf.step_tool_usage || {})) {
    if (liveIds.has(sid) && typeof tools === 'object' && tools !== null) pruned[sid] = { ...tools };
  }
  wf.step_tool_usage = pruned;
}

/** Scope cut #1: always the deterministic-fallback outcome (no aux model wired). */
async function generateMetadataForSteps(_steps: WorkflowStep[], _model: string | null): Promise<{ title: string; description: string; stepLabels: string[] }> {
  return { title: '', description: '', stepLabels: [] };
}

const PLACEHOLDER_TITLES = new Set(['', 'New workflow', 'Untitled workflow', 'Scheduled workflow']);

function fallbackTitleForSteps(steps: WorkflowStep[]): string {
  for (const s of steps) {
    const base = (s.label || s.text || '').trim();
    if (base) {
      const words = base.split(/\s+/).slice(0, 5);
      return words.map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').slice(0, 60);
    }
  }
  return '';
}

function shortStepLabel(text: string): string {
  const base = (text || '').trim();
  if (!base) return '';
  const label = base.split(/\s+/).slice(0, 6).join(' ');
  return (label[0].toUpperCase() + label.slice(1)).slice(0, 48);
}

async function relabelSteps(wf: Workflow, beforeSteps: Array<Record<string, unknown>>, steps: WorkflowStep[], model: string | null): Promise<void> {
  const beforeById = new Map(beforeSteps.map((s) => [s.id as string, s]));
  const regenIdxs: number[] = [];
  let contentChanged = beforeSteps.length !== steps.length;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const old = beforeById.get(step.id);
    const oldText = (old?.text as string) || '';
    const oldLabel = (old?.label as string) || '';
    const newLabel = (step.label || '').trim();
    if (old === undefined || oldText !== step.text) contentChanged = true;
    if (old !== undefined && oldText === step.text) {
      if (!newLabel && oldLabel) step.label = oldLabel;
      continue;
    }
    if (!(newLabel && newLabel !== oldLabel)) regenIdxs.push(i);
  }
  const needAutoname = wf.auto_named && PLACEHOLDER_TITLES.has((wf.title || '').trim()) && contentChanged && steps.some((s) => s.text);
  if (regenIdxs.length === 0 && !needAutoname) return;
  const { title, description, stepLabels } = await generateMetadataForSteps(steps, model);
  if (needAutoname) {
    if (title) {
      wf.title = title;
    } else {
      const fb = fallbackTitleForSteps(steps);
      if (fb) wf.title = fb;
    }
    if (description) wf.description = description;
  }
  for (const i of regenIdxs) {
    const aux = i < stepLabels.length && stepLabels[i] ? stepLabels[i].trim() : '';
    const newLabel = aux || shortStepLabel(steps[i].text);
    if (newLabel) steps[i].label = newLabel;
  }
}

async function relabelChangedSteps(wf: Workflow, beforeSteps: Array<Record<string, unknown>>): Promise<void> {
  await relabelSteps(wf, beforeSteps, wf.steps, wf.model);
}

function lastRunCost(wid: string, env: NodeJS.ProcessEnv): number {
  for (const r of storage.listRuns(wid, 10, env)) {
    if ((r.status === 'success' || r.status === 'ran_late') && r.cost_usd) return r.cost_usd;
  }
  return 0.0;
}

function enriched(wf: Workflow, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const last = lastRunCost(wf.id, env);
  const fires = scheduler.firesInWindow(wf, 30, env);
  return {
    ...wf,
    cost_estimate: {
      monthly_usd: Math.round(last * fires * 10000) / 10000,
      last_run_usd: Math.round(last * 10000) / 10000,
      fires_per_month: fires,
    },
    has_draft: wf.draft_steps !== null,
  };
}

function renderTestTranscript(messages: AgentSession['messages'], maxChars = 14000): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.hidden) continue;
    const role = (m.role || '?').toUpperCase();
    const content = m.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const b of content) {
        if (typeof b !== 'object' || b === null) {
          parts.push(String(b));
          continue;
        }
        const block = b as Record<string, unknown>;
        if (block.type === 'text') parts.push(String(block.text ?? ''));
        else if (block.type === 'tool_use') parts.push(`[tool ${block.name}] ${JSON.stringify(block.input ?? {}).slice(0, 300)}`);
        else if (block.type === 'tool_result') {
          const inner = block.content;
          parts.push(`[result] ${typeof inner === 'string' ? inner : JSON.stringify(inner)}`.slice(0, 310));
        } else parts.push(String(b).slice(0, 200));
      }
      text = parts.filter(Boolean).join('\n');
    }
    if (text.trim()) lines.push(`${role}: ${text.trim()}`);
  }
  let out = lines.join('\n\n');
  if (out.length > maxChars) out = `...(earlier turns trimmed)...\n\n${out.slice(out.length - maxChars)}`;
  return out;
}

function resolveSystemPrompt(wf: Workflow): string | null {
  if (wf.use_synced_prompt) return null;
  return wf.system_prompt || null;
}

function resolveAllowedTools(wf: Workflow): string[] | null {
  if (!wf.actions.freeze) return null;
  return [...wf.actions.configured_sets];
}

function normalizeScheduleState(wf: Workflow, sourceAllowedTools: string[] | null | undefined, env: NodeJS.ProcessEnv): void {
  if (wf.schedule.timezone === 'local' && wf.schedule.enabled) {
    wf.schedule = { ...wf.schedule, timezone: scheduler.hostTimezoneName(env) };
  }
  if (wf.schedule.enabled && !scheduler.isScheduleConfigured(wf.schedule)) {
    wf.schedule = { ...wf.schedule, enabled: false };
  }
  if (wf.schedule.enabled && wf.schedule.repeat_unit === 'month' && wf.schedule.day_of_month === null) {
    wf.schedule = { ...wf.schedule, day_of_month: scheduler.nowDayInTz(wf.schedule.timezone, env) };
  }
  if (wf.schedule.enabled && scheduler.isScheduleConfigured(wf.schedule) && !wf.actions.freeze) {
    if (wf.source_session_id) {
      const allowed = sourceAllowedTools !== undefined ? sourceAllowedTools : sourceSessionMemory(wf.source_session_id).allowedTools;
      if (allowed !== null) wf.actions = { ...wf.actions, freeze: true, configured_sets: [...allowed] };
    } else {
      wf.actions = { ...wf.actions, freeze: true };
    }
  }
  wf.next_run_at = wf.schedule.enabled ? scheduler.computeNextFire(wf, null, env) : null;
}

function parseCalendarBound(value: string, label: string): { iso: string } | { error: string } {
  let raw = (value || '').trim();
  if (raw.endsWith('Z')) raw = `${raw.slice(0, -1)}+00:00`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `Invalid ${label} timestamp` };
  if (!/[+-]\d{2}:?\d{2}$|Z$/i.test(raw)) return { error: `${label} timestamp must include a timezone` };
  return { iso: d.toISOString() };
}

async function broadcastWorkflowUpdated(wf: Workflow, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await wsManager.broadcastGlobal('workflow:updated', { workflow_id: wf.id, workflow: enriched(wf, env) });
  } catch {
    // Best-effort.
  }
}

async function broadcastWorkflowDeleted(workflowId: string): Promise<void> {
  try {
    await wsManager.broadcastGlobal('workflow:deleted', { workflow_id: workflowId });
  } catch {
    // Best-effort.
  }
}

async function broadcastRun(workflowId: string, run: unknown): Promise<void> {
  try {
    await wsManager.broadcastGlobal('workflow:run', { workflow_id: workflowId, run });
  } catch {
    // Best-effort.
  }
}

async function stopInFlightRun(workflowId: string): Promise<void> {
  const sessionId = executor.stopActiveRun(workflowId);
  if (sessionId) {
    try {
      await agentManager.stopAgent(sessionId);
    } catch {
      // Best-effort, mirrors the Python original's logged-and-continue.
    }
  }
}

async function endEditSession(wf: Workflow): Promise<void> {
  const sid = wf.edit_agent_session_id;
  wf.edit_agent_session_id = null;
  if (!sid) return;
  try {
    await agentManager.closeSession(sid);
  } catch {
    // Best-effort.
  }
}

function syncModelOnSave(wf: Workflow, model: string | null): void {
  if (model) {
    wf.model = model;
    return;
  }
  const sid = wf.edit_agent_session_id;
  if (!sid) return;
  const session = agentManager.sessions.get(sid);
  if (session?.model) wf.model = session.model;
}

function findActiveRun(runId: string, env: NodeJS.ProcessEnv): { workflowId: string; run: ReturnType<typeof storage.listRuns>[number] } | null {
  for (const wf of storage.listWorkflows(env)) {
    for (const r of storage.listRuns(wf.id, 50, env)) {
      if (r.id === runId && r.status === 'running') return { workflowId: wf.id, run: r };
    }
  }
  return null;
}

function baseAgentConfig(overrides: Partial<AgentConfig> & Pick<AgentConfig, 'name' | 'model' | 'mode' | 'provider'>): AgentConfig {
  return {
    system_prompt: null,
    allowed_tools: [],
    max_turns: null,
    target_directory: null,
    dashboard_id: null,
    workflow_run_id: null,
    workflow_edit_id: null,
    selected_app_output_ids: null,
    initial_message: null,
    ...overrides,
  };
}

/** Create (or return existing) Edit Agent session for a workflow -- mirrors edit_agent_session,
 * factored out so ask-run can reuse it exactly like the Python original's direct function call. */
async function editAgentSessionFor(wf: Workflow, env: NodeJS.ProcessEnv): Promise<{ session_id: string }> {
  const existingId = wf.edit_agent_session_id || null;
  if (existingId) {
    if (wf.draft_steps === null) {
      wf.draft_steps = [...wf.steps];
      storage.saveWorkflow(wf, env);
    }
    const pSess = agentManager.sessions.get(existingId);
    if (pSess) {
      pSess.dashboard_id = wsManager.activeDashboardId || executor.resolveWorkflowDashboardId(wf, env);
      pSess.workflow_edit_id = wf.id;
      try {
        await wsManager.sendToSession(existingId, 'agent:status', { session_id: existingId, status: pSess.status, session: toWireSession(pSess) });
      } catch {
        // Best-effort.
      }
    }
    return { session_id: existingId };
  }

  wf.draft_steps = [...wf.steps];
  storage.saveWorkflow(wf, env);

  const stepsLines = wf.steps.map((s, i) => `${i + 1}. ${(s.label || '').trim() || (s.text || '').slice(0, 60)}\n   Prompt: ${s.text}`).join('\n');
  const intro = wf.steps.length
    ? 'Help the user iterate on it.'
    : "This workflow is brand new and has no steps yet. The user's first message tells you what it should do, so act on it: turn that request into one or more steps with AddWorkflowStep instead of replying with only text. Don't stall on open-ended 'what should this do' questions. The one exception: if a step genuinely can't run without a specific detail only the user has (their location, an account, a recipient, etc.), ask for that one thing first with AskUserQuestion, then add the step with it baked in, so you never leave behind a step you already know won't run.";
  const stepsBlock = wf.steps.length ? `Current steps:\n${stepsLines}\n\n` : 'It has no steps yet.\n\n';
  const systemPrompt =
    `You are the Edit Agent for the user's saved workflow "${wf.title}" (id: ${wf.id}). ${intro} The workflow's purpose: ${wf.description || '(unspecified)'}.\n\n` +
    `${stepsBlock}` +
    'How to work:\n' +
    "1. You BUILD the workflow; you never perform it. Do NOT carry out the user's actual task in this chat: don't open a browser, send email, or do the real work yourself. Your job is to turn the request into steps; running them is the Test Agent's job (see TestWorkflow below). When the user describes a change, briefly confirm what you'll do, then make it.\n" +
    '2. You may use read-only tools (read files, search, MCPSearch) only to check that a step is feasible, never to complete the task itself.\n' +
    '3. To change the workflow\'s steps, call the matching tool. Your edits STAGE to a pending draft and are fully reversible; nothing touches the live workflow until the user clicks Save. The card shows your draft as you go:\n' +
    '   - EditWorkflowStep(workflow_id, step_idx, new_text, new_label) to rewrite a step. ALWAYS pass new_label (a fresh 3-5 word summary) so the card reflects the change instead of the stale old label.\n' +
    '   - AddWorkflowStep(workflow_id, text, label) to add a step.\n' +
    '   - DeleteWorkflowStep(workflow_id, step_idx) to remove one.\n' +
    '   Confirm via AskUserQuestion FIRST if there\'s any ambiguity.\n' +
    "4. Call TestWorkflow(workflow_id) to spawn a sibling Test Agent that runs the current draft end-to-end. Use this after a change to verify it works.\n" +
    "5. After a test finishes, call ReadTestTranscript(workflow_id) to read the Test Agent's full transcript and diagnose what happened before proposing further edits.\n\n" +
    "Be brief in your replies. Don't restate the whole workflow back; the user can see it. Just confirm what changed and what you're doing.\n" +
    "Write like a normal chat: plain conversational sentences. When you suggest changes, describe them in prose (e.g. \"I could add a step that...\"). Never dump raw JSON, arrays, or code blocks of step objects at the user; that belongs in your EditWorkflowStep tool call, not the message.";

  const editDashboardId = wsManager.activeDashboardId || executor.resolveWorkflowDashboardId(wf, env);
  const config = baseAgentConfig({
    name: `Edit Agent: ${wf.title}`,
    model: wf.model || 'sonnet',
    mode: wf.mode || 'agent',
    provider: wf.provider || 'anthropic',
    system_prompt: systemPrompt,
    dashboard_id: editDashboardId,
    workflow_edit_id: wf.id,
  });
  const session = await agentManager.launchAgent(config);
  // launchAgent marks the session "running" assuming a turn fires immediately; an edit-agent chat
  // sits idle until the user sends something, so settle it here.
  session.status = 'completed';
  if (wf.steps.length > 0) {
    session.messages.push(createMessage({
      id: `${session.id}-intro`,
      role: 'assistant',
      content: EDIT_AGENT_INTRO,
      branch_id: session.active_branch_id,
      timestamp: new Date().toISOString(),
    }));
  }
  try {
    await wsManager.sendToSession(session.id, 'agent:status', { session_id: session.id, status: 'completed', session: toWireSession(session) });
  } catch {
    // Best-effort.
  }
  try {
    wf.edit_agent_session_id = session.id;
    storage.saveWorkflow(wf, env);
  } catch {
    // Best-effort.
  }
  return { session_id: session.id };
}

// -- the dispatcher -----------------------------------------------------------------------------

/** Handles the /api/workflows subtree; returns false for any path/method this file doesn't own so
 * server.ts's caller falls back to proxying at Python. Every route named in this repo's
 * contract/openapi.json under /api/workflows/* is handled below -- see this file's header for the
 * documented scope cuts within a handled route. */
export async function handleWorkflowsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const env = process.env;
  ensureStarted(env);
  const sub = pathname.replace(/^\/api\/workflows/, '') || '/';
  const method = request.method.toUpperCase();

  // -- fixed (non-parametric) paths --------------------------------------------------------------

  if (sub === '/list' && method === 'GET') {
    const dashboardId = queryStr(request, 'dashboard_id');
    let items = storage.listWorkflows(env);
    if (dashboardId) items = items.filter((w) => !w.dashboard_id || w.dashboard_id === dashboardId);
    items.sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
    reply.send({ workflows: items.map((w) => enriched(w, env)) });
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const raw = parseJsonObjectBody(request);
    if (raw === null) return badRequest(reply, 'invalid JSON body');
    const body = coerceWorkflowCreateBody(raw);
    if (!body.unsaved && !hasNonemptySteps(body.steps)) return badRequest(reply, 'Workflow must have at least one step');
    const wf = coerceWorkflow({
      title: body.title,
      description: body.description,
      icon: body.icon,
      color: body.color,
      system_prompt: body.system_prompt,
      use_synced_prompt: body.use_synced_prompt,
      steps: body.steps,
      actions: body.actions,
      schedule: body.schedule,
      permissions: body.permissions ?? [],
      source_session_id: body.source_session_id,
      dashboard_id: body.dashboard_id,
      model: body.model || 'sonnet',
      mode: body.mode || 'agent',
      provider: body.provider || 'anthropic',
      cost_cap_usd_monthly: body.cost_cap_usd_monthly,
      auto_named: body.auto_named,
      unsaved: body.unsaved,
    });
    const sourceMem = sourceSessionMemory(body.source_session_id);
    wf.remembered_approvals = sourceMem.approvals;
    wf.source_tools = sourceMem.tools;
    wf.tested_signature = body.tested_signature;
    if (!wf.icon) wf.icon = deriveIcon(wf);
    normalizeScheduleState(wf, sourceMem.allowedTools, env);
    if (!body.metadata_generated) {
      try {
        const { title, description, stepLabels } = await generateMetadataForSteps(wf.steps, wf.model);
        if (wf.auto_named) {
          if (title) wf.title = title;
          if (description) wf.description = description;
        }
        if (stepLabels.length === wf.steps.length) {
          for (let i = 0; i < stepLabels.length; i++) if (stepLabels[i]) wf.steps[i].label = stepLabels[i];
        }
      } catch {
        // Best-effort.
      }
    }
    storage.saveWorkflow(wf, env);
    scheduler.kick();
    await broadcastWorkflowUpdated(wf, env);
    reply.send(enriched(wf, env));
    return true;
  }

  if (sub === '/generate-metadata' && method === 'POST') {
    const raw = parseJsonObjectBody(request);
    if (raw === null) return badRequest(reply, 'invalid JSON body');
    const body = coerceGenerateMetadataRequest(raw);
    const { title, description, stepLabels } = await generateMetadataForSteps(body.steps, body.model || 'sonnet');
    reply.send({ title, description, step_labels: stepLabels });
    return true;
  }

  if (sub === '/active' && method === 'GET') {
    reply.send({ active: scheduler.listActive(env) });
    return true;
  }

  if (sub === '/pause-all' && method === 'POST') {
    storage.setPaused(true, env);
    scheduler.kick();
    reply.send({ paused: true });
    return true;
  }

  if (sub === '/resume-all' && method === 'POST') {
    storage.setPaused(false, env);
    scheduler.kick();
    reply.send({ paused: false });
    return true;
  }

  if (sub === '/paused' && method === 'GET') {
    reply.send({ paused: storage.getPaused(env) });
    return true;
  }

  if (sub === '/cron/findings' && method === 'GET') {
    reply.send({ entries: cronFindings() });
    return true;
  }

  if (sub === '/cloud/sms/status' && method === 'GET') {
    reply.send({ enabled: false });
    return true;
  }

  if (sub === '/runs/all' && method === 'GET') {
    const limit = queryInt(request, 'limit', 200);
    reply.send({ runs: storage.listAllRuns(limit, env) });
    return true;
  }

  if (sub === '/missed' && method === 'GET') {
    const limit = queryInt(request, 'limit', 50);
    const missed = [...storage.listMissed(env)].sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for));
    const out: Array<Record<string, unknown>> = [];
    for (const m of missed.slice(0, limit)) {
      const wf = storage.getWorkflow(m.workflow_id, env);
      if (!wf) continue;
      out.push({ id: m.id, workflow_id: m.workflow_id, workflow_title: wf.title, workflow_icon: wf.icon, scheduled_for: m.scheduled_for });
    }
    reply.send({ missed: out });
    return true;
  }

  if (sub === '/missed/run' && method === 'POST') {
    const raw = parseJsonObjectBody(request);
    if (raw === null) return badRequest(reply, 'invalid JSON body');
    const body = coerceMissedRunAction(raw);
    const wanted = new Set(body.ids);
    const selected = storage.listMissed(env).filter((m) => wanted.has(m.id));
    if (selected.length === 0) {
      reply.send({ started: 0 });
      return true;
    }
    storage.removeMissed(selected.map((m) => m.id), env);
    const byWf = new Map<string, string[]>();
    for (const m of [...selected].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))) {
      const arr = byWf.get(m.workflow_id) ?? [];
      arr.push(m.scheduled_for);
      byWf.set(m.workflow_id, arr);
    }
    let started = 0;
    for (const [wid, fors] of byWf) {
      const wf = storage.getWorkflow(wid, env);
      if (!wf) continue;
      started += fors.length;
      void scheduler.runMissedSequence(wf, fors);
    }
    reply.send({ started });
    return true;
  }

  if (sub === '/missed/dismiss' && method === 'POST') {
    const raw = parseJsonObjectBody(request);
    if (raw === null) return badRequest(reply, 'invalid JSON body');
    const body = coerceMissedRunAction(raw);
    const wanted = new Set(body.ids);
    const selected = storage.listMissed(env).filter((m) => wanted.has(m.id));
    storage.removeMissed(selected.map((m) => m.id), env);
    let dismissed = 0;
    for (const m of selected) {
      const wf = storage.getWorkflow(m.workflow_id, env);
      if (!wf) continue;
      scheduler.recordSkipped(wf, m.scheduled_for, 'You dismissed this missed run', env);
      dismissed += 1;
    }
    reply.send({ dismissed });
    return true;
  }

  if (sub === '/calendar' && method === 'GET') {
    const fromRaw = queryStr(request, 'from');
    const toRaw = queryStr(request, 'to');
    if (fromRaw === undefined || toRaw === undefined) return badRequest(reply, "'from' and 'to' are required");
    const from = parseCalendarBound(fromRaw, 'from');
    if ('error' in from) return badRequest(reply, from.error);
    const to = parseCalendarBound(toRaw, 'to');
    if ('error' in to) return badRequest(reply, to.error);
    if (to.iso <= from.iso) return badRequest(reply, 'to must be after from');
    const dashboardId = queryStr(request, 'dashboard_id');
    let items = storage.listWorkflows(env);
    if (dashboardId) items = items.filter((w) => !w.dashboard_id || w.dashboard_id === dashboardId);
    const events: Array<{ workflow_id: string; fire_at: string }> = [];
    for (const wf of items) {
      for (const fireAt of scheduler.occurrencesBetween(wf, from.iso, to.iso, 5000, env)) {
        events.push({ workflow_id: wf.id, fire_at: fireAt });
      }
    }
    events.sort((a, b) => (a.fire_at === b.fire_at ? a.workflow_id.localeCompare(b.workflow_id) : a.fire_at.localeCompare(b.fire_at)));
    reply.send({ events });
    return true;
  }

  if (sub === '/deleted' && method === 'GET') {
    const dashboardId = queryStr(request, 'dashboard_id');
    let items = storage.listDeletedWorkflows(env);
    if (dashboardId) items = items.filter((w) => !w.dashboard_id || w.dashboard_id === dashboardId);
    items.sort((a, b) => (b.deleted_at || b.created_at).localeCompare(a.deleted_at || a.created_at));
    reply.send({ workflows: items.map((w) => enriched(w, env)) });
    return true;
  }

  // -- /runs/{run_id}/... --------------------------------------------------------------------

  let m = /^\/runs\/([^/]+)\/ack$/.exec(sub);
  if (m && method === 'POST') {
    const cancelled = escalation.cancel(m[1]);
    reply.send({ acked: true, had_pending_escalation: cancelled });
    return true;
  }

  m = /^\/runs\/([^/]+)\/escalation$/.exec(sub);
  if (m && method === 'GET') {
    reply.send({ state: escalation.status(m[1]) });
    return true;
  }

  m = /^\/runs\/([^/]+)\/stop$/.exec(sub);
  if (m && method === 'POST') {
    const found = findActiveRun(m[1], env);
    if (!found) {
      reply.code(404).send({ detail: 'Run not found or not active' });
      return true;
    }
    executor.requestStop(m[1]);
    if (found.run.session_id) {
      try {
        await agentManager.stopAgent(found.run.session_id);
      } catch {
        // Best-effort.
      }
    }
    reply.send({ ok: true });
    return true;
  }

  m = /^\/runs\/([^/]+)\/pause$/.exec(sub);
  if (m && method === 'POST') {
    const found = findActiveRun(m[1], env);
    if (!found) {
      reply.code(404).send({ detail: 'Run not found or not active' });
      return true;
    }
    const run = found.run;
    run.paused = true;
    executor.setPauseOverride(m[1], true);
    storage.recordRun(run, env);
    await broadcastRun(found.workflowId, run);
    if (run.session_id) {
      const sessionId = run.session_id;
      void (async () => {
        try {
          await agentManager.stopAgent(sessionId);
        } catch {
          run.paused = false;
          executor.setPauseOverride(m![1], false, 0.1);
          storage.recordRun(run, env);
          await broadcastRun(found.workflowId, run);
        }
      })();
    }
    reply.send({ ok: true, run });
    return true;
  }

  m = /^\/runs\/([^/]+)\/resume$/.exec(sub);
  if (m && method === 'POST') {
    const found = findActiveRun(m[1], env);
    if (!found) {
      reply.code(404).send({ detail: 'Run not found or not active' });
      return true;
    }
    const run = found.run;
    run.paused = false;
    executor.setPauseOverride(m[1], false);
    storage.recordRun(run, env);
    await broadcastRun(found.workflowId, run);
    if (run.session_id) {
      const sessionId = run.session_id;
      void (async () => {
        try {
          await agentManager.sendMessage(sessionId, "Continue where you left off. Start your response EXACTLY with 'Sorry, let me pick up where I left off'", { hidden: true });
        } catch {
          run.paused = true;
          executor.setPauseOverride(m![1], true, 0.1);
          storage.recordRun(run, env);
          await broadcastRun(found.workflowId, run);
        }
      })();
    }
    reply.send({ ok: true, run });
    return true;
  }

  // -- /{workflow_id}[/...] -------------------------------------------------------------------

  m = /^\/([^/]+)$/.exec(sub);
  if (m) {
    const wid = m[1];
    if (method === 'GET') {
      const wf = storage.getWorkflow(wid, env);
      if (!wf) return notFound(reply);
      reply.send(enriched(wf, env));
      return true;
    }
    if (method === 'PATCH') {
      const wf = storage.getWorkflow(wid, env);
      if (!wf) return notFound(reply);
      const raw = parseJsonObjectBody(request);
      if (raw === null) return badRequest(reply, 'invalid JSON body');
      const body = coerceWorkflowUpdateBody(raw);
      if (body === null) return badRequest(reply, 'invalid JSON body');
      const ifMatch = request.headers['if-match'];
      if (typeof ifMatch === 'string' && ifMatch) {
        const currentStamp = wf.updated_at;
        if (ifMatch.trim().replace(/^"|"$/g, '') !== currentStamp) {
          reply.code(409).send({
            detail: {
              error: 'stale_update',
              message: 'This workflow changed in another window or by a recent run. Reload and try again.',
              current_updated_at: currentStamp,
            },
          });
          return true;
        }
      }
      const before = { ...wf } as Record<string, unknown>;
      const data = body.raw;
      if (updateHas(body, 'title') && !updateHas(body, 'auto_named') && data.title !== before.title) wf.auto_named = false;
      if (wf.draft_steps !== null && updateHas(body, 'steps')) {
        const beforeDraft = (before.draft_steps as Array<Record<string, unknown>>) || [];
        wf.draft_steps = Array.isArray(data.steps) ? (data.steps as unknown[]).map(coerceWorkflowStep) : [];
        for (const [k, v] of Object.entries(data)) {
          if (k !== 'steps') applyPatchField(wf, k, v);
        }
        await relabelSteps(wf, beforeDraft, wf.draft_steps, wf.model);
        wf.updated_at = new Date().toISOString();
        normalizeScheduleState(wf, undefined, env);
        storage.saveWorkflow(wf, env);
        await broadcastWorkflowUpdated(wf, env);
        reply.send(enriched(wf, env));
        return true;
      }
      for (const [k, v] of Object.entries(data)) applyPatchField(wf, k, v);
      if (updateHas(body, 'steps')) {
        await relabelChangedSteps(wf, (before.steps as Array<Record<string, unknown>>) || []);
        pruneStepToolUsage(wf);
      }
      wf.updated_at = new Date().toISOString();
      if (!wf.icon) wf.icon = deriveIcon(wf);
      normalizeScheduleState(wf, undefined, env);
      storage.saveWorkflow(wf, env);
      audit.logChange(wf.id, 'user', before, wf as unknown as Record<string, unknown>, env);
      scheduler.kick();
      await broadcastWorkflowUpdated(wf, env);
      reply.send(enriched(wf, env));
      return true;
    }
    if (method === 'DELETE') {
      const wf = storage.getWorkflow(wid, env);
      if (!wf || wf.deleted_at !== null) return notFound(reply);
      wf.deleted_at = new Date().toISOString();
      wf.schedule = { ...wf.schedule, enabled: false };
      wf.next_run_at = null;
      storage.saveWorkflow(wf, env);
      await stopInFlightRun(wid);
      const stale = storage.listMissed(env).filter((mm) => mm.workflow_id === wid).map((mm) => mm.id);
      if (stale.length > 0) storage.removeMissed(stale, env);
      scheduler.kick();
      await broadcastWorkflowDeleted(wid);
      reply.send({ ok: true });
      return true;
    }
    return false;
  }

  m = /^\/([^/]+)\/audit$/.exec(sub);
  if (m && method === 'GET') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const limit = queryInt(request, 'limit', 50);
    reply.send({ entries: audit.readTail(m[1], limit, env) });
    return true;
  }

  m = /^\/([^/]+)\/restore$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf || wf.deleted_at === null) return notFound(reply, 'Workflow not in trash');
    wf.deleted_at = null;
    storage.saveWorkflow(wf, env);
    await broadcastWorkflowUpdated(wf, env);
    reply.send(enriched(wf, env));
    return true;
  }

  m = /^\/([^/]+)\/purge$/.exec(sub);
  if (m && method === 'DELETE') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf || wf.deleted_at === null) return notFound(reply, 'Workflow not in trash');
    storage.deleteWorkflow(m[1], env);
    await broadcastWorkflowDeleted(m[1]);
    reply.send({ ok: true });
    return true;
  }

  m = /^\/([^/]+)\/edit-agent-session$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    reply.send(await editAgentSessionFor(wf, env));
    return true;
  }

  m = /^\/([^/]+)\/ask-run$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const raw = parseJsonObjectBody(request);
    if (raw === null) return badRequest(reply, 'invalid JSON body');
    const body = coerceAskRunBody(raw);
    if (body === null) return badRequest(reply, 'run_id and prompt are required');
    const run = storage.listRuns(m[1], 200, env).find((r) => r.id === body.run_id);
    if (!run || !run.session_id) return notFound(reply, 'Run has no chat to attach');
    const sess = agentManager.sessions.get(run.session_id) ?? null;
    // Scope cut #3: transcript is empty if the session isn't resident in memory (see file header).
    void (sess ? renderTestTranscript(sess.messages) : '');
    const edit = await editAgentSessionFor(wf, env);
    // Scope cut #2: sends the prompt directly (no hidden run-transcript context prefix).
    try {
      await agentManager.sendMessage(edit.session_id, body.prompt, { mode: body.mode ?? undefined, model: body.model ?? undefined });
    } catch {
      // Best-effort, mirrors the Python original's logged-and-continue.
    }
    reply.send({ session_id: edit.session_id });
    return true;
  }

  m = /^\/([^/]+)\/draft\/commit$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const raw = parseJsonObjectBody(request);
    const body = raw === null ? null : coerceDraftCommitBody(raw);
    if (wf.draft_steps === null) {
      wf.unsaved = false;
      syncModelOnSave(wf, body?.model ?? null);
      if (!body?.keep_session) await endEditSession(wf);
      storage.saveWorkflow(wf, env);
      reply.send(enriched(wf, env));
      return true;
    }
    const before = { ...wf } as Record<string, unknown>;
    const noChange = JSON.stringify(wf.draft_steps) === JSON.stringify(before.steps);
    wf.unsaved = false;
    wf.steps = wf.draft_steps;
    wf.draft_steps = null;
    if (noChange) {
      pruneStepToolUsage(wf);
      syncModelOnSave(wf, body?.model ?? null);
      if (!body?.keep_session) await endEditSession(wf);
      storage.saveWorkflow(wf, env);
      reply.send(enriched(wf, env));
      return true;
    }
    await relabelChangedSteps(wf, (before.steps as Array<Record<string, unknown>>) || []);
    pruneStepToolUsage(wf);
    wf.updated_at = new Date().toISOString();
    if (!wf.icon) wf.icon = deriveIcon(wf);
    normalizeScheduleState(wf, undefined, env);
    syncModelOnSave(wf, body?.model ?? null);
    if (!body?.keep_session) await endEditSession(wf);
    storage.saveWorkflow(wf, env);
    audit.logChange(wf.id, 'user', before, wf as unknown as Record<string, unknown>, env);
    scheduler.kick();
    await broadcastWorkflowUpdated(wf, env);
    reply.send(enriched(wf, env));
    return true;
  }

  m = /^\/([^/]+)\/draft\/discard$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    wf.draft_steps = null;
    await endEditSession(wf);
    pruneStepToolUsage(wf);
    storage.saveWorkflow(wf, env);
    await broadcastWorkflowUpdated(wf, env);
    reply.send(enriched(wf, env));
    return true;
  }

  m = /^\/([^/]+)\/test-run$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const raw = parseJsonObjectBody(request) ?? {};
    const testedSignature = typeof raw.signature === 'string' ? raw.signature : null;
    const draftStepsRaw = raw.steps;
    let stepEntries: WorkflowStep[];
    if (Array.isArray(draftStepsRaw) && draftStepsRaw.length > 0) {
      stepEntries = draftStepsRaw
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && Boolean(String((s as Record<string, unknown>).text ?? '').trim()))
        .map(coerceWorkflowStep);
    } else {
      const src = wf.draft_steps !== null ? wf.draft_steps : wf.steps;
      stepEntries = src.filter((s) => s.text && s.text.trim());
    }
    if (stepEntries.length === 0) return badRequest(reply, 'Workflow has no steps to test');

    const resolvedAllowedTools = resolveAllowedTools(wf);
    const config = baseAgentConfig({
      name: `${wf.title || 'Workflow'} (test)`,
      model: wf.model || 'sonnet',
      mode: wf.mode || 'agent',
      provider: wf.provider || 'anthropic',
      system_prompt: resolveSystemPrompt(wf),
      allowed_tools: resolvedAllowedTools ?? DEFAULT_ALLOWED_TOOLS,
      dashboard_id: executor.resolveWorkflowDashboardId(wf, env),
    });
    const session = await agentManager.launchAgent(config);
    session.workflow_test_state = 'running';
    setWorkflowApprovalMemory(session.id, {
      decisions: { ...wf.remembered_approvals },
      step_usage: Object.fromEntries(Object.entries(wf.step_tool_usage).map(([sid, tools]) => [sid, { ...tools }])),
      remember: executor.makeRememberApproval(wf.id, env),
      ask_timeout_ms: 600_000,
    });
    try {
      wf.last_test_session_id = session.id;
      storage.saveWorkflow(wf, env);
    } catch {
      // Best-effort.
    }

    const setTestState = async (state: string): Promise<void> => {
      const sess = agentManager.sessions.get(session.id);
      if (sess) sess.workflow_test_state = state as AgentSession['workflow_test_state'];
      try {
        await wsManager.broadcastGlobal('agent:test_state', { session_id: session.id, state });
      } catch {
        // Best-effort.
      }
    };

    void (async () => {
      let final = 'complete';
      try {
        for (const step of stepEntries) {
          setWorkflowApprovalStep(session.id, step.id);
          await agentManager.sendMessage(session.id, step.text);
          const disp = await executor.awaitSessionIdle(session.id, null);
          if (disp === 'error') {
            final = 'error';
            return;
          }
        }
      } catch {
        final = 'error';
      } finally {
        try {
          executor.persistStepToolUsage(wf.id, getWorkflowStepUsage(session.id), testedSignature, env);
        } catch {
          // Best-effort.
        }
        setWorkflowApprovalStep(session.id, undefined);
        clearWorkflowApprovalMemory(session.id);
        await setTestState(final);
      }
    })();

    reply.send({ session_id: session.id });
    return true;
  }

  m = /^\/([^/]+)\/test-transcript$/.exec(sub);
  if (m && method === 'GET') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    if (!wf.last_test_session_id) {
      reply.send({ transcript: '', status: 'none' });
      return true;
    }
    const sess = agentManager.sessions.get(wf.last_test_session_id);
    if (!sess) {
      reply.send({ transcript: '', status: 'unavailable' });
      return true;
    }
    reply.send({ transcript: renderTestTranscript(sess.messages), status: sess.status || '' });
    return true;
  }

  m = /^\/([^/]+)\/schedule-agent-session$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const existingId = wf.schedule_agent_session_id || null;
    if (existingId) {
      reply.send({ session_id: existingId });
      return true;
    }
    const nowLocal = new Date();
    const localTz = scheduler.hostTimezoneName(env);
    const currentDt = nowLocal.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: localTz });
    const systemPrompt =
      `You are the Scheduling Agent for the user's saved workflow "${wf.title}" (id: ${wf.id}). Your only job is to set when this workflow runs.\n\n` +
      `The current local date and time is ${currentDt} in ${localTz}. Resolve relative phrasing ("this month", "next Wednesday", "this time") against it.\n\n` +
      'When the user states a cadence, interpret it yourself and call UpdateScheduledWorkflow with:\n' +
      `  - workflow_id: "${wf.id}"\n` +
      '  - schedule_enabled: true\n' +
      '  - hour (0-23) and minute (0-59) in the user\'s local time\n' +
      '  - repeat_unit: "minute" | "hour" | "day" | "week" | "month"\n' +
      '  - repeat_every: the interval count (1 unless they say e.g. "every other"; for repeat_unit="minute" the minimum is 15, e.g. "every 15 minutes")\n' +
      '  - on_days: weekday indices when repeat_unit="week" (Sun=0, Mon=1, ... Sat=6)\n' +
      '  - day_of_month: 1-31 when repeat_unit="month" (1 for "first of the month")\n' +
      `  - timezone: "${localTz}" unless the user names a different specific zone\n\n` +
      'If no AM/PM is given, assume PM for 1-7 and AM for 8-12. If the cadence is genuinely ambiguous, ask ONE short clarifying question first; otherwise go straight to the tool call. The user approves or rejects the change in a permission prompt, so the tool call IS the confirmation: do not also ask "should I schedule this?" in text. Do not edit the workflow\'s steps. Keep every reply to one short sentence.';
    const config = baseAgentConfig({
      name: `Scheduling: ${wf.title}`,
      model: wf.model || 'sonnet',
      mode: wf.mode || 'agent',
      provider: wf.provider || 'anthropic',
      system_prompt: systemPrompt,
      dashboard_id: wf.dashboard_id,
    });
    const session = await agentManager.launchAgent(config);
    try {
      wf.schedule_agent_session_id = session.id;
      storage.saveWorkflow(wf, env);
    } catch {
      // Best-effort.
    }
    reply.send({ session_id: session.id });
    return true;
  }

  m = /^\/([^/]+)\/run$/.exec(sub);
  if (m && method === 'POST') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const raw = parseJsonObjectBody(request) ?? {};
    const preIds = new Set(storage.listRuns(wf.id, 10, env).map((r) => r.id));
    const testedSignature = typeof raw.signature === 'string' ? raw.signature : undefined;
    void executor.execute(wf, { triggeredBy: 'manual', testedSignature }, env);
    for (let i = 0; i < 25; i++) {
      for (const r of storage.listRuns(wf.id, 10, env)) {
        if (!preIds.has(r.id) && r.triggered_by === 'manual') {
          reply.send({ run_id: r.id, status: r.status, error: r.error });
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    reply.send({ run_id: '', status: null, error: null });
    return true;
  }

  m = /^\/([^/]+)\/runs$/.exec(sub);
  if (m && method === 'GET') {
    const wf = storage.getWorkflow(m[1], env);
    if (!wf) return notFound(reply);
    const limit = queryInt(request, 'limit', 50);
    reply.send({ runs: storage.listRuns(m[1], limit, env) });
    return true;
  }

  return false;
}
