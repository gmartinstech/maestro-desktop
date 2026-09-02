// AGT-2: faithful TypeScript port of backend/apps/agents/core/models.py's pydantic models --
// the full INTERNAL session/message/approval shapes the (eventual) TS agent loop will hold in
// memory, as opposed to contract/ws/agents.ts's WsAgentSessionSnapshot/WsAgentMessage/WsAgentBranch,
// which pin only the minimal wire-relevant subset actually read by WebSocketManager.ts. AgentSession
// below is a structural superset of WsAgentSessionSnapshot (and Message a superset of
// WsAgentMessage, MessageBranch an exact match for WsAgentBranch) -- see wsManager.ts's
// sendToSession for where the two type universes meet.
//
// Pydantic -> TS field-shape conventions used throughout this file (so the mapping stays legible
// without re-deriving it per field):
//   - `Optional[T] = None` -> `T | null`, not `T | undefined`. pydantic's `model_dump(mode="json")`
//     always emits the key (as JSON `null` when unset) rather than omitting it, so the wire-accurate
//     shape needs the value present-but-nullable, not the key optional.
//   - A field with any OTHER default (`= ""`, `= 0`, `Field(default_factory=list)`, ...) -> a plain
//     required TS field. pydantic always fills a concrete value when the field is omitted at
//     construction, so by the time an instance exists (or crosses the wire) the key is always
//     present with a real value -- there is no "optional key" state to model.
//   - `datetime` -> `string` (ISO-8601, per `model_dump(mode="json")`'s serialization).
//   - `dict[str, X]` -> `Record<string, X>`; `list[dict]` -> `Array<Record<string, unknown>>` (the
//     Python side never declares a narrower dict shape, so this port doesn't invent one either).

/** Message.role / WsAgentMessage.role's shared literal union. */
export type MessageRole = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'thinking';

/** AgentSession.status. NOTE: contract/ws/agents.ts's WsAgentSessionSnapshot.status additionally
 * allows `'draft'`, which this 5-value Python-sourced union does not produce -- AgentSession itself
 * apparently never carries that value (some other, not-yet-ported code path must synthesize
 * "draft" session rows, e.g. a pre-launch placeholder card). Not fixed here: it is a superset on
 * the contract side, which is a safe direction for a wire type to be looser than the model that
 * fills most of its instances, and this ticket's scope is the model file, not that other path. */
export type AgentSessionStatus = 'running' | 'waiting_approval' | 'completed' | 'error' | 'stopped';

export type WorkflowTestState = 'running' | 'complete' | 'error';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'auto';

/** The first turn's payload, carried BY the launch request (see AgentConfig.initial_message's
 * doc for why: riding along with launch instead of a second HTTP call makes "launched" and
 * "prompt delivered" one outcome instead of two). */
export interface InitialMessage {
  prompt: string;
  images: Array<Record<string, unknown>> | null;
  context_paths: Array<Record<string, unknown>> | null;
  forced_tools: string[] | null;
  attached_skills: Array<Record<string, unknown>> | null;
  selected_browser_ids: string[] | null;
  selected_setting_ids: string[] | null;
  client_message_id: string | null;
}

export interface AgentConfig {
  name: string;
  model: string;
  mode: string;
  provider: string;
  system_prompt: string | null;
  allowed_tools: string[];
  max_turns: number | null;
  target_directory: string | null;
  dashboard_id: string | null;
  workflow_run_id: string | null;
  workflow_edit_id: string | null;
  // App cards the user picked to edit; when exactly one resolves, launch binds the chat's cwd to
  // that app instead of seeding a new "Untitled App".
  selected_app_output_ids: string[] | null;
  // Set when the launch carries the user's first prompt; /launch then delivers it in the same request.
  initial_message: InitialMessage | null;
}

/** Default `allowed_tools`, matching AgentConfig's `default_factory` in models.py exactly --
 * callers that construct an AgentConfig without an explicit tool list should spread this in,
 * the same way pydantic's default_factory fills it silently on the Python side. */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'AskUserQuestion'];

export interface ApprovalRequest {
  id: string;
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  created_at: string;
  // Set when this approval was triggered by the sensitive-path override rather than the user's
  // normal "ask" policy; all three null for ordinary "ask" approvals. sensitive_pattern is the
  // fnmatch pattern (canonical id; what gets persisted into the trusted allowlist if the user opts
  // in), sensitive_label a short human label, sensitive_why a plain-English risk explanation.
  sensitive_pattern: string | null;
  sensitive_label: string | null;
  sensitive_why: string | null;
}

/** The client's answer to an ApprovalRequest (client->server, `agent:approval_response`'s payload
 * shape -- see contract/ws/agents.ts's AgentWsClientEvent for the wire frame this rides in). */
export interface ApprovalResponse {
  request_id: string;
  behavior: 'allow' | 'deny';
  message: string | null;
  updated_input: Record<string, unknown> | null;
  // "Always allow files like this": persist the matched sensitive_pattern so future writes against
  // the same pattern skip the modal.
  trust_pattern: boolean;
  // "Always approve" button: persist this tool's policy to always_allow (catastrophic/sensitive
  // guards still fire, so this can't blanket-approve an rm -rf or a sensitive-path write).
  set_always_allow: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: unknown; // str or list of content blocks, per models.py's `content: Any`
  timestamp: string;
  branch_id: string;
  parent_id: string | null;
  context_paths: Array<Record<string, unknown>> | null;
  attached_skills: Array<Record<string, unknown>> | null;
  forced_tools: string[] | null;
  images: Array<Record<string, unknown>> | null;
  hidden: boolean;
  // Frontend-generated id for optimistic-bubble dedup against the server echo.
  client_message_id: string | null;
  // Wall-clock ms producing this message's content; for thinking, content_block_start -> stop.
  elapsed_ms: number | null;
  // Approx output tokens; thinking uses char/3.6 to match the live UI's count. Display only.
  tokens: number | null;
  // Drives the "N tools used" segment on the thinking pill.
  tool_count: number | null;
  // Combined input + output + children tokens for the turn (overloaded name).
  input_tokens: number | null;
}

