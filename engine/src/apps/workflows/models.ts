// engine/src/apps/workflows/models.ts -- SUB-7, a field-for-field TypeScript port of
// backend/apps/workflows/models.py's pydantic models.
//
// Pydantic's `validate_assignment=True` on Workflow (load-bearing per that file's own comment: the
// PATCH /workflows/{id} path setattr's raw dict values straight onto the cached instance) has no
// direct TS equivalent -- there is no runtime coercion on `wf.schedule = x`. This port's answer is
// the same one dashboards/models.ts and dashboardLayout/models.ts already established: every
// write path goes through an explicit `coerce*` hydrator (coerceScheduleConfig/coerceActionsConfig/
// coerceWorkflowStep/coercePermissionTier) instead of a bare assignment, so a raw JSON blob from a
// PATCH body or an on-disk file is always normalized the same way pydantic would have normalized
// it on construction. One deliberate, documented divergence: pydantic's `Field(ge=1)` etc. REJECT
// (422) an out-of-range raw value before the model_validator's clamp ever runs; this port instead
// clamps at the same points the Python model_validator already clamps, and additionally clamps
// (rather than 422s) the plain Field bounds too. Building a general nested-model 422-on-invalid-
// literal framework for every numeric field here is out of scope for this ticket and not exercised
// by the frontend (which clamps client-side per this file's own header comment in the original) --
// documented divergence, not a parity gap in any tested path.

export type PermissionTierKind = 'notify' | 'text' | 'call';

export interface PermissionTier {
  kind: PermissionTierKind;
  after_minutes: number;
  phone: string | null;
}

export function newPermissionTier(partial: Partial<PermissionTier> = {}): PermissionTier {
  return {
    kind: partial.kind ?? 'notify',
    after_minutes: partial.after_minutes ?? 0,
    phone: partial.phone ?? null,
  };
}

export function coercePermissionTier(raw: unknown): PermissionTier {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind: PermissionTierKind = r.kind === 'text' || r.kind === 'call' ? r.kind : 'notify';
  const after_minutes = typeof r.after_minutes === 'number' && Number.isFinite(r.after_minutes) ? r.after_minutes : 0;
  const phone = typeof r.phone === 'string' ? r.phone : null;
  return { kind, after_minutes, phone };
}

export type RepeatUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';
const REPEAT_UNITS: readonly RepeatUnit[] = ['minute', 'hour', 'day', 'week', 'month'];

