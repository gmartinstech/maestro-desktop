// engine/src/apps/service/sessions.ts -- ENG-7's port of backend/apps/service/service.py's
// usage_summary()/cost_breakdown() read path.
//
// SCOPED GAP (flagged, not an oversight): service.py's usage_summary() merges TWO sources --
// persisted session JSON files under SESSIONS_DIR, AND agent_manager.get_all_sessions()'s live
// in-memory sessions (a turn still running, not yet flushed to disk). agent_manager is
// backend/apps/agents/* (~22k LOC, AGT phase's job, not this ticket's file list). This port reads
// ONLY the persisted-file source, so a session mid-turn at call time is undercounted until AGT
// lands agent_manager natively -- same shape of gap SUB-1..SUB-10 accept elsewhere in this
// migration for subsystems that read another not-yet-ported subsystem's live state. Similarly,
// 9Router's cost/token/request stats (get_usage_stats()/is_running(), backend/apps/nine_router/*)
// aren't available here -- that's ENG-6, a sibling ticket in this same phase, not yet assumed
// landed -- so nine_router_available is always false and cost_by_model/cost_by_provider/
// total_requests/total_prompt_tokens/total_completion_tokens stay at their zero defaults, exactly
// like service.py's own "nine_router_stats is None" branch already handles gracefully.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'sessions');
}

interface RawSession {
  agent_active_ms?: number;
  cost_usd?: number;
  tokens?: { input?: number; output?: number };
  messages?: Array<{ role?: string; content?: unknown }>;
  model?: string;
  provider?: string;
  status?: string;
  tool_latencies?: Record<string, { count?: number }>;
  created_at?: string;
  closed_at?: string;
}

export function loadAllSessions(env: NodeJS.ProcessEnv = process.env): RawSession[] {
  const dir = sessionsDir(env);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: RawSession[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as RawSession);
    } catch {
      // Corrupt/partially-written session file; skip it rather than fail the whole summary.
    }
  }
  return out;
}

// "Real" = actually ran. Empty draft/abandoned sessions (no assistant turn, no tokens, no active
// time) otherwise inflate the count and drag every average toward zero -- mirrors service.py's
// p_is_real exactly.
function isReal(s: RawSession): boolean {
  if ((s.agent_active_ms ?? 0) > 0 || (s.cost_usd ?? 0) > 0) return true;
  const tk = s.tokens ?? {};
  if ((tk.input ?? 0) > 0 || (tk.output ?? 0) > 0) return true;
  return (s.messages ?? []).some((m) => m.role === 'assistant');
}

function topN(counts: Map<string, number>, n: number): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function parseIsoSeconds(iso: string): number | null {
  // Mirrors service.py's datetime.fromisoformat(s[:19]) -- truncate to the whitespace/timezone-free
  // "YYYY-MM-DDTHH:MM:SS" prefix before parsing, same tolerance for a trailing offset/fraction.
  const t = Date.parse(iso.slice(0, 19));
  return Number.isNaN(t) ? null : t;
}

export interface UsageSummary {
  total_sessions: number;
  total_cost_usd: number;
  total_messages: number;
  total_tool_calls: number;
  total_run_seconds: number;
  avg_duration_seconds: number;
  avg_cost_per_session: number;
  completion_rate: number;
  models_used: Record<string, number>;
  providers_used: Record<string, number>;
  top_tools: Record<string, number>;
  status_breakdown: Record<string, number>;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  cost_by_model: Record<string, unknown>;
  cost_by_provider: Record<string, unknown>;
  cost_source: 'sdk' | 'none';
  nine_router_available: false;
  total_requests: number;
}

export function computeUsageSummary(env: NodeJS.ProcessEnv = process.env): UsageSummary {
  const sessions = loadAllSessions(env).filter(isReal);

  const totalSessions = sessions.length;
  let totalCost = 0;
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalRunSeconds = 0;
  let timedSessions = 0;
  const modelCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const s of sessions) {
    totalCost += s.cost_usd ?? 0;
    const messages = s.messages ?? [];
    totalMessages += messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
    bump(modelCounts, s.model ?? 'unknown');
    bump(providerCounts, s.provider ?? 'anthropic');
    bump(statusCounts, s.status ?? 'unknown');

    // Tool calls: tool_latencies carries authoritative per-tool counts; older sessions only have
    // sparse tool_call messages. Take whichever source recorded more, per session -- mirrors
    // service.py's identical "never undercount what's on record" tie-break.
    const latCounts = new Map<string, number>();
    for (const [tool, d] of Object.entries(s.tool_latencies ?? {})) {
      const c = d?.count ?? 0;
      if (tool && c) bump(latCounts, tool, c);
    }
    const msgCounts = new Map<string, number>();
    for (const m of messages) {
      if (m.role === 'tool_call') {
        const content = m.content as { tool?: string } | undefined;
        bump(msgCounts, (content && typeof content === 'object' && content.tool) || 'tool');
      }
    }
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const chosen = sum(latCounts) >= sum(msgCounts) ? latCounts : msgCounts;
    for (const [tool, c] of chosen) bump(toolCounts, tool, c);
    totalToolCalls += sum(chosen);

    // Run time: real agent-active time when tracked, else session wall-clock as a rough proxy.
    let runS = (s.agent_active_ms ?? 0) / 1000;
    if (runS <= 0 && s.created_at && s.closed_at) {
      const created = parseIsoSeconds(s.created_at);
      const closed = parseIsoSeconds(s.closed_at);
      if (created !== null && closed !== null) runS = Math.max(0, (closed - created) / 1000);
    }
    if (runS > 0) {
      totalRunSeconds += runS;
      timedSessions += 1;
    }
  }

  const avgDuration = timedSessions > 0 ? totalRunSeconds / timedSessions : 0;
  const completed = statusCounts.get('completed') ?? 0;
  const completionRate = totalSessions > 0 ? completed / totalSessions : 0;
  const avgCost = totalSessions > 0 ? totalCost / totalSessions : 0;

  return {
    total_sessions: totalSessions,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
    total_messages: totalMessages,
    total_tool_calls: totalToolCalls,
    total_run_seconds: Math.round(totalRunSeconds * 10) / 10,
    avg_duration_seconds: Math.round(avgDuration * 10) / 10,
    avg_cost_per_session: Math.round(avgCost * 10000) / 10000,
    completion_rate: Math.round(completionRate * 1000) / 1000,
    models_used: topN(modelCounts, 10),
    providers_used: topN(providerCounts, 10),
    top_tools: topN(toolCounts, 15),
    status_breakdown: Object.fromEntries(statusCounts),
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    cost_by_model: {},
    cost_by_provider: {},
    cost_source: totalCost > 0 ? 'sdk' : 'none',
    nine_router_available: false,
    total_requests: 0,
  };
}

export interface CostBreakdown {
  available: false;
  by_model: Record<string, unknown>;
  by_provider: Record<string, unknown>;
}

// Always "unavailable" -- see this file's own header on why 9Router stats aren't reachable yet
// from this ticket's scope. Matches service.py's own graceful shape when 9Router isn't running.
export function computeCostBreakdown(): CostBreakdown {
  return { available: false, by_model: {}, by_provider: {} };
}