export interface MessageBranch {
  id: string;
  parent_branch_id: string | null;
  fork_point_message_id: string | null;
  created_at: string;
}

export interface ToolGroupMeta {
  id: string;
  name: string;
  svg: string;
  is_refined: boolean;
}

/** Per-tool latency accumulator; models.py types `tool_latencies` generically as `dict[str, dict]`
 * (no nested shape declared), but its own comment pins the runtime shape to exactly this -- kept
 * as a named type here since AgentSession.tool_latencies documents it precisely enough to be worth
 * naming, while still matching the Python annotation's actual (generic-dict) looseness at the
 * declared-type level would have meant `Record<string, Record<string, unknown>>`; this is the
 * stricter, more useful reading and nothing in the Python source contradicts it. */
export interface ToolLatencyStats {
  count: number;
  total_ms: number;
  max_ms: number;
}

export interface AgentSession {
  id: string;
  name: string;
  status: AgentSessionStatus;
  provider: string;
  model: string;
  mode: string;
  sdk_session_id: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  max_turns: number | null;
  cwd: string | null;
  // Resolved at session start so resume reattaches to the same repo even after the user cd's elsewhere.
  repo_url: string | null;
  branch: string | null;
  created_at: string;
  closed_at: string | null;
  // Wall-clock of the first stream event so resumed sessions can show "first response at HH:MM" without rescan.
  first_response_at: string | null;
  // HITL approval log: {tool, behavior, decision_ms} per entry.
  approval_decisions: Array<Record<string, unknown>>;
  cost_usd: number;
  // Conventionally `{input, output}`, but declared as a generic string-keyed map in models.py too.
  tokens: Record<string, number>;
  // Total ms in status="running", accumulated across turns/resume; powers session-close "agent active time".
  agent_active_ms: number;
  // Per-model wall-clock ms; updated on model switch or close.
  time_per_model: Record<string, number>;
  tool_latencies: Record<string, ToolLatencyStats>;
  browser_domains: string[];
  messages: Message[];
  // Derived cache: msg.id -> index in `messages` (see models.py's upsert_message() doc for the
  // validate-then-fallback self-healing pattern). `exclude=True` on the Python field means this
  // key is NEVER present in model_dump()/the WS payload/disk saves -- it is pure in-process state,
  // rebuildable from `messages` alone. Kept here because the (future) TS agent loop needs the same
  // fast-lookup-with-fallback optimization; any code that serializes an AgentSession onto the wire
  // must omit this field explicitly (there is no TS analog of pydantic's `exclude=True` to enforce
  // it structurally -- see wsManager.ts's sendToSession callers, once they exist).
  message_index: Record<string, number>;
  pending_approvals: ApprovalRequest[];
  branches: Record<string, MessageBranch>;
  active_branch_id: string;
  tool_group_meta: Record<string, ToolGroupMeta>;
  dashboard_id: string | null;
  browser_id: string | null;
  parent_session_id: string | null;
  // Set when this session IS a workflow run's agent; the run renders in the Workflows monitor card.
  workflow_run_id: string | null;
  // Set when this session IS a workflow's embedded edit/compose chat.
  workflow_edit_id: string | null;
  workflow_test_state: WorkflowTestState | null;
  // Browser memory signals, drive the subtle "remembered/learned" card chip.
  memory_recalled: boolean;
  memory_learned: boolean;
  needs_fork: boolean;
  // Stronger than needs_fork: drop resume= and replay history into a fresh sdk_session_id.
  needs_fresh_session: boolean;
  // Auto-continue: agent loop dispatches a hidden turn at end-of-loop using pending_continuation_prompt.
  pending_continuation: boolean;
  pending_continuation_prompt: string | null;
  // Sanitized server names model has explicitly activated this session; non-bypassable, dispatch-layer gate.
  active_mcps: string[];
  // Heuristic preamble tokens (preset + tool defs + MCP descs + composed prompt); subtracted from displayed input.
  framework_overhead_tokens: number;
  // Live ctx_used ratio triggering compaction at the next turn boundary; ratio of context_window.
  compact_threshold_pct: number;
  // Absolute token ceiling so big-window models don't sit at 65% before marking.
  compact_abs_ceiling_tokens: number;
  compacted_through_msg_id: string | null;
  // Aux-LLM distilled summary of the turns dropped by compaction, cached against the cutoff id.
  compacted_summary: string | null;
  compacted_summary_through: string | null;
  // Hard pre-send guard at 0.90; past compaction active_mcps are LRU-trimmed, then the overflow card surfaces.
  context_soft_cap_pct: number;
  // Conservative default; always overwritten at session creation/restore/model-switch with the real model cap.
  context_window: number;
  // Provider-agnostic thinking level, translated per-API in agent_manager; only affects reasoning-flagged models.
  thinking_level: ThinkingLevel;
}
