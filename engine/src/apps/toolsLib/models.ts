// engine/src/apps/toolsLib/models.ts -- SUB-4, a full port of backend/apps/tools_lib/models.py:
// the builtin-tool catalog + the ToolDefinition/ToolCreate/ToolUpdate shapes persisted as one JSON
// file per configured MCP tool under DATA_ROOT/tools.

import { randomUUID } from 'node:crypto';

export interface BuiltinTool {
  name: string;
  display_name?: string | null;
  description: string;
  category: string;
  deferred: boolean;
}

function tool(name: string, description: string, category: string, opts: { display_name?: string; deferred?: boolean } = {}): BuiltinTool {
  return { name, description, category, display_name: opts.display_name ?? null, deferred: opts.deferred ?? false };
}

// Byte-for-byte the same catalog as models.py's BUILTIN_TOOLS -- same names, order, categories,
// deferred flags. This is the list get_all_tool_names()/resolve_forced_tools() key off of, so
// drifting an entry here silently changes what the agent believes it can call.
export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  // Core tools (always loaded)
  tool('Read', 'Read files and directories from the filesystem', 'filesystem'),
  tool('Edit', 'Make targeted edits to existing files using search and replace', 'filesystem'),
  tool('Write', 'Create new files or overwrite existing files', 'filesystem'),
  tool('Bash', 'Execute shell commands in a terminal', 'system'),
  tool('Glob', 'Find files matching glob and wildcard patterns', 'search'),
  tool('Grep', 'Search file contents using regular expressions', 'search'),
  tool('AskUserQuestion', 'Ask the user a question and wait for their response', 'interaction'),
  // Deferred tools (loaded via ToolSearch on demand)
  tool('WebSearch', 'Search the web for real-time information', 'search', { deferred: true }),
  tool('WebFetch', 'Fetch and read content from a URL', 'search', { deferred: true }),
  tool('NotebookEdit', 'Edit Jupyter notebook cells', 'filesystem', { deferred: true }),
  tool('TodoWrite', 'Write and manage a structured todo list', 'planning', { deferred: true }),
  tool('EnterPlanMode', 'Enter plan mode for designing solutions', 'planning', { deferred: true }),
  tool('ExitPlanMode', 'Exit plan mode and return to execution', 'planning', { deferred: true }),
  tool('EnterWorktree', 'Enter a git worktree for isolated work', 'system', { deferred: true }),
  tool('TaskOutput', 'Read output from a background task', 'system', { deferred: true }),
  tool('TaskStop', 'Stop a running background task', 'system', { deferred: true }),
  tool('CronCreate', 'Create a scheduled or recurring task', 'scheduling', { deferred: true }),
  tool('CronList', 'List all scheduled tasks', 'scheduling', { deferred: true }),
  tool('CronDelete', 'Delete a scheduled task', 'scheduling', { deferred: true }),
  // Skills
  tool('Skill', "Load an installed skill's instructions on demand so the agent can find and use the right skill itself", 'skills'),
  // Agent tools
  tool('Agent', 'Spawn a sub-agent to handle a complex subtask', 'agents', { display_name: 'CreateAgent' }),
  tool('InvokeAgent', 'Invoke a copy of an existing agent with a new message, preserving full conversation context', 'agents'),
  // Browser delegation tools (Layer 1, what the main agent calls)
  tool('CreateBrowserAgent', 'Create a new browser and run a task on it', 'browser_delegation'),
  tool('BrowserAgent', 'Delegate a browser task to an existing browser agent', 'browser_delegation'),
  tool('BrowserAgents', 'Run multiple browser tasks in parallel on existing browsers', 'browser_delegation'),
  tool('AppAgent', "Operate one of the user's Maestro-built apps through its native bridge or native input", 'browser_delegation'),
  // Browser action tools (Layer 2, what the sub-agent executes)
  tool('BrowserScreenshot', 'Capture a screenshot of the browser page', 'browser_action'),
  tool('BrowserNavigate', 'Navigate the browser to a URL', 'browser_action'),
  tool('BrowserClick', 'Click an element by CSS selector', 'browser_action'),
  tool('BrowserType', 'Type text into an input element', 'browser_action'),
  tool('BrowserEvaluate', 'Execute JavaScript in the browser', 'browser_action'),
  tool('BrowserGetText', 'Get visible text content of the page', 'browser_action'),
  tool('BrowserGetElements', 'List interactive elements with CSS selectors', 'browser_action'),
  tool('BrowserScroll', 'Scroll the page up or down', 'browser_action'),
  tool('BrowserWait', 'Wait for page loads or animations', 'browser_action'),
  tool('BrowserPressKey', 'Press a keyboard key (native event, works on sites that ignore JS-dispatched events)', 'browser_action'),
  tool('BrowserListInteractives', 'List interactive elements via the accessibility tree (works on hostile sites with no semantic HTML)', 'browser_action'),
  tool('BrowserClickIndex', 'Click an element by its index from BrowserListInteractives (uses native mouse events)', 'browser_action'),
  tool('BrowserBatch', 'Run a sequence of browser actions in one tool call with URL-change abort guard', 'browser_action'),
  tool('ReportProgress', 'Record evaluation of previous action, working memory, and next goal (required before action tools)', 'browser_action'),
  tool('RequestHumanIntervention', 'Pause the browser agent and ask the user for help (login, captcha, 2FA, etc.)', 'browser_action'),
];

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  command: string;
  mcp_config: Record<string, unknown>;
  credentials: Record<string, string>;
  auth_type: string;
  auth_status: string;
  oauth_tokens: Record<string, unknown>;
  tool_permissions: Record<string, unknown>;
  connected_account_email: string | null;
  enabled: boolean;
}

