// engine/src/apps/toolsLib/toolCatalog.ts -- SUB-4, a full port of
// backend/apps/agents/manager/prompt/tool_catalog.py: the SDK allowedTools/gated-server surface
// built from BUILTIN_TOOLS + installed MCP tools. Real implementation of the functions
// promptContext.ts/composeTurnSystemPrompt.ts/gateHooks.ts previously stubbed out pending this
// ticket -- see each file's own header for the exact call sites now wired to these exports.

import { sanitizeServerName } from './mcpConfig';
import { loadAllTools, loadBuiltinPermissions } from './store';
import type { ToolDefinition } from './models';

// FULL_TOOLS byte-for-byte, including order, from tool_catalog.py.
export const FULL_TOOLS: readonly string[] = [
  'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'AskUserQuestion',
  'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree',
  'TaskOutput', 'TaskStop',
  'CronCreate', 'CronList', 'CronDelete',
  'InvokeAgent',
  'Agent',
  // ToolSearch is the loader the CLI uses to expose deferred tool schemas on demand. Must be in the
  // allowedTools whitelist or the model can't call it, which means none of the deferred extended
  // tools become reachable even when the CLI advertises them in the system prompt.
  'ToolSearch',
];

/** Return the set of MCP sub-tool names whose permission is 'deny'. */
export function getDeniedToolNames(tool: ToolDefinition): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(tool.tool_permissions ?? {})) {
    if (!key.startsWith('_') && value === 'deny') out.add(key);
  }
  return out;
}

/** Return all known sub-tool names for an MCP tool (from _tool_descriptions). */
export function getAllKnownToolNames(tool: ToolDefinition): Set<string> {
  const descs = (tool.tool_permissions ?? {})._tool_descriptions as Record<string, unknown> | undefined;
  return new Set(Object.keys(descs ?? {}));
}

/** True when every known sub-tool on this MCP server is set to 'deny'. */
export function isFullyDenied(tool: ToolDefinition): boolean {
  const known = getAllKnownToolNames(tool);
  if (known.size === 0) return false;
  const denied = getDeniedToolNames(tool);
  for (const name of known) {
    if (!denied.has(name)) return false;
  }
  return true;
}

/** FULL_TOOLS + installed MCP tool identifiers (mcp:<tool_name>). Builtin tools set to 'deny' and
 * MCP servers whose every sub-tool is denied are excluded. Zero-arg call reads the real
 * builtin-permissions file and the real on-disk tool set, matching `get_all_tool_names()`'s own
 * signature exactly; both are overridable so a test (or a caller that already has both in hand,
 * e.g. gatedMcpServerNames below) doesn't force a redundant disk read. */
export function getAllToolNames(builtinPerms: Record<string, string> = loadBuiltinPermissions(), tools: readonly ToolDefinition[] = loadAllTools()): string[] {
  const builtinToolNames = FULL_TOOLS.filter((t) => (builtinPerms[t] ?? 'always_allow') !== 'deny');
  const mcpNames = tools
    .filter((t) => t.mcp_config && Object.keys(t.mcp_config).length > 0 && t.enabled && (t.auth_status === 'configured' || t.auth_status === 'connected') && !isFullyDenied(t))
    .map((t) => `mcp:${t.name}`);
  return [...builtinToolNames, ...mcpNames];
}

/** Names of installed MCP servers withheld from the SDK because they're not activated yet, exactly
 * the servers the model sees in the <mcp_servers> block but can't reach via ToolSearch. The only
 * way in is MCPActivate; used to steer a model looping on ToolSearch to the gate. */
export function gatedMcpServerNames(allowedTools: readonly string[], activeMcps: readonly string[] | null | undefined): string[] {
  const activeSet = new Set(activeMcps ?? []);
  const names: string[] = [];
  try {
    const tools = loadAllTools();
    const allNames = getAllToolNames(loadBuiltinPermissions(), tools);
    const allowedIsEverything = allowedTools.length === allNames.length && allowedTools.every((t, i) => t === allNames[i]);
    for (const tool of tools) {
      if (!(tool.mcp_config && Object.keys(tool.mcp_config).length > 0 && tool.enabled && (tool.auth_status === 'configured' || tool.auth_status === 'connected'))) continue;
      const toolRef = `mcp:${tool.name}`;
      if (!allowedTools.includes(toolRef) && !allowedIsEverything) continue;
      if (isFullyDenied(tool)) continue;
      const serverName = sanitizeServerName(tool.name);
      if (!activeSet.has(serverName)) names.push(serverName);
    }
  } catch (err) {
    console.error('gated MCP server enumeration failed:', err);
  }
  return names;
}
