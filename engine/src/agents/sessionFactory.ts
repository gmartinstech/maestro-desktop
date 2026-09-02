// engine/src/agents/sessionFactory.ts -- AGT-3. Construction helpers for AGT-2's `core/models.ts`
// types (Message/MessageBranch/AgentSession). That file is pure interfaces on purpose (AGT-2's own
// header: every field with a pydantic default becomes a plain REQUIRED TS field, not an optional
// one) -- which means every construction site has to supply all ~20-40 fields by hand. These
// factories exist so MockAgent.ts (and this ticket's tests) don't have to repeat that, the same way
// pydantic's Field(default_factory=...) spares a Python caller the same repetition.
//
// Originally this ticket shipped its own standalone models.ts (a duplicate of what became AGT-2's
// core/models.ts, written before that file existed in this tree -- AGT-1/AGT-2 landed concurrently
// via a separate subagent). Once AGT-2's port was confirmed complete and no longer being written
// to, this ticket switched over to it and deleted its own copy rather than leave two competing
// AgentSession types in the same package -- see docs/plans/txm-status.md's AGT-3 row for the full
// story. toWireSession() below is the one real behavioral piece this reconciliation needed: AGT-2's
// own header flags that `message_index` must never reach the wire (it mirrors pydantic's
// `exclude=True`, which TS has no structural equivalent for) and explicitly names "wsManager.ts's
// sendToSession callers, once they exist" as the place that has to do the omitting -- MockAgent.ts
// is the first such caller, and toWireSession is what it uses.

import type { AgentSession, Message, MessageBranch } from './core/models';

export function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content' | 'branch_id' | 'timestamp'>): Message {
  return {
    id: overrides.id,
    role: overrides.role,
    content: overrides.content,
    timestamp: overrides.timestamp,
    branch_id: overrides.branch_id,
    parent_id: overrides.parent_id ?? null,
    context_paths: overrides.context_paths ?? null,
    attached_skills: overrides.attached_skills ?? null,
    forced_tools: overrides.forced_tools ?? null,
    images: overrides.images ?? null,
    hidden: overrides.hidden ?? false,
    client_message_id: overrides.client_message_id ?? null,
    elapsed_ms: overrides.elapsed_ms ?? null,
    tokens: overrides.tokens ?? null,
    tool_count: overrides.tool_count ?? null,
    input_tokens: overrides.input_tokens ?? null,
  };
}

export function createMessageBranch(overrides: Partial<MessageBranch> & Pick<MessageBranch, 'id' | 'created_at'>): MessageBranch {
  return {
    id: overrides.id,
    parent_branch_id: overrides.parent_branch_id ?? null,
    fork_point_message_id: overrides.fork_point_message_id ?? null,
    created_at: overrides.created_at,
  };
}

/** Mirrors AgentSession's pydantic defaults (backend/apps/agents/core/models.py), including
 * `allowed_tools` defaulting to an EMPTY list (AgentSession's own `default_factory=list` -- NOT the
 * populated default `AgentConfig.allowed_tools` carries; that's launch_agent's job to fill in for a
 * real launch, out of this ticket's scope). `message_index` defaults to `{}`, matching what an
 * AgentSession would hold immediately after construction before any message is upserted into it. */
export function createAgentSession(overrides: Partial<AgentSession> & Pick<AgentSession, 'id' | 'name' | 'created_at' | 'branches'>): AgentSession {
  return {
    id: overrides.id,
    name: overrides.name,
    status: overrides.status ?? 'running',
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'sonnet',
    mode: overrides.mode ?? 'agent',
    sdk_session_id: overrides.sdk_session_id ?? null,
    system_prompt: overrides.system_prompt ?? null,
    allowed_tools: overrides.allowed_tools ?? [],
    max_turns: overrides.max_turns ?? null,
    cwd: overrides.cwd ?? null,
    repo_url: overrides.repo_url ?? null,
    branch: overrides.branch ?? null,
    created_at: overrides.created_at,
    closed_at: overrides.closed_at ?? null,
    first_response_at: overrides.first_response_at ?? null,
    approval_decisions: overrides.approval_decisions ?? [],
    cost_usd: overrides.cost_usd ?? 0.0,
    tokens: overrides.tokens ?? { input: 0, output: 0 },
    agent_active_ms: overrides.agent_active_ms ?? 0,
    time_per_model: overrides.time_per_model ?? {},
    tool_latencies: overrides.tool_latencies ?? {},
    browser_domains: overrides.browser_domains ?? [],
    messages: overrides.messages ?? [],
    message_index: overrides.message_index ?? {},
    pending_approvals: overrides.pending_approvals ?? [],
    branches: overrides.branches,
    active_branch_id: overrides.active_branch_id ?? 'main',
    tool_group_meta: overrides.tool_group_meta ?? {},
    dashboard_id: overrides.dashboard_id ?? null,
    browser_id: overrides.browser_id ?? null,
    parent_session_id: overrides.parent_session_id ?? null,
    workflow_run_id: overrides.workflow_run_id ?? null,
    workflow_edit_id: overrides.workflow_edit_id ?? null,
    workflow_test_state: overrides.workflow_test_state ?? null,
    memory_recalled: overrides.memory_recalled ?? false,
    memory_learned: overrides.memory_learned ?? false,
    needs_fork: overrides.needs_fork ?? false,
    needs_fresh_session: overrides.needs_fresh_session ?? false,
    pending_continuation: overrides.pending_continuation ?? false,
    pending_continuation_prompt: overrides.pending_continuation_prompt ?? null,
    active_mcps: overrides.active_mcps ?? [],
    framework_overhead_tokens: overrides.framework_overhead_tokens ?? 0,
    compact_threshold_pct: overrides.compact_threshold_pct ?? 0.65,
    compact_abs_ceiling_tokens: overrides.compact_abs_ceiling_tokens ?? 180_000,
    compacted_through_msg_id: overrides.compacted_through_msg_id ?? null,
    compacted_summary: overrides.compacted_summary ?? null,
    compacted_summary_through: overrides.compacted_summary_through ?? null,
    context_soft_cap_pct: overrides.context_soft_cap_pct ?? 0.9,
    context_window: overrides.context_window ?? 200_000,
    thinking_level: overrides.thinking_level ?? 'auto',
  };
}

/** AgentSession minus `message_index`: the pure in-process lookup cache AGT-2's core/models.ts
 * documents as needing exclusion from any wire payload (pydantic's `exclude=True` has no TS
 * structural equivalent, so it has to be stripped by hand at the one place a session crosses onto
 * the wire). Used by MockAgent.ts's `agent:status` full-snapshot event. */
export function toWireSession(session: AgentSession): Omit<AgentSession, 'message_index'> {
  const { message_index, ...wire } = session;
  void message_index;
  return wire;
}
