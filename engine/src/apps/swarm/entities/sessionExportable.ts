// engine/src/apps/swarm/entities/sessionExportable.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/entities/SessionExportable.py.
//
// An agent card on a shared dashboard. We carry the recipe (name, model, mode, system prompt,
// allowed tools) AND the chat transcript so a shared agent arrives with the conversation that
// produced it -- that's the whole point of sharing one. The transcript rides through the same
// scrub layer as every payload (closure.ts's p_assemble calls scrubPayload on every serialize()
// result), so any secret-shaped string in it is redacted before it leaves. We still DROP runtime
// state, costs, the worktree path, and active_mcps: importing must never silently grant tool
// access, per the gate. Its MCP/actions, provider, and built-in mode become import requirements so
// the importer is walked through enabling them. The dashboard re-points dashboard_id after import.
//
// load() reads live in-memory sessions first via AgentManager (mirroring agent_manager.sessions),
// then falls back to the on-disk file -- same order duplicate_session used in the Python original.
// AgentManager.ts's own header notes there is no persistence layer yet for a CLOSED session's
// live-turn state (that gap is AGT's, not this ticket's to reopen) -- this only affects a session
// still actively mid-turn at export time, which falls back correctly to whatever was last flushed
// to disk, same graceful-degradation shape service.py's own usage_summary() port already accepts
// (see apps/service/sessions.ts's header) for the identical live-vs-disk seam.

import { randomUUID } from 'node:crypto';
import { agentManager } from '../../../agents/AgentManager';
import { migratePickerValue } from '../../../settings/migrations';
import { deleteSessionFile, loadSessionData, saveSessionFile } from '../../../agents/manager/session/sessionFileStore';
import { depRef, type DepRef, type Exportable, type ExportContext } from '../exportable';
import { EntityType, RequirementKind, makeRequirement, type Requirement } from '../models';
import { P_BUILTIN_MODES } from './modeExportable';

// Transcript fields ride along so the shared agent keeps its history; ids inside (message ids,
// branch ids, their parent/fork refs) are self-consistent within the one session file, so they
// carry verbatim with no remap.
const P_KEEP: readonly string[] = [
  'name', 'provider', 'model', 'mode', 'system_prompt', 'allowed_tools',
  'max_turns', 'thinking_level',
  'messages', 'branches', 'active_branch_id', 'tool_group_meta',
];

function sessionAsPlainRecord(session: unknown): Record<string, unknown> {
  // AgentManager's in-memory AgentSession isn't necessarily a plain-JSON-safe object (may carry
  // class instances / Maps); a JSON round-trip mirrors model_dump(mode="json")'s own
  // "serialize to plain JSON-shaped data" contract without this file needing to know
  // AgentSession's exact class shape.
  return JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
}

export class SessionExportable implements Exportable {
  readonly type = EntityType.session;

  constructor(
    public readonly localId: string,
    public readonly name: string,
    private readonly pData: Record<string, unknown>,
  ) {}

  static load(localId: string): SessionExportable | null {
    const live = agentManager.sessions.get(localId);
    const d = live !== undefined ? sessionAsPlainRecord(live) : loadSessionData(localId);
    if (d === null || d === undefined) return null;
    return new SessionExportable(localId, (d.name as string | undefined) || 'Agent', d);
  }

  serialize(_ctx: ExportContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of P_KEEP) {
      if (k in this.pData) out[k] = this.pData[k];
    }
    return out;
  }

  files(): Record<string, Buffer> {
    return {};
  }

  dependencies(): DepRef[] {
    const mode = this.pData.mode as string | undefined;
    if (mode && !P_BUILTIN_MODES.has(mode)) {
      return [depRef(EntityType.mode, mode, 'uses_mode')];
    }
    return [];
  }

  requirements(): Requirement[] {
    const reqs: Requirement[] = [];
    const activeMcps = (this.pData.active_mcps as string[] | undefined) ?? [];
    for (const mcp of activeMcps) {
      reqs.push(makeRequirement({
        kind: RequirementKind.mcp_action, key: mcp, label: mcp,
        detail: 'An agent here uses this action.',
      }));
    }
    const mode = (this.pData.mode as string | undefined) || 'agent';
    if (P_BUILTIN_MODES.has(mode) && mode !== 'agent') {
      reqs.push(makeRequirement({
        kind: RequirementKind.builtin_mode, key: mode, label: `${mode} mode`,
        detail: 'A built-in mode an agent runs in.',
      }));
    }
    const provider = (this.pData.provider as string | undefined) || 'anthropic';
    reqs.push(makeRequirement({
      kind: RequirementKind.api_key, key: provider, label: `A ${provider} model`,
      detail: 'Set up this provider so the agents can run.',
    }));
    return reqs;
  }

  static import_(payload: Record<string, unknown>, _files: Record<string, Buffer>): string {
    const sid = randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    // Older bundles (made before transcripts were carried) have no messages; fall back to a
    // single empty main branch so the imported agent is valid.
    const branches = (payload.branches as Record<string, unknown> | undefined) ?? {
      main: { id: 'main', parent_branch_id: null, fork_point_message_id: null, created_at: now },
    };
    let activeBranchId = (payload.active_branch_id as string | undefined) || 'main';
    if (!(activeBranchId in branches)) {
      activeBranchId = Object.keys(branches)[0] ?? 'main';
    }
    const doc: Record<string, unknown> = {
      id: sid,
      name: payload.name || 'Agent',
      status: 'completed',
      provider: payload.provider || 'anthropic',
      // A bundle exported before the provedor-ia -> maestro slug rename can still carry the stale
      // picker value; rewrite it on the way in so the imported session is never stale on disk.
      model: migratePickerValue(String(payload.model || 'sonnet')),
      mode: payload.mode || 'agent',
      system_prompt: payload.system_prompt ?? null,
      allowed_tools: payload.allowed_tools ?? [],
      max_turns: payload.max_turns ?? null,
      thinking_level: payload.thinking_level || 'auto',
      messages: payload.messages ?? [],
      branches,
      active_branch_id: activeBranchId,
      tool_group_meta: payload.tool_group_meta ?? {},
      active_mcps: [],
      dashboard_id: null, // the dashboard import re-points this
      browser_id: null,
      parent_session_id: null,
      created_at: now,
      closed_at: now,
    };
    saveSessionFile(sid, doc);
    return sid;
  }

  static rollback(localId: string): void {
    deleteSessionFile(localId);
  }
}