export interface ScheduleConfig {
  enabled: boolean;
  repeat_every: number;
  repeat_unit: RepeatUnit;
  on_days: number[];
  hour: number;
  minute: number;
  day_of_month: number | null;
  last_day_of_month: boolean;
  timezone: string;
  ends_at: string | null;
  max_runs: number | null;
  runs_count: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/** Port of ScheduleConfig's `_clean_on_days` field_validator: drop out-of-range entries, dedupe
 * while preserving first-seen order. */
function cleanOnDays(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const d of arr) {
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/** Port of ScheduleConfig's `_enforce_interval_bounds` model_validator, applied AFTER the plain
 * Field bound clamps below -- same order the Python validators run in (field validators, then the
 * `mode="after"` model validator). */
export function coerceScheduleConfig(raw: unknown): ScheduleConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const repeat_unit: RepeatUnit = typeof r.repeat_unit === 'string' && (REPEAT_UNITS as readonly string[]).includes(r.repeat_unit)
    ? (r.repeat_unit as RepeatUnit)
    : 'week';
  let repeat_every = clampInt(r.repeat_every, 1, 1, Number.MAX_SAFE_INTEGER);
  const day_of_month = r.day_of_month == null ? null : clampInt(r.day_of_month, 1, 1, 31);
  if (repeat_unit === 'minute') {
    repeat_every = Math.max(15, Math.min(repeat_every, 1440));
  } else {
    repeat_every = Math.min(repeat_every, 365);
  }
  return {
    enabled: r.enabled === true,
    repeat_every,
    repeat_unit,
    on_days: cleanOnDays(r.on_days),
    hour: clampInt(r.hour, 9, 0, 23),
    minute: clampInt(r.minute, 0, 0, 59),
    day_of_month,
    last_day_of_month: r.last_day_of_month === true,
    timezone: typeof r.timezone === 'string' && r.timezone ? r.timezone : 'local',
    ends_at: typeof r.ends_at === 'string' ? r.ends_at : null,
    max_runs: r.max_runs == null ? null : clampInt(r.max_runs, 1, 1, Number.MAX_SAFE_INTEGER),
    runs_count: clampInt(r.runs_count, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function newScheduleConfig(): ScheduleConfig {
  return coerceScheduleConfig({});
}

export interface ActionsConfig {
  prevent_unused: boolean;
  freeze: boolean;
  configured_sets: string[];
}

export function coerceActionsConfig(raw: unknown): ActionsConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    prevent_unused: r.prevent_unused === true,
    freeze: r.freeze === true,
    configured_sets: Array.isArray(r.configured_sets) ? r.configured_sets.filter((s): s is string => typeof s === 'string') : [],
  };
}

export function newActionsConfig(): ActionsConfig {
  return coerceActionsConfig({});
}

export interface WorkflowStep {
  id: string;
  text: string;
  label: string | null;
  enabled: boolean;
}

let stepIdCounter = 0;
function newStepId(): string {
  // uuid4().hex equivalent: 32 lowercase hex chars, no dashes.
  stepIdCounter += 1;
  return `${Date.now().toString(16)}${stepIdCounter.toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
}

export function coerceWorkflowStep(raw: unknown): WorkflowStep {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newStepId(),
    text: typeof r.text === 'string' ? r.text : '',
    label: typeof r.label === 'string' ? r.label : null,
    enabled: r.enabled !== false,
  };
}

export function coerceWorkflowSteps(raw: unknown): WorkflowStep[] {
  return Array.isArray(raw) ? raw.map(coerceWorkflowStep) : [];
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: 'running' | 'success' | 'failure' | 'ran_late' | 'skipped';
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
  session_id: string | null;
  error: string | null;
  cost_usd: number;
  triggered_by: 'schedule' | 'manual' | 'retry';
  last_tool_label: string | null;
  active_step_idx: number | null;
  paused: boolean;
}

export function newWorkflowRun(partial: Partial<WorkflowRun> & { workflow_id: string }): WorkflowRun {
  return {
    id: partial.id ?? crypto.randomUUID().replace(/-/g, ''),
    workflow_id: partial.workflow_id,
    status: partial.status ?? 'running',
    scheduled_for: partial.scheduled_for ?? null,
    started_at: partial.started_at ?? new Date().toISOString(),
    finished_at: partial.finished_at ?? null,
    session_id: partial.session_id ?? null,
    error: partial.error ?? null,
    cost_usd: partial.cost_usd ?? 0.0,
    triggered_by: partial.triggered_by ?? 'schedule',
    last_tool_label: partial.last_tool_label ?? null,
    active_step_idx: partial.active_step_idx ?? null,
    paused: partial.paused ?? false,
  };
}

export function coerceWorkflowRun(raw: unknown): WorkflowRun {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return newWorkflowRun({
    id: typeof r.id === 'string' ? r.id : undefined,
    workflow_id: typeof r.workflow_id === 'string' ? r.workflow_id : '',
    status: (['running', 'success', 'failure', 'ran_late', 'skipped'] as const).includes(r.status as never) ? (r.status as WorkflowRun['status']) : 'running',
    scheduled_for: typeof r.scheduled_for === 'string' ? r.scheduled_for : null,
    started_at: typeof r.started_at === 'string' ? r.started_at : undefined,
    finished_at: typeof r.finished_at === 'string' ? r.finished_at : null,
    session_id: typeof r.session_id === 'string' ? r.session_id : null,
    error: typeof r.error === 'string' ? r.error : null,
    cost_usd: typeof r.cost_usd === 'number' ? r.cost_usd : 0,
    triggered_by: (['schedule', 'manual', 'retry'] as const).includes(r.triggered_by as never) ? (r.triggered_by as WorkflowRun['triggered_by']) : 'schedule',
    last_tool_label: typeof r.last_tool_label === 'string' ? r.last_tool_label : null,
    active_step_idx: typeof r.active_step_idx === 'number' ? r.active_step_idx : null,
    paused: r.paused === true,
  });
}

export interface MissedRun {
  id: string;
  workflow_id: string;
  scheduled_for: string;
  created_at: string;
}

export function newMissedRun(workflowId: string, scheduledFor: string): MissedRun {
  return {
    id: crypto.randomUUID().replace(/-/g, ''),
    workflow_id: workflowId,
    scheduled_for: scheduledFor,
    created_at: new Date().toISOString(),
  };
}

export function coerceMissedRun(raw: unknown): MissedRun | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.workflow_id !== 'string' || typeof r.scheduled_for !== 'string') return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID().replace(/-/g, ''),
    workflow_id: r.workflow_id,
    scheduled_for: r.scheduled_for,
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
  };
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string | null;
  deleted_at: string | null;
  system_prompt: string | null;
  use_synced_prompt: boolean;
  steps: WorkflowStep[];
  actions: ActionsConfig;
  schedule: ScheduleConfig;
  permissions: PermissionTier[];
  source_session_id: string | null;
  source_tools: string[];
  dashboard_id: string | null;
  model: string;
  mode: string;
  provider: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: 'success' | 'failure' | 'ran_late' | 'running' | 'skipped' | null;
  last_run_id: string | null;
  next_run_at: string | null;
  cost_cap_usd_monthly: number | null;
  edit_agent_session_id: string | null;
  schedule_agent_session_id: string | null;
  draft_steps: WorkflowStep[] | null;
  last_test_session_id: string | null;
  remembered_approvals: Record<string, 'allow' | 'deny'>;
  step_tool_usage: Record<string, Record<string, boolean>>;
  auto_named: boolean;
  unsaved: boolean;
  tested_signature: string | null;
}

export function newWorkflowId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Full hydrator: fills every field with Workflow's own pydantic defaults, then overlays whatever
 * `raw` supplies through the matching `coerce*` for nested fields. Used both for a brand-new
 * Workflow() construction (create_workflow) and for rehydrating an on-disk record
 * (storage._load_all_from_disk's `Workflow(**raw)`). */
export function coerceWorkflow(raw: unknown): Workflow {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const remembered: Record<string, 'allow' | 'deny'> = {};
  if (typeof r.remembered_approvals === 'object' && r.remembered_approvals !== null) {
    for (const [k, v] of Object.entries(r.remembered_approvals as Record<string, unknown>)) {
      if (v === 'allow' || v === 'deny') remembered[k] = v;
    }
  }
  const stepToolUsage: Record<string, Record<string, boolean>> = {};
  if (typeof r.step_tool_usage === 'object' && r.step_tool_usage !== null) {
    for (const [sid, tools] of Object.entries(r.step_tool_usage as Record<string, unknown>)) {
      if (typeof tools === 'object' && tools !== null) {
        const inner: Record<string, boolean> = {};
        for (const [t, v] of Object.entries(tools as Record<string, unknown>)) inner[t] = v === true;
        stepToolUsage[sid] = inner;
      }
    }
  }
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newWorkflowId(),
    title: typeof r.title === 'string' ? r.title : 'Untitled workflow',
    description: typeof r.description === 'string' ? r.description : '',
    icon: typeof r.icon === 'string' ? r.icon : '',
    color: typeof r.color === 'string' ? r.color : null,
    deleted_at: typeof r.deleted_at === 'string' ? r.deleted_at : null,
    system_prompt: typeof r.system_prompt === 'string' ? r.system_prompt : null,
    use_synced_prompt: r.use_synced_prompt !== false,
    steps: coerceWorkflowSteps(r.steps),
    actions: coerceActionsConfig(r.actions),
    schedule: coerceScheduleConfig(r.schedule),
    permissions: Array.isArray(r.permissions) && r.permissions.length > 0
      ? r.permissions.map(coercePermissionTier)
      : [newPermissionTier({ kind: 'notify' })],
    source_session_id: typeof r.source_session_id === 'string' ? r.source_session_id : null,
    source_tools: Array.isArray(r.source_tools) ? r.source_tools.filter((s): s is string => typeof s === 'string') : [],
    dashboard_id: typeof r.dashboard_id === 'string' ? r.dashboard_id : null,
    model: typeof r.model === 'string' && r.model ? r.model : 'sonnet',
    mode: typeof r.mode === 'string' && r.mode ? r.mode : 'agent',
    provider: typeof r.provider === 'string' && r.provider ? r.provider : 'anthropic',
    created_at: typeof r.created_at === 'string' ? r.created_at : now,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : now,
    last_run_at: typeof r.last_run_at === 'string' ? r.last_run_at : null,
    last_run_status: (['success', 'failure', 'ran_late', 'running', 'skipped'] as const).includes(r.last_run_status as never)
      ? (r.last_run_status as Workflow['last_run_status'])
      : null,
    last_run_id: typeof r.last_run_id === 'string' ? r.last_run_id : null,
    next_run_at: typeof r.next_run_at === 'string' ? r.next_run_at : null,
    cost_cap_usd_monthly: typeof r.cost_cap_usd_monthly === 'number' ? r.cost_cap_usd_monthly : null,
    edit_agent_session_id: typeof r.edit_agent_session_id === 'string' ? r.edit_agent_session_id : null,
    schedule_agent_session_id: typeof r.schedule_agent_session_id === 'string' ? r.schedule_agent_session_id : null,
    draft_steps: Array.isArray(r.draft_steps) ? coerceWorkflowSteps(r.draft_steps) : null,
    last_test_session_id: typeof r.last_test_session_id === 'string' ? r.last_test_session_id : null,
    remembered_approvals: remembered,
    step_tool_usage: stepToolUsage,
    auto_named: r.auto_named === true,
    unsaved: r.unsaved === true,
    tested_signature: typeof r.tested_signature === 'string' ? r.tested_signature : null,
  };
}

/** Fresh Workflow() with pydantic's own field defaults -- the zero-argument shape create_workflow
 * starts from before overlaying WorkflowCreate's own fields. */
export function newWorkflow(): Workflow {
  return coerceWorkflow({});
}

// -- Request/response bodies -------------------------------------------------------------------

export interface WorkflowCreateBody {
  title: string;
  auto_named: boolean;
  unsaved: boolean;
  description: string;
  icon: string;
  color: string | null;
  system_prompt: string | null;
  use_synced_prompt: boolean;
  steps: WorkflowStep[];
  actions: ActionsConfig;
  schedule: ScheduleConfig;
  permissions: PermissionTier[] | null;
  source_session_id: string | null;
  dashboard_id: string | null;
  model: string | null;
  mode: string | null;
  provider: string | null;
  cost_cap_usd_monthly: number | null;
  tested_signature: string | null;
  metadata_generated: boolean;
}

export function coerceWorkflowCreateBody(raw: unknown): WorkflowCreateBody {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    title: typeof r.title === 'string' ? r.title : 'Untitled workflow',
    auto_named: r.auto_named !== false,
    unsaved: r.unsaved === true,
    description: typeof r.description === 'string' ? r.description : '',
    icon: typeof r.icon === 'string' ? r.icon : '',
    color: typeof r.color === 'string' ? r.color : null,
    system_prompt: typeof r.system_prompt === 'string' ? r.system_prompt : null,
    use_synced_prompt: r.use_synced_prompt !== false,
    steps: coerceWorkflowSteps(r.steps),
    actions: coerceActionsConfig(r.actions),
    schedule: coerceScheduleConfig(r.schedule),
    permissions: Array.isArray(r.permissions) ? r.permissions.map(coercePermissionTier) : null,
    source_session_id: typeof r.source_session_id === 'string' ? r.source_session_id : null,
    dashboard_id: typeof r.dashboard_id === 'string' ? r.dashboard_id : null,
    model: typeof r.model === 'string' ? r.model : null,
    mode: typeof r.mode === 'string' ? r.mode : null,
    provider: typeof r.provider === 'string' ? r.provider : null,
    cost_cap_usd_monthly: typeof r.cost_cap_usd_monthly === 'number' ? r.cost_cap_usd_monthly : null,
    tested_signature: typeof r.tested_signature === 'string' ? r.tested_signature : null,
    metadata_generated: r.metadata_generated === true,
  };
}

export interface GenerateMetadataRequestBody {
  steps: WorkflowStep[];
  model: string | null;
}

export function coerceGenerateMetadataRequest(raw: unknown): GenerateMetadataRequestBody {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    steps: coerceWorkflowSteps(r.steps),
    model: typeof r.model === 'string' ? r.model : null,
  };
}

export interface GenerateMetadataResponseBody {
  title: string;
  description: string;
  step_labels: string[];
}

/** Present-but-possibly-absent semantics for WorkflowUpdate's fields (FastAPI's
 * `model_dump(exclude_unset=True)`): each key here is either absent (untouched) or one of the
 * coerced value / null. `has(key)` on the raw body is what "unset" maps to below. */
export interface WorkflowUpdateBody {
  raw: Record<string, unknown>;
}

export function coerceWorkflowUpdateBody(raw: unknown): WorkflowUpdateBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return { raw: raw as Record<string, unknown> };
}

export function updateHas(body: WorkflowUpdateBody, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body.raw, key);
}

export interface MissedRunActionBody {
  ids: string[];
}

export function coerceMissedRunAction(raw: unknown): MissedRunActionBody {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { ids: Array.isArray(r.ids) ? r.ids.filter((s): s is string => typeof s === 'string') : [] };
}

export interface AskRunRequestBody {
  run_id: string;
  prompt: string;
  mode: string | null;
  model: string | null;
}

export function coerceAskRunBody(raw: unknown): AskRunRequestBody | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.run_id !== 'string' || typeof r.prompt !== 'string') return null;
  return {
    run_id: r.run_id,
    prompt: r.prompt,
    mode: typeof r.mode === 'string' ? r.mode : null,
    model: typeof r.model === 'string' ? r.model : null,
  };
}

export interface DraftCommitRequestBody {
  model: string | null;
  keep_session: boolean;
}

export function coerceDraftCommitBody(raw: unknown): DraftCommitRequestBody {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    model: typeof r.model === 'string' ? r.model : null,
    keep_session: r.keep_session === true,
  };
}
