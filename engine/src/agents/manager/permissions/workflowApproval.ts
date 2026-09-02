// engine/src/agents/manager/permissions/workflowApproval.ts -- AGT-5, a port of
// backend/apps/agents/manager/permissions/workflow_approval.py: per-session workflow approval
// memory + the gate's resolve-ask helper. The workflow executor pushes context in (keyed by
// session id) so the permission gates can reuse a prior allow/deny instead of prompting, and so an
// unattended fire fails fast instead of parking for ten minutes. The workflow EXECUTOR itself
// (whatever calls setWorkflowApprovalMemory in anger) is SUB-7's territory (workflows, "largest
// route count" per the WORK QUEUE) -- not ported here; this file is the gate-side half only,
// exactly mirroring the Python module's own scope (it also just stores what's pushed in).

import type { ApprovalDecision } from '../../core/wsManager';
import type { HookContext } from '../streaming/hookContext';
import { requestUserApproval, type PolicyStoreDeps } from './decision';

export interface WorkflowApprovalMemory {
  decisions: Record<string, string>; // workflow-level: tool -> "allow"/"deny"
  step_usage: Record<string, Record<string, boolean>>; // per-step record: step_id -> {tool: approved}
  remember: ((toolName: string, behavior: string) => void) | null; // persist a workflow-level decision to disk
  ask_timeout_ms: number;
  // The executor bumps this as it advances steps so the gate can record which tools each step
  // touched. undefined on test runs that don't thread it.
  current_step_id?: string;
}

const approvalMemory = new Map<string, WorkflowApprovalMemory>();

export function setWorkflowApprovalMemory(
  sessionId: string,
  opts: {
    decisions: Record<string, string>;
    step_usage: Record<string, Record<string, boolean>>;
    remember: ((toolName: string, behavior: string) => void) | null;
    ask_timeout_ms: number;
  },
): void {
  approvalMemory.set(sessionId, { ...opts });
}

export function clearWorkflowApprovalMemory(sessionId: string): void {
  approvalMemory.delete(sessionId);
}

export function setWorkflowApprovalStep(sessionId: string, stepId: string | undefined): void {
  const mem = approvalMemory.get(sessionId);
  if (mem) mem.current_step_id = stepId;
}

export function getWorkflowStepUsage(sessionId: string): Record<string, Record<string, boolean>> {
  return approvalMemory.get(sessionId)?.step_usage ?? {};
}

export function isClaudeScheduleSkill(toolName: string, toolInput: unknown): boolean {
  if (toolName !== 'Skill' || typeof toolInput !== 'object' || toolInput === null || Array.isArray(toolInput)) return false;
  const skill = (toolInput as Record<string, unknown>).skill;
  return String(skill ?? '').trim().toLowerCase() === 'schedule';
}

export function noteToolUsed(sessionId: string, toolName: string, approved: boolean): void {
  const mem = approvalMemory.get(sessionId);
  if (!mem || mem.current_step_id === undefined) return;
  const usage = mem.step_usage[mem.current_step_id] ?? {};
  usage[toolName] = approved;
  mem.step_usage[mem.current_step_id] = usage;
}

/** Resolve an 'ask' policy. On a workflow run, reuse a remembered decision (this step first, then
 * the workflow-level fallback) instead of prompting, and persist any fresh non-sensitive answer so
 * later fires don't re-ask. Shared by both gates so they can't disagree. */
export async function resolveAsk(
  ctx: HookContext,
  toolName: string,
  toolInput: unknown,
  sensitivePattern: string | undefined,
  deps: PolicyStoreDeps = {},
): Promise<ApprovalDecision> {
  const mem = approvalMemory.get(ctx.sessionId);
  const rememberable = mem !== undefined && sensitivePattern === undefined && toolName !== 'AskUserQuestion';
  if (rememberable && mem) {
    const sid = mem.current_step_id;
    const priorStep = sid !== undefined ? mem.step_usage[sid]?.[toolName] : undefined;
    if (priorStep === true) return { behavior: 'allow' };
    if (priorStep === false) return { behavior: 'deny', message: 'Denied by a remembered workflow permission' };
    const prior = mem.decisions[toolName];
    if (prior === 'allow') {
      noteToolUsed(ctx.sessionId, toolName, true);
      return { behavior: 'allow' };
    }
    if (prior === 'deny') {
      noteToolUsed(ctx.sessionId, toolName, false);
      return { behavior: 'deny', message: 'Denied by a remembered workflow permission' };
    }
  }
  const timeoutMs = mem ? mem.ask_timeout_ms : 600_000;
  const decision = await requestUserApproval(ctx.session, ctx.sessionId, toolName, toolInput, ctx.builtinPerms, {
    sensitivePattern,
    timeoutMs,
    ...deps,
  });
  if (rememberable && mem && (decision.behavior === 'allow' || decision.behavior === 'deny')) {
    const behavior = decision.behavior;
    mem.decisions[toolName] = behavior;
    noteToolUsed(ctx.sessionId, toolName, behavior === 'allow');
    if (mem.remember) {
      try {
        mem.remember(toolName, behavior);
      } catch {
        // Best-effort, mirrors the Python original's swallow-and-log.
      }
    }
  }
  return decision;
}
