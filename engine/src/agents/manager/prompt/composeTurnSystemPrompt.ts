// engine/src/agents/manager/prompt/composeTurnSystemPrompt.ts -- AGT-5, a port of
// backend/apps/agents/manager/prompt/compose_turn_system_prompt.py: assembles the full per-turn
// system prompt (base composed prompt + appended context blocks: browser selection, MCP registry
// summary, a current-time pin, the App Builder skill, picked app cards, picked Settings rows, the
// language directive).
//
// Every context-builder call is DI'd (`ComposeTurnSystemPromptDeps`), defaulting to promptContext.ts's
// exports -- exactly the functions backend/tests/test_system_prompt.py patches
// (`build_browser_context`/`build_mcp_registry_summary`/`build_selected_app_context`/
// `build_selected_settings_context`), plus `loadSettings` (language resolution) and
// `loadAppBuilderSkill` (the view-builder skill body, outputs.view_builder_templates -- SUB-5
// territory, not yet ported; default returns a placeholder documenting the gap rather than
// silently omitting the block the real prompt always carries in view-builder mode).

import type { AgentSession } from '../../core/models';
import { loadSettings } from '../../../settings/store';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_PT_BR } from '../../../settings/models';
import {
  buildAppRuntimeContract,
  buildBrowserContext as defaultBuildBrowserContext,
  buildInstalledSkillsCatalog as defaultBuildInstalledSkillsCatalog,
  buildMcpRegistrySummary as defaultBuildMcpRegistrySummary,
  buildSelectedAppContext as defaultBuildSelectedAppContext,
  buildSelectedSettingsContext as defaultBuildSelectedSettingsContext,
  composeSystemPrompt,
} from './promptContext';
import { getAllToolNames as realGetAllToolNames } from '../../../apps/toolsLib/toolCatalog';

/** Full call-through to tool_catalog.py's `get_all_tool_names` port (SUB-4). */
function defaultGetAllToolNames(): string[] {
  return realGetAllToolNames();
}

/** Stand-in for `outputs.view_builder_templates.load_app_builder_skill` -- outputs (SUB-5, App
 * Builder) isn't ported. Returns a placeholder rather than silently omitting the block the real
 * prompt always carries in view-builder mode, so a missing wiring is visible in the prompt itself
 * rather than a quiet behavior gap. */
function defaultLoadAppBuilderSkill(): string {
  return '(App Builder skill content not yet available -- outputs/view_builder_templates is not ported to the engine.)';
}

export interface ComposeTurnSystemPromptDeps {
  buildBrowserContext?: typeof defaultBuildBrowserContext;
  buildMcpRegistrySummary?: typeof defaultBuildMcpRegistrySummary;
  buildSelectedAppContext?: typeof defaultBuildSelectedAppContext;
  buildSelectedSettingsContext?: typeof defaultBuildSelectedSettingsContext;
  buildInstalledSkillsCatalog?: typeof defaultBuildInstalledSkillsCatalog;
  getAllToolNames?: () => string[];
  loadAppBuilderSkill?: () => string;
  /** Mirrors `p_resolve_prompt_language`'s `load_settings` call -- defaults to the real (never-
   * throwing) engine settings loader; kept overridable so a test can simulate the Python
   * original's OSError fail-open path without touching disk. */
  loadSettings?: () => { settings: { language: string | null } };
  /** Wall-clock source for the `<current_time>` pin, overridable for determinism. */
  now?: () => Date;
  timeZone?: string;
}

/** The UI language the prompt should speak. Unset means pt-BR, matching the frontend default -- a
 * fresh install shows a Portuguese UI, so an English prompt there would make the agent answer in
 * the wrong language. Never raises: a turn must not die because settings were unreadable. */
