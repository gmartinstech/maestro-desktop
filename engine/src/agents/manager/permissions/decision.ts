// engine/src/agents/manager/permissions/decision.ts -- AGT-5, now a FULL port of
// backend/apps/agents/manager/permissions/decision.py: the HITL approval flow
// (requestUserApproval), which surfaces the approval card over WS and waits for the user's
// decision, PLUS `effective_policy`/`set_tool_policy`'s real disk-persisted behavior. Both resolve/
// persist a tool's policy through tools_lib's `resolvePolicySlot`/`loadAllTools`/
// `loadBuiltinPermissions`/`saveBuiltinPermissions`/`saveTool` (apps/toolsLib/store.ts, SUB-4,
// ported by this same ticket) -- `setToolPolicy`/`persistTrustedPattern` below are the real
// defaults now, not the placeholder no-ops this file used to fall back on; still injectable
// (`PolicyStoreDeps`) so a test can observe the call without touching disk.

import { randomUUID } from 'node:crypto';
import type { AgentSession, ApprovalRequest } from '../../core/models';
import { wsManager, type ApprovalDecision } from '../../core/wsManager';
import { describeSensitivePattern } from './pathGate';
import { loadAllTools, loadBuiltinPermissions, loadTrustedSensitivePaths, resolvePolicySlot, saveBuiltinPermissions, saveTool, saveTrustedSensitivePaths } from '../../../apps/toolsLib/store';

/** Mirrors `set_tool_policy`: persist `policy` into the SAME slot `effectivePolicy` (gateHooks.ts)
 * reads AND update the live in-memory snapshot, so an 'Always approve' takes effect immediately. */
export function setToolPolicyDefault(toolName: string, policy: string, builtinPerms: Record<string, string>): void {
  const tools = loadAllTools();
  const slot = resolvePolicySlot(toolName, tools);
  if (slot.store === 'builtin') {
    const key = slot.key as string;
    builtinPerms[key] = policy;
    const perms = loadBuiltinPermissions();
    perms[key] = policy;
    saveBuiltinPermissions(perms);
    return;
  }
  if (slot.key !== null) {
    const t = tools.find((tt) => tt.id === slot.key);
    if (t) {
      (t.tool_permissions as Record<string, unknown>)[slot.action as string] = policy;
      saveTool(t);
    }
  }
}

/** Mirrors the trusted-sensitive-path append `request_user_approval` does inline. */
export function persistTrustedPatternDefault(pattern: string): void {
  const existing = loadTrustedSensitivePaths();
  if (!existing.includes(pattern)) {
    existing.push(pattern);
    saveTrustedSensitivePaths(existing);
  }
}

export interface PolicyStoreDeps {
  /** Persist `policy` as the tool's policy for future runs. Defaults to the real disk-persisted
   * implementation above. */
  setToolPolicy?: (toolName: string, policy: string) => void;
  /** Persist `pattern` as a trusted sensitive-path so future prompts for it skip the modal.
   * Defaults to the real disk-persisted implementation above. */
  persistTrustedPattern?: (pattern: string) => void;
}

export interface RequestUserApprovalOptions extends PolicyStoreDeps {
  sensitivePattern?: string;
  timeoutMs?: number;
}

/** Send an approval request over WS and wait for the user's decision. Mirrors
 * `request_user_approval` field-for-field, including the pending_approvals bookkeeping and the
 * status flip to/from 'waiting_approval'. */
export async function requestUserApproval(
  session: AgentSession,
  sessionId: string,
  toolName: string,
  toolInput: unknown,
  builtinPerms: Record<string, string>,
  options: RequestUserApprovalOptions = {},
): Promise<ApprovalDecision> {
  const safeInput = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : {};
  const requestId = randomUUID().replace(/-/g, '');
  let label: string | undefined;
  let why: string | undefined;
  if (options.sensitivePattern) {
    const described = describeSensitivePattern(options.sensitivePattern);
    if (described) [label, why] = described;
  }
  const createdAt = new Date();
  const approvalReq: ApprovalRequest = {
    id: requestId,
    session_id: sessionId,
    tool_name: toolName,
    tool_input: safeInput,
    created_at: createdAt.toISOString(),
    sensitive_pattern: options.sensitivePattern ?? null,
    sensitive_label: label ?? null,
    sensitive_why: why ?? null,
  };
  session.pending_approvals.push(approvalReq);
  session.status = 'waiting_approval';
  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: 'waiting_approval' } as never);

  const decision = await wsManager.sendApprovalRequest(sessionId, requestId, toolName, safeInput, {
    sensitivePattern: options.sensitivePattern,
    sensitiveLabel: label,
    sensitiveWhy: why,
    timeoutMs: options.timeoutMs ?? 600_000,
  });

  // Persist a trusted sensitive-path so later prompts for the same pattern skip the modal.
  if (decision.behavior === 'allow' && decision.trust_pattern && options.sensitivePattern) {
    try {
      (options.persistTrustedPattern ?? persistTrustedPatternDefault)(options.sensitivePattern);
    } catch {
      // Best-effort, mirrors the Python original's swallow-and-log.
    }
  }
  // "Always approve": persist the tool policy (the sensitive/catastrophic guards still re-fire).
  // NOTE: this does NOT unconditionally write `builtinPerms[toolName] = 'always_allow'` -- that
  // would be wrong for an MCP sub-tool name (`mcp__<server>__<action>`), whose policy is keyed by
  // the RESOLVED slot (the owning tool's id + action), never the raw dotted tool name; writing the
  // raw name into builtinPerms is exactly the read/write key mismatch
  // test_tool_policy_slot.py's own header describes ("Always approve" acting like a one-time
  // accept). `setToolPolicyDefault` (or an injected override) is the sole writer, same as the
  // Python original's `set_tool_policy` -- it mutates `builtinPerms` itself for the builtin-store
  // case, and persists to the owning tool's file for the mcp-store case (no in-memory mutation
  // needed there: `effectivePolicy`'s mcp branch re-reads `loadAllTools()` from disk every call).
  if (decision.behavior === 'allow' && decision.set_always_allow) {
    try {
      const setToolPolicy = options.setToolPolicy ?? ((name: string, policy: string) => setToolPolicyDefault(name, policy, builtinPerms));
      setToolPolicy(toolName, 'always_allow');
    } catch {
      // Best-effort, mirrors the Python original's swallow-and-log.
    }
  }
  const approvalLatencyMs = Date.now() - createdAt.getTime();
  try {
    session.approval_decisions.push({ tool: toolName, behavior: decision.behavior, decision_ms: approvalLatencyMs });
  } catch {
    // Mirrors the Python original's bare except: pass.
  }
  session.pending_approvals = session.pending_approvals.filter((a) => a.id !== requestId);
  session.status = 'running';
  await wsManager.sendToSession(sessionId, 'agent:status', { session_id: sessionId, status: 'running' } as never);
  return decision;
}
