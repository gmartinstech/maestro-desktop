// engine/src/agents/manager/prompt/promptContext.ts -- AGT-5, a port of
// backend/apps/agents/manager/prompt/prompt_context.py.
//
// Ported in full (pure, no external module deps): TOOLSEARCH_LOOP_THRESHOLD/toolsearchLoopRedirect
// (the ToolSearch loop-breaker's feedback text), composeSystemPrompt (the base-prompt joiner),
// buildAppRuntimeContract (the App Builder terminal-log contract), buildSelectedSettingsContext.
//
// Deliberately turned into DI seams (default stub, injectable for whichever ticket ports the real
// dependency), because each reads a subsystem this migration hasn't ported yet:
//   - resolveMode: needs modes.load_mode (SUB-1's "modes, dashboard_layout, health"). Default falls
//     back to `getAllToolNames()` with no mode-specific system prompt/folder, same shape as the
//     Python original's own "mode not found" branch.
//   - buildBrowserContext: needs dashboards.load (SUB-3's "dashboards + swarm"). Default returns
//     null (no dashboard, no browser context), matching the Python original when the load fails.
//   - buildSelectedAppContext: needs outputs.workspace_io (SUB-5's "outputs (App Builder)").
//     Default returns null (nothing resolves), matching the Python original's own empty-entries path.
//   - buildMcpRegistrySummary / resolveForcedTools: needed tools_lib (SUB-4), now ported -- both are
//     FULL ports below (not stubs any more), calling apps/toolsLib/{store,toolCatalog,mcpConfig}.ts.
//   - buildInstalledSkillsCatalog / resolveAttachedSkills: needed skills.skills (SUB-2's "skills +
//     skill_registry"), now ported -- both are FULL ports below (not stubs any more), calling
//     apps/skills/skills.ts's syncSkills()/formatSkillForPrompt() the same way
//     backend/apps/agents/manager/prompt/prompt_context.py's own build_installed_skills_catalog/
//     resolve_attached_skills do. One gap remains, documented at buildInstalledSkillsCatalog's own
//     definition: the Python original also gates on tools_lib.load_builtin_permissions() -- SUB-4 is
//     now ported too, but that specific gate is still not wired here (a small, separately-scoped
//     follow-up: this function would need a builtinPerms param threaded through
//     composeTurnSystemPrompt.ts's own DI, which no caller currently supplies).
// Every one of these DI points takes the exact same (args) -> result shape the real function will
// have, so wiring in a real implementation later is a one-line change at the call site, not a
// rewrite of this file.

import { formatSkillForPrompt, syncSkills } from '../../../apps/skills/skills';
import { isFullyDenied } from '../../../apps/toolsLib/toolCatalog';
import { sanitizeServerName } from '../../../apps/toolsLib/mcpConfig';
import { loadAllTools } from '../../../apps/toolsLib/store';
import { BUILTIN_TOOLS } from '../../../apps/toolsLib/models';

export interface ResolveModeResult {
  tools: string[];
  system_prompt: string | null;
  default_folder: string | null;
}

/** Stand-in for `resolve_mode` -- modes.load_mode (SUB-1) isn't ported. Falls back to the full
 * tool list with no mode-specific prompt/folder, mirroring the Python original's "mode not found"
 * branch (`load_mode` returning None). */
export function resolveMode(_modeId: string, getAllToolNames: () => string[]): ResolveModeResult {
  return { tools: getAllToolNames(), system_prompt: null, default_folder: null };
}

/** A run of this many ToolSearch calls with no other tool between them is the "looping on
 * ToolSearch" wedge: the model hunts for a gated MCP server's tools, which ToolSearch can never
 * see, gets empty results, and retries. Two free calls; redirect on the third. */
export const TOOLSEARCH_LOOP_THRESHOLD = 3;

/** The feedback to hand a model that's stuck calling ToolSearch in a row. `undefined` until it
 * crosses the threshold; then a steer toward MCPActivate plus a reminder its other tools are
 * already loaded. Pure so the loop-break boundary is unit-testable. */