export function resolvePromptLanguage(loadSettingsFn: () => { settings: { language: string | null } } = () => loadSettings()): string {
  try {
    return loadSettingsFn().settings.language === 'en' ? 'en' : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

/** Swap in the pt-BR default prompt, but ONLY when the stored value is the untouched English
 * default. `defaultSystemPrompt` is a persisted, user-editable setting, so a user who wrote their
 * own prompt must get it back verbatim in either language. */
export function localizeDefaultPrompt(defaultSystemPrompt: string | null | undefined, language: string): string | null | undefined {
  if (language !== 'pt-BR' || defaultSystemPrompt === null || defaultSystemPrompt === undefined) return defaultSystemPrompt;
  return defaultSystemPrompt === DEFAULT_SYSTEM_PROMPT ? DEFAULT_SYSTEM_PROMPT_PT_BR : defaultSystemPrompt;
}

function formatCurrentTimeBlock(now: Date, timeZone: string): string {
  const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  const dateStr = dateFmt.format(now);
  const timeParts = timeFmt.formatToParts(now);
  const clock = timeParts
    .filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .replace(/([AP]M)$/, ' $1');
  const tzAbbr = timeParts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  return (
    '<current_time>\n' +
    `Today is ${dateStr}.\n` +
    `Local time: ${clock} ${tzAbbr} (${timeZone}).\n` +
    'Use this as ground truth for any date/time/day-of-week question.\n' +
    '</current_time>'
  );
}

export interface ComposeTurnSystemPromptArgs {
  modeSysPrompt: string | null;
  defaultSystemPrompt: string | null;
  selectedBrowserIds: string[] | null;
  selectedAppOutputIds: string[] | null;
  selectedSettingIds: string[] | null;
}

/** Full port of `compose_turn_system_prompt`. */
export function composeTurnSystemPrompt(
  session: Pick<AgentSession, 'dashboard_id' | 'allowed_tools' | 'active_mcps' | 'system_prompt' | 'mode' | 'cwd'>,
  args: ComposeTurnSystemPromptArgs,
  deps: ComposeTurnSystemPromptDeps = {},
): string | undefined {
  const buildBrowserContext = deps.buildBrowserContext ?? defaultBuildBrowserContext;
  const buildMcpRegistrySummary = deps.buildMcpRegistrySummary ?? defaultBuildMcpRegistrySummary;
  const buildSelectedAppContext = deps.buildSelectedAppContext ?? defaultBuildSelectedAppContext;
  const buildSelectedSettingsContext = deps.buildSelectedSettingsContext ?? defaultBuildSelectedSettingsContext;
  const buildInstalledSkillsCatalog = deps.buildInstalledSkillsCatalog ?? defaultBuildInstalledSkillsCatalog;
  const getAllToolNames = deps.getAllToolNames ?? defaultGetAllToolNames;
  const loadAppBuilderSkill = deps.loadAppBuilderSkill ?? defaultLoadAppBuilderSkill;
  const now = (deps.now ?? (() => new Date()))();
  const timeZone =
    deps.timeZone ?? (process.env.MAESTRO_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  // MCP servers and their tool inventories are intentionally NOT injected into the system prompt
  // eagerly -- see the Python original's comment for the full reasoning (ToolSearch deferral).
  const browserCtx = buildBrowserContext(session.dashboard_id, args.selectedBrowserIds);
  const mcpRegistryCtx = buildMcpRegistrySummary(session.allowed_tools, session.active_mcps, getAllToolNames);
  const skillsCatalogCtx = buildInstalledSkillsCatalog();
  const language = resolvePromptLanguage(deps.loadSettings);
  let composed: string | undefined = composeSystemPrompt(
    localizeDefaultPrompt(args.defaultSystemPrompt, language),
    args.modeSysPrompt,
    session.system_prompt,
    browserCtx,
    mcpRegistryCtx,
    skillsCatalogCtx,
  );

  // Pin the agent's notion of "now" to the host wall clock + zone.
  try {
    const timeCtx = formatCurrentTimeBlock(now, timeZone);
    composed = composed ? `${composed}\n\n${timeCtx}` : timeCtx;
  } catch {
    // Best-effort, mirrors the Python original's bare except: pass.
  }

  if (session.mode === 'view-builder') {
    // Read the LIVE skill content rather than a frozen-at-import constant.
    const skillBlock = `<app_builder_reference>\n${loadAppBuilderSkill()}\n</app_builder_reference>`;
    composed = composed ? `${composed}\n\n${skillBlock}` : skillBlock;
    // Appended AFTER the reference, and never sourced from it: platform mechanics have to reach
    // the agent regardless of what that (user-editable) file says.
    const contractBlock = buildAppRuntimeContract(session.cwd);
    composed = `${composed}\n\n${contractBlock}`;
  } else {
    // Every other mode gets one line of discovery instead of the whole reference.
    const appsNote =
      '<apps_capability>\n' +
      'You can build real web apps for the user: when they ask for an app, tool, game, or dashboard, ' +
      'call the CreateApp tool — it seeds a workspace and puts a live preview card on their dashboard, ' +
      'then you write the code. To change an existing app, have the user select its card (or use the ' +
      'workspace path in your context) and edit the files directly.\n' +
      '</apps_capability>';
    composed = composed ? `${composed}\n\n${appsNote}` : appsNote;
  }

  // App cards the user picked via the dashboard element picker.
  const appCtx = buildSelectedAppContext(args.selectedAppOutputIds);
  if (appCtx) composed = composed ? `${composed}\n\n${appCtx}` : appCtx;

  // The user can point the agent at specific Settings rows.
  const settingsCtx = buildSelectedSettingsContext(args.selectedSettingIds);
  if (settingsCtx) composed = composed ? `${composed}\n\n${settingsCtx}` : settingsCtx;

  // Last block in the prompt, so it wins over any English phrasing in the blocks above it.
  const langCtx =
    language === 'pt-BR'
      ? '<language_directive>\n' +
        'Escreva em português do Brasil todo o conteúdo que o usuário vai ler: respostas em prosa, resumos, ' +
        'planos, títulos de tarefas e de itens de TODO, perguntas do AskUserQuestion e mensagens de erro.\n' +
        'Mantenha exatamente como estão, sem traduzir: código e identificadores, caminhos de arquivo, comandos ' +
        'de shell, saída de log, nomes de ferramentas e conteúdo citado de arquivos ou da web.\n' +
        'Não traduza nomes de produtos (Maestro Studio, Claude, Anthropic, MCP, GitHub) nem os termos técnicos ' +
        'que pessoas da área usam em inglês no Brasil (prompt, token, workflow, deploy, commit, build, log).\n' +
        '</language_directive>'
      : '<language_directive>\n' +
        'Write all user-facing content in English: prose replies, summaries, plans, task and TODO titles, ' +
        'AskUserQuestion prompts, and error messages.\n' +
        'Leave code, identifiers, file paths, shell commands, log output, and quoted content as-is.\n' +
        '</language_directive>';
  composed = composed ? `${composed}\n\n${langCtx}` : langCtx;

  return composed;
}
