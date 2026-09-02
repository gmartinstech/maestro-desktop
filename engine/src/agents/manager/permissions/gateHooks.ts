// engine/src/agents/manager/permissions/gateHooks.ts -- AGT-5, a port of
// backend/apps/agents/manager/permissions/gate_hooks.py: the SDK permission/pre-tool hooks.
// canUseTool answers the SDK's permission callback; preToolHook runs before each tool call and
// also carries the two MCP loop-breakers (ToolSearch-thrash redirect + one-shot connect offer).
// Both operate on a HookContext passed by reference, so the shared counters survive across calls.
//
// Deliberate scope cut vs. the Python original: the mid-run "connect this MCP" suggestion card
// (the `mcp_preflight.offer_for_gated_server`/`run_preflight` calls gated behind
// `ctx.mcpOfferSent`) is NOT ported. That's a UX nicety layered on TOP of the loop-breaker's actual
// safety behavior (the deny + redirect message still fires exactly as it should).
// `mcp_preflight.py` itself lives under backend/apps/agents/core (not backend/apps/mcp_registry or
// backend/apps/tools_lib), so it's out of THIS ticket's own file scope even though it consumes
// tools_lib -- mcp_registry/tools_lib (SUB-4) is ported as of this ticket. Whoever ports
// mcp_preflight.py can now build directly on apps/toolsLib/{store,toolCatalog}.ts's real exports
// and wire the suggestion side-effect back in here, gated the same way.
//
// `effectivePolicy` is now a full port of decision.py's `effective_policy`: it resolves through
// tools_lib's `resolvePolicySlot` (builtin vs. MCP-sub-tool storage, apps/toolsLib/store.ts, SUB-4)
// so the read slot matches the write slot `decision.ts`'s `setToolPolicy` writes to exactly -- see
// store.ts's own header for the "Always approve acting like a one-time accept" bug this prevents.
// `defaultGatedMcpServerNames` is likewise now a full call-through to tool_catalog.py's real port
// (apps/toolsLib/toolCatalog.ts's `gatedMcpServerNames`).

import type { HookContext } from '../streaming/hookContext';
import { maybeOverridePolicy as defaultMaybeOverridePolicy, type TrustedPathsLoader } from './pathGate';
import { resolveAsk as defaultResolveAsk, isClaudeScheduleSkill, noteToolUsed } from './workflowApproval';
import { toolsearchLoopRedirect as defaultToolsearchLoopRedirect, TOOLSEARCH_LOOP_THRESHOLD } from '../prompt/promptContext';
import { gatedMcpServerNames as realGatedMcpServerNames } from '../../../apps/toolsLib/toolCatalog';
import { loadAllTools, resolvePolicySlot } from '../../../apps/toolsLib/store';
import type { PolicyStoreDeps } from './decision';

/** Mirrors `effective_policy`: 'always_allow', 'deny', or 'ask' for any tool, keyed through the
 * shared slot resolver so the read slot matches the write slot exactly. `policyDefaults` is the
 * per-session in-memory default map (`_DEFAULTS` in the Python original) consulted only for the
 * builtin-store case with nothing persisted yet. */
export function effectivePolicy(toolName: string, builtinPerms: Record<string, string>, policyDefaults: Record<string, string>): string {
  const tools = loadAllTools();
  const slot = resolvePolicySlot(toolName, tools);
  if (slot.store === 'builtin') {
    const key = slot.key as string;
    return builtinPerms[key] ?? policyDefaults[key] ?? 'always_allow';
  }
  if (slot.key !== null) {
    const t = tools.find((tt) => tt.id === slot.key);
    if (t) return ((t.tool_permissions ?? {})[slot.action as string] as string | undefined) ?? 'ask';
  }
  return policyDefaults[toolName] ?? 'always_allow';
}

/** Full call-through to tool_catalog.py's `gated_mcp_server_names` port. */
export function defaultGatedMcpServerNames(allowedTools: string[], activeMcps: string[] | null | undefined): string[] {
  return realGatedMcpServerNames(allowedTools, activeMcps);
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export interface GateHooksDeps extends PolicyStoreDeps {
  maybeOverridePolicy?: (policy: string, toolName: string, toolInput: unknown, loadTrustedSensitivePaths?: TrustedPathsLoader) => [string, string | undefined];
  resolveAsk?: typeof defaultResolveAsk;
  gatedMcpServerNames?: (allowedTools: string[], activeMcps: string[] | null | undefined) => string[];
  toolsearchLoopRedirect?: typeof defaultToolsearchLoopRedirect;
  effectivePolicy?: typeof effectivePolicy;
  loadTrustedSensitivePaths?: TrustedPathsLoader;
}

/** Mirrors `can_use_tool`: the SDK's permission callback. */
export async function canUseTool(
  ctx: HookContext,
  toolName: string,
  inputData: unknown,
  deps: GateHooksDeps = {},
): Promise<PermissionResult> {
  const maybeOverride = deps.maybeOverridePolicy ?? defaultMaybeOverridePolicy;
  const resolveAsk = deps.resolveAsk ?? defaultResolveAsk;
  const policyOf = deps.effectivePolicy ?? effectivePolicy;

  if (isClaudeScheduleSkill(toolName, inputData)) {
    noteToolUsed(ctx.sessionId, toolName, false);
    return { behavior: 'deny', message: 'Use the maestro-schedule MCP tools instead of Claude\'s internal schedule skill.' };
  }
  let sensitivePattern: string | undefined;
  if (toolName !== 'AskUserQuestion') {
    let policy: string;
    [policy, sensitivePattern] = maybeOverride(policyOf(toolName, ctx.builtinPerms, ctx.policyDefaults), toolName, inputData, deps.loadTrustedSensitivePaths);
    if (policy === 'always_allow') {
      noteToolUsed(ctx.sessionId, toolName, true);
      return { behavior: 'allow', updatedInput: (inputData as Record<string, unknown>) ?? undefined };
    }
    if (policy === 'deny') {
      noteToolUsed(ctx.sessionId, toolName, false);
      return { behavior: 'deny', message: 'Tool denied by permission policy' };
    }
  }

  const decision = await resolveAsk(ctx, toolName, inputData, sensitivePattern, deps);
  if (decision.behavior === 'allow') {
    return { behavior: 'allow', updatedInput: decision.updated_input ?? (inputData as Record<string, unknown>) ?? undefined };
  }
  return { behavior: 'deny', message: decision.message || 'User denied this action' };
}

export type PreToolHookOutput = Record<string, never> | {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
  };
};

