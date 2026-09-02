// Frozen WS contract for `/ws/agents/{session_id}` (backend/main.py:155).
// Hand-written: OpenAPI does not cover WebSocket. Enumerated from the emitting side
// (backend/apps/agents/core/ws_manager.py's send_to_session, plus the connection-scoped
// frames backend/main.py's websocket_session() writes directly) and cross-checked against
// the consuming side (frontend/src/shared/ws/WebSocketManager.ts's handleMessage switch).
// See README.md for what's deliberately excluded (dashboard-only events, client->server frames).
//
// Any change to a WS event's shape, or a new event, must land here FIRST.

/** A minimal, wire-relevant snapshot of AgentSession as embedded in `agent:status`'s full
 * form. Backend source: AgentSession (backend/apps/agents/core/models.py), serialized via
 * model_dump(mode="json"). This type pins only the fields WebSocketManager.ts actually reads
 * off `data.session`; the real payload carries many more (system_prompt, allowed_tools,
 * tokens, branches, tool_group_meta, etc.) that are irrelevant to the WS contract today. */
export interface WsAgentSessionSnapshot {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'waiting_approval' | 'completed' | 'error' | 'stopped';
  model: string;
  mode: string;
  // AGT-2 fix: was `dashboard_id?: string` (no `| null`), inconsistent with its two siblings right
  // below. AgentSession.dashboard_id (backend/apps/agents/core/models.py) is `Optional[str] = None`
  // -- identical to workflow_run_id/workflow_edit_id -- and model_dump(mode="json") always emits
  // the key (JSON null, not an omitted key), so a real `agent:status` payload never actually hits
  // the bare-optional case this type described. Caught by tsc when engine/src/agents/core/models.ts's
  // ported AgentSession failed to structurally satisfy this snapshot type.
  dashboard_id?: string | null;
  workflow_run_id?: string | null;
  workflow_edit_id?: string | null;
  cost_usd: number;
  active_branch_id: string;
  messages: Array<{ id: string; role: string; content: unknown }>;
  [extra: string]: unknown;
}

/** `agent:message`'s embedded chat message. Backend source: Message
 * (backend/apps/agents/core/models.py), serialized via model_dump(mode="json"). */
export interface WsAgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'thinking';
  content: unknown;
  timestamp: string;
  branch_id: string;
  parent_id: string | null;
  [extra: string]: unknown;
}

export interface WsAgentBranch {
  id: string;
  parent_branch_id: string | null;
  fork_point_message_id: string | null;
  created_at: string;
}

// ---- Connection-scoped frames (no session-data business logic) ----

export interface WsServerHello {
  event: 'server:hello';
  session_id: string;
  data: {
    connection_uuid: string;
    current_seq: number;
    ack: { ok: boolean; [extra: string]: unknown };
  };
}

export interface WsServerPong {
  event: 'server:pong';
  session_id: string;
  data: { nonce: unknown };
}

/** Sent when a reconnecting client's last_seq predates the ring buffer; the frontend
 * refetches the session over REST instead of trusting a partial replay. */
export interface WsAgentGapDetected {
  event: 'agent:gap_detected';
  session_id: string;
  data: {
    session_id: string;
    oldest_seq: number | null;
    newest_seq: number | null;
    client_seq: number;
  };
}

// ---- agent:* domain events (send_to_session; carry `seq`, and duplicate session_id into `data`) ----

/** Two real shapes coexist in production (see backend/tests/test_ws_event_contract.py's
 * GOLDEN_PAYLOAD_KEYS): the "full" form from run_agent_loop's terminal finally-block
 * (embeds the whole session), and the "lite" form used around HITL approval waits
 * (decision.py, browser_agent.py) which omits `session` entirely. */
export interface WsAgentStatusFull {
  event: 'agent:status';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    status: WsAgentSessionSnapshot['status'];
    session: WsAgentSessionSnapshot;
  };
}