export interface ToolDefinitionInput {
  id?: string;
  name: string;
  description?: string;
  command?: string;
  mcp_config?: Record<string, unknown>;
  credentials?: Record<string, string>;
  auth_type?: string;
  auth_status?: string;
  oauth_tokens?: Record<string, unknown>;
  tool_permissions?: Record<string, unknown>;
  connected_account_email?: string | null;
  enabled?: boolean;
}

/** Constructs a ToolDefinition with every default models.py's pydantic model applies, mirroring
 * `ToolDefinition(**json.load(f))`/`ToolDefinition(name=..., ...)` construction call sites. */
export function makeToolDefinition(input: ToolDefinitionInput): ToolDefinition {
  return {
    id: input.id ?? randomUUID().replace(/-/g, ''),
    name: input.name,
    description: input.description ?? '',
    command: input.command ?? '',
    mcp_config: input.mcp_config ?? {},
    credentials: input.credentials ?? {},
    auth_type: input.auth_type ?? 'none',
    auth_status: input.auth_status ?? 'none',
    oauth_tokens: input.oauth_tokens ?? {},
    tool_permissions: input.tool_permissions ?? {},
    connected_account_email: input.connected_account_email ?? null,
    enabled: input.enabled ?? true,
  };
}

export interface ToolCreate {
  name: string;
  description?: string;
  command?: string;
  mcp_config?: Record<string, unknown>;
  credentials?: Record<string, string>;
  auth_type?: string;
  auth_status?: string;
}

export interface ToolUpdate {
  name?: string | null;
  description?: string | null;
  command?: string | null;
  mcp_config?: Record<string, unknown> | null;
  credentials?: Record<string, string> | null;
  auth_type?: string | null;
  auth_status?: string | null;
  oauth_tokens?: Record<string, unknown> | null;
  tool_permissions?: Record<string, unknown> | null;
  connected_account_email?: string | null;
  enabled?: boolean | null;
}

/** Apply a PATCH-like update (only defined keys, `exclude_none` semantics) onto a ToolDefinition,
 * mirroring `for k, v in body.model_dump(exclude_none=True).items(): setattr(tool, k, v)`. Returns a
 * new object; caller re-assigns/saves it. */
export function applyToolUpdate(tool: ToolDefinition, update: ToolUpdate): ToolDefinition {
  const next: ToolDefinition = { ...tool };
  for (const key of Object.keys(update) as (keyof ToolUpdate)[]) {
    const value = update[key];
    if (value !== null && value !== undefined) {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}