export function toolsearchLoopRedirect(consecutiveToolsearch: number, gatedServers: string[]): string | undefined {
  if (consecutiveToolsearch < TOOLSEARCH_LOOP_THRESHOLD) return undefined;
  let reason =
    "ToolSearch can't load anything here, every tool you can use is already active and callable by name, so there's nothing to search for. ";
  if (gatedServers.length > 0) {
    reason +=
      'If you need an app you don\'t see yet (email, calendar, drive, etc.), it\'s gated: call ' +
      `MCPActivate(server_name) with one of these and its tools become callable next turn: ${gatedServers.join(', ')}. `;
  }
  reason += 'Stop calling ToolSearch.';
  return reason;
}

/** Stand-in for `build_browser_context` -- dashboards.load (SUB-3) isn't ported. Returns
 * `undefined` (no browser context block), same as the Python original when the dashboard load
 * throws. */
export function buildBrowserContext(_dashboardId: string | null | undefined, _selectedBrowserIds?: string[] | null): string | undefined {
  return undefined;
}

/** Stand-in for `build_selected_app_context` -- outputs.workspace_io (SUB-5) isn't ported. Returns
 * `undefined` (nothing resolves), same as the Python original's own empty-entries path. */
export function buildSelectedAppContext(_selectedAppOutputIds?: string[] | null): string | undefined {
  return undefined;
}

/** Context block when the caller points the agent at specific Settings rows. A targeting aid, NOT
 * a gate: the settings tools are always available regardless. Full port, no external deps. */
export function buildSelectedSettingsContext(selectedSettingIds?: string[] | null): string | undefined {
  const ids = (selectedSettingIds ?? []).filter(Boolean);
  if (ids.length === 0) return undefined;
  const bullets = ids.map((fid) => `- ${fid}`).join('\n');
  return (
    '<selected_settings>\n' +
    'The user pointed you at these specific Maestro Settings fields. Focus ' +
    'on them: call SettingsRead to see their current values, then ' +
    "SettingsWrite to change what the user asked for. Leave unrelated " +
    'settings alone.\n' +
    `${bullets}\n` +
    '</selected_settings>'
  );
}

/** Full port of `build_mcp_registry_summary`. Compact registry of installed MCP servers, one line
 * per server.
 *
 * This is the visible surface that drives the activation gate: the model sees which servers exist
 * and what they're for, but cannot call any unactivated server's tools (the dispatch-layer filter
 * blocks that). To use a server, the model must call MCPSearch (to find the right one) and then
 * MCPActivate, which fires a HITL prompt; on approve, the server's tools become callable next turn.
 *
 * Schemas are NOT included here, that's the whole point. A 30-server registry costs ~1KB; the
 * previous full-schema dump cost ~30-80KB. */