export interface WsAgentStatusLite {
  event: 'agent:status';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    status: WsAgentSessionSnapshot['status'];
  };
}

export interface WsAgentMessageEvent {
  event: 'agent:message';
  session_id: string;
  seq: number;
  data: { session_id: string; message: WsAgentMessage };
}

export interface WsAgentStreamStart {
  event: 'agent:stream_start';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    message_id: string;
    role: 'assistant' | 'thinking' | 'tool_call';
    /** Only present when role === 'tool_call'. */
    tool_name?: string;
  };
}

export interface WsAgentStreamDelta {
  event: 'agent:stream_delta';
  session_id: string;
  seq: number;
  data: { session_id: string; message_id: string; delta: string };
}

export interface WsAgentStreamEnd {
  event: 'agent:stream_end';
  session_id: string;
  seq: number;
  data: { session_id: string; message_id: string };
}

/** Emitted by ws_manager.send_approval_request; request_id is later resolved via the
 * client's `agent:approval_response` (see resolve_approval / ConnectionManager.pending_futures). */
export interface WsAgentApprovalRequest {
  event: 'agent:approval_request';
  session_id: string;
  seq: number;
  data: {
    request_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    sensitive_pattern?: string;
    sensitive_label?: string;
    sensitive_why?: string;
  };
}

/** Admission-gate pair: queued while waiting for a concurrency slot, admitted once it starts. */
export interface WsAgentQueued {
  event: 'agent:queued';
  session_id: string;
  seq: number;
  data: { session_id: string };
}

export interface WsAgentAdmitted {
  event: 'agent:admitted';
  session_id: string;
  seq: number;
  data: { session_id: string };
}

/** The backend hit a context-overflow crash mid-turn, rebuilt from its local copy, and
 * retried on its own; this is a transient "recovered" notice, not an error. */
export interface WsAgentContextRecovered {
  event: 'agent:context_recovered';
  session_id: string;
  seq: number;
  data: { session_id: string };
}

export interface WsAgentCostUpdate {
  event: 'agent:cost_update';
  session_id: string;
  seq: number;
  data: { session_id: string; cost_usd: number };
}

export interface WsAgentContextUpdate {
  event: 'agent:context_update';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_read_pct: number;
    ctx_used_pct: number;
    context_window?: number;
    framework_overhead_tokens?: number;
    active_mcps?: string[];
  };
}

/** `reason` fans out into three call-site shapes; only "compacted" currently drives a
 * frontend chip (recordCompaction), the other two are backend-emitted but not yet consumed. */
export type WsAgentContextStatus =
  | {
      event: 'agent:context_status';
      session_id: string;
      seq: number;
      data: { session_id: string; reason: 'compacted'; compacted_through_msg_id: string | null };
    }
  | {
      event: 'agent:context_status';
      session_id: string;
      seq: number;
      data: { session_id: string; reason: 'trimmed'; trimmed: string[]; estimate_after: number };
    }
  | {
      event: 'agent:context_status';
      session_id: string;
      seq: number;
      data: { session_id: string; reason: 'mcp_disabled_externally'; deactivated: string[] };
    };

export interface WsAgentContextOverflow {
  event: 'agent:context_overflow';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    reason: string;
    message: string;
    model?: string;
    provider?: string;
    context_window?: number;
    framework_overhead_tokens?: number;
    input_tokens?: number;
    active_mcps?: string[];
    compact_threshold_pct?: number;
    context_soft_cap_pct?: number;
  };
}

export interface WsAgentRateLimited {
  event: 'agent:rate_limited';
  session_id: string;
  seq: number;
  data: { session_id: string; retry_after_s: number | null };
}

export interface WsAgentAuthError {
  event: 'agent:auth_error';
  session_id: string;
  seq: number;
  data: { session_id: string; reason: string; message: string; model?: string };
}

export interface WsAgentOutOfTokens {
  event: 'agent:out_of_tokens';
  session_id: string;
  seq: number;
  data: { session_id: string; message: string; reset_hint?: string; model?: string };
}

