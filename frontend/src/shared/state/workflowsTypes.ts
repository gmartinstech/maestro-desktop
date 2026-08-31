export type PermissionKind = 'notify' | 'text' | 'call';

export interface PermissionTier {
  kind: PermissionKind;
  after_minutes: number;
  phone?: string | null;
}

export interface ScheduleConfig {
  enabled: boolean;
  repeat_every: number;
  repeat_unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  on_days: number[];
  hour: number;
  minute: number;
  day_of_month?: number | null;
  /** Monthly schedules fire on the calendar's last day (28-31) when true. */
  last_day_of_month?: boolean;
  timezone: string;
  /** End conditions; null on both = forever. Scheduler auto-disables on threshold. */
  ends_at: string | null;
  max_runs: number | null;
  runs_count: number;
}

export interface CostEstimate {
  monthly_usd: number;
  last_run_usd: number;
  fires_per_month: number;
}

export interface ActiveRun {
  workflow_id: string;
  run_id: string;
  title: string;
  started_at: string | null;
}

export interface ActionsConfig {
  prevent_unused: boolean;
  freeze: boolean;
  configured_sets: string[];
}

export interface WorkflowStep {
  id: string;
  text: string;
  /** LLM-generated 3-6 word label shown when the step row is collapsed. The
   *  full `text` is what the agent actually runs; this is just the title. */
  label?: string | null;
  /** Disabled steps stay in the list but the executor skips them. Undefined
   *  (legacy records) is treated as enabled. */
  enabled?: boolean;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** User-chosen swatch (hex). Null/undefined falls back to the id-hash color. */
  color?: string | null;
  /** Soft-delete tombstone (ISO). Set = in Trash. */
  deleted_at?: string | null;
  system_prompt: string | null;
  use_synced_prompt: boolean;
  steps: WorkflowStep[];
  actions: ActionsConfig;
  schedule: ScheduleConfig;
  permissions: PermissionTier[];
  source_session_id?: string | null;
  dashboard_id?: string | null;
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
  cost_estimate?: CostEstimate;
  /** Sticky session id for the Edit Agent embedded in the workflow card. */
  edit_agent_session_id?: string | null;
  /** Sticky session id for the embedded scheduling agent (cadence -> gated tool call). */
  schedule_agent_session_id?: string | null;
  /** Pending Edit-Agent draft of the steps; present only while editing. */
  draft_steps?: WorkflowStep[] | null;
  /** True when a draft is staged (server-computed convenience flag). */
  has_draft?: boolean;
  /** Most recent Test Agent session for this workflow. */
  last_test_session_id?: string | null;
  /** Tool permissions the user answered once and we reuse on later runs so an
   *  unattended scheduled fire doesn't stall on a prompt. tool name -> answer. */
  remembered_approvals?: Record<string, 'allow' | 'deny'>;
  step_tool_usage?: Record<string, Record<string, boolean>>;
  /** Tool names observed in the source chat when this workflow was generated. */
  source_tools?: string[];
  /** False once the user explicitly renames the workflow; backend may auto-rename while true. */
  auto_named?: boolean;
  /** True while a brand-new "+ New" workflow is still being built and hasn't been saved; hub hides these. */
  unsaved?: boolean;
  /** Signature of the steps last validated by a test run (or seeded at chat
   *  conversion). Compared against the current steps to decide whether to warn
   *  before scheduling. See scheduleUtils.needsScheduleTestWarning. */
  tested_signature?: string | null;
  /** Suggested cadence from a SuggestConvertToWorkflow tool call (e.g. "every weekday at 9am").
   *  Used to seed the scheduling agent's prompt. Transient draft field only. */
  suggested_cadence?: string;
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
  /** Live "what's the agent doing" subtitle while status is 'running'. */
  last_tool_label?: string | null;
  /** Currently-executing 0-based step index while status is 'running';
   *  freezes on the failed step when status flips to 'failure'. */
  active_step_idx?: number | null;
  /** True while the user has paused the in-flight agent turn (chat-style
   *  stop/resume). Drives the running card's Pause/Resume button. */
  paused?: boolean;
}

export type WorkflowRunControlAction = 'pause' | 'resume' | 'stop';

/** Transient view-only state per card; position lives in dashboardLayoutSlice.workflowCards. */
export interface OpenCard {
  workflowId: string;
  sourceSessionId?: string | null;
  draft?: Partial<Workflow> | null;
  view:
    | 'preview'
    | 'saved'
    | 'edit'
    | 'history'
    | 'history_detail'
    | 'running'
    | 'completed'
    | 'failed'
    | 'scheduling'
    | 'edit_agent'
    | 'fix_agent';
  editFacet?: 'General' | 'Actions' | 'Schedule';
  historyRunId?: string | null;
  /** The run id currently surfaced by Running/Completed/Failed views. */
  runId?: string | null;
  /** When set, the workflow card is "linked" to a sibling session card via
   *  a labeled arrow chip, and the card footer shifts to Stop Watching /
   *  Stop Viewing / Force Stop. The session id points at the sibling agent. */
  sidecarSessionId?: string | null;
  sidecarKind?: 'watching' | 'viewing-completed' | 'viewing-error' | 'testing' | null;
  /** Per-step expand state for ExpandedView. Stores step ids. */
  expandedStepIds?: string[];
  /** One-shot "Schedule this workflow?" prompt shown right after a convert.
   *  Transient: lives only on the just-created card, never on hub-opened ones. */
  showScheduleNudge?: boolean;
  /** Pre-seed message for the Fix-with-Agent flow so the EditAgent composer
   *  knows which failure context to lead with. Cleared once consumed. */
  fixSeed?: { runId: string; stepIdx: number; stepLabel: string; error: string } | null;
  /** True while the preview-time aux naming call is in flight; drives the
   *  header's subtle pulse on a just-converted draft. */
  metaLoading?: boolean;
  /** True once preview-time naming filled a real title, so save trusts the
   *  draft's metadata instead of regenerating it server-side. */
  metaGenerated?: boolean;
}

export interface RunningToast {
  workflowId: string;
  runId: string;
  workflowTitle: string;
}

export interface State {
  items: Record<string, Workflow>;
  runs: Record<string, WorkflowRun[]>;
  openCards: Record<string, OpenCard>;
  loaded: boolean;
  loading: boolean;
  paused: boolean;
  active: ActiveRun[];
  cloudSmsEnabled: boolean;
  allRuns: WorkflowRun[];
  allRunsLoading: boolean;
  runningToast: RunningToast | null;
  runControlPending: Record<string, WorkflowRunControlAction>;
  deleted: Workflow[];
  deletedLoading: boolean;
}

export const initialState: State = { items: {}, runs: {}, openCards: {}, loaded: false, loading: false, paused: false, active: [], cloudSmsEnabled: false, allRuns: [], allRunsLoading: false, runningToast: null, runControlPending: {}, deleted: [], deletedLoading: false };