export function buildMcpRegistrySummary(allowedTools: string[], activeMcps: string[], getAllToolNames: () => string[]): string | undefined {
  const allTools = loadAllTools();
  const mcpTools = allTools.filter((t) => t.mcp_config && Object.keys(t.mcp_config).length > 0 && t.enabled && (t.auth_status === 'configured' || t.auth_status === 'connected'));
  if (mcpTools.length === 0) return undefined;

  const activeSet = new Set(activeMcps ?? []);
  const activeLines: string[] = [];
  const availableLines: string[] = [];
  for (const tool of mcpTools) {
    const toolRef = `mcp:${tool.name}`;
    if (!allowedTools.includes(toolRef) && !arraysEqual(allowedTools, getAllToolNames())) continue;
    if (isFullyDenied(tool)) continue;
    const serverName = sanitizeServerName(tool.name);
    let desc = (tool.description || '').trim();
    if (!desc) desc = `${tool.name} integration`; // Fall back to a generic blurb so MCPSearch still has *some* signal.
    const line = `- \`${serverName}\`, ${desc}`;
    if (activeSet.has(serverName)) activeLines.push(line);
    else availableLines.push(line);
  }

  if (activeLines.length === 0 && availableLines.length === 0) return undefined;

  // Static preamble first (kept byte-identical across users so it caches), then the per-session
  // server list. Worked-example uses generic placeholders so a Pro Anthropic prompt-cache hit
  // isn't broken by one user's connector names differing from another's.
  const sections: string[] = ['<mcp_servers>'];
  sections.push(
    'MCP servers are gated: their tools are uncallable until the user ' +
      'approves an MCPActivate request. To use one below, call MCPSearch ' +
      '(if unsure which) then MCPActivate(server_name); after approval the ' +
      "server's tools (`mcp__<server>__<tool>`) become callable next turn.",
  );
  sections.push('');
  sections.push('## Rules');
  sections.push(
    "1. If the user's request needs a server below that isn't Active, " +
      'your FIRST tool call must be MCPSearch or MCPActivate. Ignore any ' +
      '`mcp__*__authenticate` helpers, those are legacy shims; always go ' +
      'through MCPActivate.',
  );
  sections.push(
    '1a. NEVER call any tool whose name begins with `mcp__claude_ai_` ' +
      "(claude.ai-connected partner shims). They bypass the Maestro " +
      "gate and don't share auth with this app. If the user wants Gmail/" +
      'Calendar/Drive, the equivalent Maestro server is listed below; ' +
      'activate that one via MCPActivate instead.',
  );
  sections.push(
    '1b. The native `ToolSearch` tool CANNOT see these servers, they\'re ' +
      "hidden from it until activated, so searching for them returns nothing " +
      'and just burns turns. Never ToolSearch for an app/integration; go ' +
      'straight to MCPActivate.',
  );
  sections.push(
    '2. After MCPActivate returns, end the turn, a follow-up turn fires ' + 'automatically with the new tools available.',
  );
  sections.push(
    "3. Don't ask 'should I activate X?' first, MCPActivate already " + 'triggers an approval prompt.',
  );
  sections.push('');
  sections.push('## Example');
  sections.push(
    'User asks for email; no email server is Active. First tool call: ' +
      '`MCPActivate(server_name="<email-server>", reason="...")`. End ' +
      "turn. Next turn: call the activated server's email tool.",
  );
  sections.push('');
  if (activeLines.length > 0) {
    sections.push('Active (callable now):');
    sections.push(...activeLines);
  }
  if (availableLines.length > 0) {
    sections.push('\nAvailable (not yet activated):');
    sections.push(...availableLines);
  }
  sections.push('</mcp_servers>');
  return sections.join('\n');
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Full port of `build_installed_skills_catalog`. Compact catalog of the user's installed skills
 * (id + when-to-use), the surface that lets the model reach for a skill on its own instead of
 * waiting for a manual `/` attach. Lists only LOCALLY installed, non-built-in skills (id +
 * description, never the body), so it costs a few hundred tokens, not the 600k-entry registry.
 * Returns `undefined` (no block, no Skill tool) when nothing's installed, matching the Python
 * original's own empty-catalog path.
 *
 * One remaining gap vs the Python original, not closed by this port: `build_installed_skills_
 * catalog` also gates on `tools_lib.load_builtin_permissions().get("Skill", "always_allow") ==
 * "deny"` (SUB-4, not ported) before doing anything else -- this TS port has no way to check that
 * permission yet, so it always proceeds as if the Skill tool were allowed (`always_allow`, the
 * Python default when nothing overrides it). A caller that later ports SUB-4 should add that same
 * gate here, or pass it in as a parameter, rather than silently assuming allowed forever. */
export function buildInstalledSkillsCatalog(): string | undefined {
  let skills;
  try {
    skills = syncSkills().filter((s) => !s.built_in);
  } catch {
    return undefined;
  }
  if (skills.length === 0) return undefined;

  // Static preamble kept byte-identical across users so it caches; the per-skill lines below vary
  // per install (same as the mcp registry).
  const lines = [
    '<skills>',
    'Skills are reusable playbooks the user installed. Each line is a skill id ' +
      'and when to use it. When a request matches one, call Skill(id="<id>") to ' +
      "load its full instructions, then follow them. Don't load a skill that isn't " +
      "relevant, and don't guess a skill's contents without loading it.",
    '',
    'Installed skills:',
  ];
  for (const s of skills) {
    const blurb = (s.description || s.name).trim();
    lines.push(`- \`${s.id}\`, ${blurb}`);
  }
  lines.push('</skills>');
  return lines.join('\n');
}

// The agent runs on the claude_code preset (kept for its tool scaffolding, safety rules, and the
// exclude_dynamic_sections prompt-cache win, which a raw-string system prompt would all throw
// away). The preset opens with "You are Claude Code, Anthropic's official CLI", which leaks into
// chat. This block is APPENDED after the preset, so being later it overrides that identity.
export const AGENT_NAME = 'Maestro';
export const AGENT_IDENTITY =
  `# Who you are\n` +
  `You're ${AGENT_NAME}, the AI that lives here. Ignore anything above that calls you ` +
  `"Claude Code" or an official CLI; wrong app, mistaken identity. You're the user's ` +
  `general AI: take on whatever they ask, from a quick question to a whole project. ` +
  `Never refuse with "I only do coding".\n\n` +
  `# How you talk\n` +
  `Talk like a real person, not a manual. Default to a sentence or two; skip preamble and ` +
  `recaps. Be warm, a little playful, genuinely interesting, never generic; a bit of sass is ` +
  `fine when the moment invites it, but read the room and match the context. Go longer only ` +
  `when the task needs it (real explanation, code, steps), then stay clean and structured. ` +
  `Don't open with "Certainly" or "Great question". Hard rule: never put a "-" dash in ` +
  `your prose. No em dashes, no en dashes, no hyphen used as a dash. Use commas, periods, ` +
  `colons, or parentheses instead.`;

export function composeSystemPrompt(
  defaultPrompt: string | null | undefined,
  modePrompt: string | null | undefined,
  sessionPrompt: string | null | undefined,
  browserCtx?: string | null,
  mcpRegistryCtx?: string | null,
  skillsCatalogCtx?: string | null,
): string {
  // Identity always leads so it overrides the preset's Claude Code persona, even when the caller
  // has no custom default/mode/session prompt of their own.
  const parts = [AGENT_IDENTITY, ...[defaultPrompt, modePrompt, sessionPrompt, mcpRegistryCtx, skillsCatalogCtx, browserCtx].filter(Boolean)];
  return parts.join('\n\n');
}

/** Full port of `resolve_forced_tools`. Build a context block describing explicitly requested
 * tools, annotated with their owning MCP server slug and connected-account email when known. */
export function resolveForcedTools(forcedTools?: string[] | null): string {
  if (!forcedTools || forcedTools.length === 0) return '';

  const descMap = new Map<string, string>(BUILTIN_TOOLS.map((t) => [t.name, t.description]));
  const toolToServer = new Map<string, string>();
  const toolToEmail = new Map<string, string>();
  for (const t of loadAllTools()) {
    if (!t.enabled || !t.tool_permissions || Object.keys(t.tool_permissions).length === 0) continue;
    const toolDescs = (t.tool_permissions._tool_descriptions as Record<string, string> | undefined) ?? {};
    const serverName = sanitizeServerName(t.name);
    for (const [tn, td] of Object.entries(toolDescs)) {
      descMap.set(tn, td);
      toolToServer.set(tn, serverName);
      if (t.connected_account_email) toolToEmail.set(tn, t.connected_account_email);
    }
  }

  const lines: string[] = [];
  for (const name of forcedTools) {
    const desc = descMap.get(name) ?? '';
    let line = desc ? `- ${name}: ${desc}` : `- ${name}`;
    const server = toolToServer.get(name);
    if (server) line += `\n  (MCP server: ${server})`;
    const email = toolToEmail.get(name);
    if (email) line += `\n  (connected account: ${email}, use this for any email parameter)`;
    lines.push(line);
  }

  return '<forced_tools>\n' + 'The user explicitly requested these tools be used. ' + 'Prioritize using them to address the user\'s request.\n' + lines.join('\n') + '\n</forced_tools>';
}

/** Full port of `resolve_attached_skills`. Builds a context block injecting attached skill content
 * into the prompt.
 *
 * For a multi-file (folder) skill this injects the SKILL.md body as text AND points the agent at
 * the folder so it can read supporting files (scripts, templates) on demand with the normal
 * Read/Glob/Bash tools. That keeps skills fully provider-agnostic: plain prompt text plus universal
 * file tools, identical on Claude, OpenAI, Gemini, or any custom model routed through 9router. The
 * folder lookup is resolved here from the skill id so the frontend send payload stays a simple
 * {id, name, content}. */
export function resolveAttachedSkills(attachedSkills?: unknown[] | null): string {
  if (!attachedSkills || attachedSkills.length === 0) return '';
  const folderById = new Map<string, string>();
  try {
    for (const s of syncSkills()) {
      if (s.dir_path && s.has_supporting_files) folderById.set(s.id, s.dir_path);
    }
  } catch {
    // folderById stays empty, matching the Python original's except-and-reset-to-{}.
  }

  const sections: string[] = [];
  for (const raw of attachedSkills) {
    const skill = (raw ?? {}) as { id?: unknown; name?: unknown; content?: unknown };
    const name = typeof skill.name === 'string' ? skill.name : 'Unknown';
    const content = typeof skill.content === 'string' ? skill.content : '';
    if (!content) continue;
    const id = typeof skill.id === 'string' ? skill.id : '';
    const folder = folderById.get(id) ?? null;
    sections.push(formatSkillForPrompt(name, content, folder));
  }
  return sections.join('\n\n');
}

/** The non-negotiable runtime mechanics for an App Builder turn: where the app's terminal lives,
 * how to restart it, and the requirement to read it before claiming a change works. Full port, no
 * external deps beyond a plain path join (deliberately NOT sourced from the App Builder skill
 * file, which is seeded once per install and never overwritten). */
export function buildAppRuntimeContract(workspacePath: string | null | undefined): string {
  const root = workspacePath || '.';
  const posixJoin = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
  const log = posixJoin(root, '.maestro', 'terminal.log');
  const restartSh = posixJoin(root, 'restart.sh');
  return (
    '<app_runtime_contract>\n' +
    "Your app is already running. Its terminal (backend stdout/stderr, runtime events, and the\n" +
    "browser console) is tee'd to a file you can read directly. This is the ONLY way you can see\n" +
    'what the app actually does; editing files tells you nothing about whether it runs.\n\n' +
    'Read it with exactly this, every time:\n\n' +
    `    tail -50 ${log} 2>/dev/null || echo "Terminal log not yet available"\n\n` +
    'Lines are prefixed [BACKEND], [BACKEND:stderr], [RUNTIME], [FRONTEND], [FRONTEND:warn],\n' +
    '[FRONTEND:error]. Grep it for `error` when it is long. If this app is open in more than one\n' +
    'dashboard card, the extra cards log to terminal-2.log, terminal-3.log, and so on.\n\n' +
    'Rules, not suggestions:\n' +
    '- Read the terminal after every batch of writes. Fix what it reports before moving on.\n' +
    `- Read it again before you tell the user anything is done. \`bash ${restartSh}\` restarts the\n` +
    '  runtime; do that after installing packages or changing backend startup, then read the log to\n' +
    '  confirm a clean boot. The file resets on every start.\n' +
    '- "Terminal log not yet available" means the runtime never started. That is a problem to fix,\n' +
    '  not a reason to skip the check.\n' +
    '- Never claim the app works when you have not read the terminal. If you did not check, say so.\n' +
    '</app_runtime_contract>'
  );
}