export interface WsAgentMcpSuggestions {
  event: 'agent:mcp_suggestions';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    suggestions: Array<{ id: string; title: string; description: string; reason?: string }>;
    is_vague: boolean;
  };
}

export interface WsAgentBranchCreated {
  event: 'agent:branch_created';
  session_id: string;
  seq: number;
  data: { session_id: string; branch: WsAgentBranch; active_branch_id: string };
}

export interface WsAgentBranchSwitched {
  event: 'agent:branch_switched';
  session_id: string;
  seq: number;
  data: { session_id: string; active_branch_id: string };
}

export interface WsAgentNameUpdated {
  event: 'agent:name_updated';
  session_id: string;
  seq: number;
  data: { session_id: string; name: string };
}

export interface WsAgentGroupMetaUpdated {
  event: 'agent:group_meta_updated';
  session_id: string;
  seq: number;
  data: { session_id: string; group_id: string; name: string; svg: string; is_refined: boolean };
}

export interface WsAgentTurnLabel {
  event: 'agent:turn_label';
  session_id: string;
  seq: number;
  data: { session_id: string; turn_id: string; label: string };
}

/** Session lifecycle transition ("just closed"); replay_to strips this from resume replays
 * on purpose (see ws_manager.p_strip_replayed_closes) so it is never re-delivered stale. */
export interface WsAgentClosed {
  event: 'agent:closed';
  session_id: string;
  seq: number;
  data: {
    session_id: string;
    status: string;
    name: string;
    model: string;
    mode: string;
    created_at: string | null;
    closed_at: string | null;
    cost_usd: number;
    // Same AGT-2 fix as WsAgentSessionSnapshot.dashboard_id above -- see that comment.
    dashboard_id?: string | null;
  };
}

export interface WsAgentAppDepsChanged {
  event: 'agent:app_deps_changed';
  session_id: string;
  seq: number;
  data: { session_id: string };
}

/** Discriminated union of every message shape the backend can send over
 * `/ws/agents/{session_id}`. Discriminate on `event`, then narrow `agent:status` further
 * by the presence of `data.session` (see WsAgentStatusFull / WsAgentStatusLite). */
export type AgentWsServerEvent =
  | WsServerHello
  | WsServerPong
  | WsAgentGapDetected
  | WsAgentStatusFull
  | WsAgentStatusLite
  | WsAgentMessageEvent
  | WsAgentStreamStart
  | WsAgentStreamDelta
  | WsAgentStreamEnd
  | WsAgentApprovalRequest
  | WsAgentQueued
  | WsAgentAdmitted
  | WsAgentContextRecovered
  | WsAgentCostUpdate
  | WsAgentContextUpdate
  | WsAgentContextStatus
  | WsAgentContextOverflow
  | WsAgentRateLimited
  | WsAgentAuthError
  | WsAgentOutOfTokens
  | WsAgentMcpSuggestions
  | WsAgentBranchCreated
  | WsAgentBranchSwitched
  | WsAgentNameUpdated
  | WsAgentGroupMetaUpdated
  | WsAgentTurnLabel
  | WsAgentClosed
  | WsAgentAppDepsChanged;

// ---- Client -> server frames (documented for completeness; not part of CTR-2's gate) ----

export type AgentWsClientEvent =
  | { event: 'client:hello'; data: { session_id: string; connection_uuid: string; last_seq: number } }
  | { event: 'client:ping'; data: { nonce: string } }
  | {
      event: 'agent:send_message';
      data: {
        session_id: string;
        prompt: string;
        mode?: string;
        model?: string;
        provider?: string;
        images?: Array<{ data: string; media_type: string }>;
      };
    }
  | { event: 'agent:approval_response'; data: { request_id: string; behavior: 'allow' | 'deny'; message?: string } }
  | { event: 'agent:stop'; data: { session_id: string } };