/** Mirrors `pre_tool_hook`: runs before each tool call, carries the ToolSearch loop-breaker and the
 * MCPSearch/MCPList connect-offer trigger point (the offer itself is a deliberate scope cut, see
 * this file's header), then re-applies the same policy resolution as canUseTool. */
export async function preToolHook(
  ctx: HookContext,
  inputData: { tool_name?: string; hook_event_name?: string; tool_input?: unknown },
  toolUseId: string | undefined,
  deps: GateHooksDeps = {},
): Promise<PreToolHookOutput> {
  const gatedMcpServerNames = deps.gatedMcpServerNames ?? defaultGatedMcpServerNames;
  const toolsearchLoopRedirect = deps.toolsearchLoopRedirect ?? defaultToolsearchLoopRedirect;
  const maybeOverride = deps.maybeOverridePolicy ?? defaultMaybeOverridePolicy;
  const resolveAsk = deps.resolveAsk ?? defaultResolveAsk;
  const policyOf = deps.effectivePolicy ?? effectivePolicy;

  const toolName = inputData.tool_name ?? '';
  const hookEvent = inputData.hook_event_name ?? 'PreToolUse';

  // ToolSearch loop-breaker. Gated MCP servers are withheld from the SDK until MCPActivate, so the
  // CLI's native ToolSearch can never find them; small models thrash (empty ToolSearch, retry) for
  // minutes until the user pauses. Let the first couple through, then redirect to the gate. Any
  // non-ToolSearch call is real progress, so the counter resets.
  if (toolName === 'ToolSearch') {
    ctx.tsLoopCount += 1;
    if (ctx.tsLoopCount >= TOOLSEARCH_LOOP_THRESHOLD) {
      const gated = gatedMcpServerNames(ctx.session.allowed_tools, ctx.session.active_mcps);
      const reason = toolsearchLoopRedirect(ctx.tsLoopCount, gated);
      if (reason) {
        return {
          hookSpecificOutput: { hookEventName: hookEvent, permissionDecision: 'deny', permissionDecisionReason: reason },
        };
      }
    }
  } else {
    ctx.tsLoopCount = 0;
  }

  // MCPSearch/MCPList connect-offer trigger point is intentionally a no-op here -- see this file's
  // header for why (mcp_preflight is SUB-4/mcp_registry territory, not yet in the engine).

  if (toolName && toolName !== 'AskUserQuestion') {
    const toolInput = inputData.tool_input ?? {};
    if (isClaudeScheduleSkill(toolName, toolInput)) {
      noteToolUsed(ctx.sessionId, toolName, false);
      return {
        hookSpecificOutput: {
          hookEventName: hookEvent,
          permissionDecision: 'deny',
          permissionDecisionReason: 'Use the maestro-schedule MCP tools instead of Claude\'s internal schedule skill.',
        },
      };
    }
    const [policy, sensitivePattern] = maybeOverride(policyOf(toolName, ctx.builtinPerms, ctx.policyDefaults), toolName, toolInput, deps.loadTrustedSensitivePaths);

    if (policy === 'always_allow') noteToolUsed(ctx.sessionId, toolName, true);

    if (policy === 'deny') {
      noteToolUsed(ctx.sessionId, toolName, false);
      return {
        hookSpecificOutput: { hookEventName: hookEvent, permissionDecision: 'deny', permissionDecisionReason: 'Tool denied by permission policy' },
      };
    }

    if (policy === 'ask') {
      const decision = await resolveAsk(ctx, toolName, toolInput, sensitivePattern, deps);
      if (decision.behavior === 'allow') {
        if (toolUseId) ctx.toolStartTimes.set(toolUseId, Date.now());
        return { hookSpecificOutput: { hookEventName: hookEvent, permissionDecision: 'allow' } };
      }
      return {
        hookSpecificOutput: {
          hookEventName: hookEvent,
          permissionDecision: 'deny',
          permissionDecisionReason: decision.message || 'User denied this action',
        },
      };
    }
  }

  if (toolUseId) ctx.toolStartTimes.set(toolUseId, Date.now());
  return {};
}
