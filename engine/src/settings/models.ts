// engine/src/settings/models.ts -- ENG-3, a TypeScript port of backend/apps/settings/models.py's
// AppSettings schema.
//
// Field set, defaults, and types mirror the Python pydantic model exactly (including the two
// constants it pulls from backend/apps/settings/maestro.py, inlined here so this stays a leaf
// module the way models.py itself is documented to be). coerceSettings() below plays the same
// role as store.py's p_coerce_settings: survive a settings.json written by a different app
// version by dropping only the top-level fields whose TYPE has drifted (reverting them to
// defaults) rather than failing the whole load, and silently ignoring unknown keys the way
// pydantic's default extra="ignore" does.

// backend/apps/settings/maestro.py -- kept inline (not re-exported from a shared module) so this
// file has no upward dependency, same "leaf module" discipline the Python side documents.
const MAESTRO_SLUG = 'maestro';
const MAESTRO_DEFAULT_MODEL_ID = 'maestro-fast';
export const MAESTRO_DEFAULT_MODEL = `custom/${MAESTRO_SLUG}/${MAESTRO_DEFAULT_MODEL_ID}`;
export const FALLBACK_DEFAULT_MODEL = 'sonnet';

// Kept unchanged on purpose: renaming this settings-field name would silently break every
// install's persisted settings.json -- see the ticket's own hard constraint and models.py's
// identical comment on the Python field.
export const PROVEDOR_IA_TOKEN_FIELD = 'provedor_ia_token';
export const PROVEDOR_IA_TOKEN_ENV = 'PROVEDOR_IA_TOKEN';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a personal AI assistant running inside Maestro.\n\n' +
  '## Core Behavior\n' +
  "Act, don't ask. When a tool can accomplish the task, call it immediately; " +
  'do not describe what you would do, do not ask for confirmation, just execute. ' +
  'The user expects results, not plans.\n' +
  'If ANY available tool is relevant to the user\'s request, use it. Never respond ' +
  'with "I can do X for you" or "Would you like me to..."; just do it. ' +
  'A tool call is always better than a text explanation of what the tool would do.\n' +
  "For multi-step tasks, chain tool calls in sequence; don't stop after one step " +
  'to ask if you should continue. Complete the entire task, then report the results.\n' +
  'Be adaptable. If one approach fails, try a different tool or strategy instead of ' +
  'giving up or repeating the same action. Always stay focused on what the user ' +
  "actually wants to accomplish; their intent matters more than the specific method.\n\n" +
  '## Tool Priority\n' +
  "1. Connected MCP tools; fastest and most reliable. Use ToolSearch to discover " +
  "what integrations are available if you're unsure.\n" +
  '2. WebSearch / WebFetch; for general web lookups when no MCP tool fits.\n' +
  '3. BrowserAgent; last resort, only for visual interaction with websites, ' +
  'filling forms, or tasks no other tool can handle.\n\n' +
  '## Style\n' +
  'Do not narrate routine tool calls; just call the tool.\n' +
  'After tool calls complete, present the results directly. Do not recap which ' +
  'tools you called or why; the user can see tool calls in the UI.\n' +
  'Keep responses brief and direct. Use plain language.\n' +
  'If you genuinely need clarification on something ambiguous, use the ' +
  'AskUserQuestion tool. Never ask questions inline in plain text.\n';

export interface CustomProvider {
  name: string;
  base_url: string;
  api_key: string;
  models: Record<string, unknown>[];
}

export interface AppSettings {
  default_system_prompt: string | null;
  default_folder: string | null;
  default_model: string;
  default_mode: string;
  default_max_turns: number | null;
  default_thinking_level: 'off' | 'low' | 'medium' | 'high' | 'auto';
  zoom_sensitivity: number;
  theme: string;
  language: 'pt-BR' | 'en' | null;
  app_template_theme_override: 'light' | 'dark' | null;
  new_agent_shortcut: string;
  anthropic_api_key: string | null;
  browser_homepage: string;
  openai_api_key: string | null;
  google_api_key: string | null;
  openrouter_api_key: string | null;
  provedor_ia_token: string | null;
  custom_providers: CustomProvider[];
  auto_select_mode_on_new_agent: boolean;
  expand_new_chats_in_dashboard: boolean;
  auto_reveal_sub_agents: boolean;
  dev_mode: boolean;
  allow_experimental_updates: boolean;
  claude_subscription_token: string | null;
  openai_subscription_token: string | null;
  gemini_subscription_token: string | null;
  user_name: string | null;
  user_email: string | null;
  user_use_case: string | null;
  user_referral_source: string | null;
  dismissed_mcp_suggestions: Record<string, string>;
  analytics_opt_in: boolean;
  installation_id: string | null;
  analytics_token: string | null;
  timezone: string | null;
  locale: string | null;
  first_opened_at: string | null;
  connection_mode: string;
  maestro_bearer_token: string | null;
  maestro_proxy_url: string | null;
  user_id: string | null;
  signin_method: 'google' | 'stripe' | 'email' | null;
  preflight_enabled: boolean;
  preflight_rollout_pct: number;
}

// AppSettings() with no args in Python -- the schema's own field defaults, field-for-field.
export function defaultAppSettings(): AppSettings {
  return {
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
    default_folder: null,
    default_model: MAESTRO_DEFAULT_MODEL,
    default_mode: 'agent',
    default_max_turns: null,
    default_thinking_level: 'auto',
    zoom_sensitivity: 50.0,
    theme: 'light',
    language: null,
    app_template_theme_override: null,
    new_agent_shortcut: 'Meta+l',
    anthropic_api_key: null,
    browser_homepage: 'https://www.google.com',
    openai_api_key: null,
    google_api_key: null,
    openrouter_api_key: null,
    provedor_ia_token: null,
    custom_providers: [],
    auto_select_mode_on_new_agent: false,
    expand_new_chats_in_dashboard: true,
    auto_reveal_sub_agents: true,
    dev_mode: false,
    allow_experimental_updates: false,
    claude_subscription_token: null,
    openai_subscription_token: null,
    gemini_subscription_token: null,
    user_name: null,
    user_email: null,
    user_use_case: null,
    user_referral_source: null,
    dismissed_mcp_suggestions: {},
    analytics_opt_in: true,
    installation_id: null,
    analytics_token: null,
    timezone: null,
    locale: null,
    first_opened_at: null,
    connection_mode: 'own_key',
    maestro_bearer_token: null,
    maestro_proxy_url: null,
    user_id: null,
    signin_method: null,
    preflight_enabled: true,
    preflight_rollout_pct: 100,
  };
}

type FieldValidator = (v: unknown) => boolean;

const THINKING_LEVELS = new Set(['off', 'low', 'medium', 'high', 'auto']);
const LANGUAGES = new Set(['pt-BR', 'en']);
const THEME_OVERRIDES = new Set(['light', 'dark']);
const SIGNIN_METHODS = new Set(['google', 'stripe', 'email']);

function isNullableString(v: unknown): boolean {
  return v === null || typeof v === 'string';
}

function isCustomProvider(v: unknown): v is CustomProvider {
  if (typeof v !== 'object' || v === null) return false;
  const cp = v as Record<string, unknown>;
  return typeof cp.name === 'string' && typeof cp.base_url === 'string';
}

function isDismissedMap(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

// One validator per field, mirroring pydantic's per-field type check -- used only to decide
// whether a raw value survives into the coerced object; it never rewrites a valid value.
const P_FIELD_VALIDATORS: Record<keyof AppSettings, FieldValidator> = {
  default_system_prompt: isNullableString,
  default_folder: isNullableString,
  default_model: (v) => typeof v === 'string',
  default_mode: (v) => typeof v === 'string',
  default_max_turns: (v) => v === null || typeof v === 'number',
  default_thinking_level: (v) => typeof v === 'string' && THINKING_LEVELS.has(v),
  zoom_sensitivity: (v) => typeof v === 'number',
  theme: (v) => typeof v === 'string',
  language: (v) => v === null || (typeof v === 'string' && LANGUAGES.has(v)),
  app_template_theme_override: (v) => v === null || (typeof v === 'string' && THEME_OVERRIDES.has(v)),
  new_agent_shortcut: (v) => typeof v === 'string',
  anthropic_api_key: isNullableString,
  browser_homepage: (v) => typeof v === 'string',
  openai_api_key: isNullableString,
  google_api_key: isNullableString,
  openrouter_api_key: isNullableString,
  provedor_ia_token: isNullableString,
  custom_providers: (v) => Array.isArray(v) && v.every(isCustomProvider),
  auto_select_mode_on_new_agent: (v) => typeof v === 'boolean',
  expand_new_chats_in_dashboard: (v) => typeof v === 'boolean',
  auto_reveal_sub_agents: (v) => typeof v === 'boolean',
  dev_mode: (v) => typeof v === 'boolean',
  allow_experimental_updates: (v) => typeof v === 'boolean',
  claude_subscription_token: isNullableString,
  openai_subscription_token: isNullableString,
  gemini_subscription_token: isNullableString,
  user_name: isNullableString,
  user_email: isNullableString,
  user_use_case: isNullableString,
  user_referral_source: isNullableString,
  dismissed_mcp_suggestions: isDismissedMap,
  analytics_opt_in: (v) => typeof v === 'boolean',
  installation_id: isNullableString,
  analytics_token: isNullableString,
  timezone: isNullableString,
  locale: isNullableString,
  first_opened_at: isNullableString,
  connection_mode: (v) => typeof v === 'string',
  maestro_bearer_token: isNullableString,
  maestro_proxy_url: isNullableString,
  user_id: isNullableString,
  signin_method: (v) => v === null || (typeof v === 'string' && SIGNIN_METHODS.has(v)),
  preflight_enabled: (v) => typeof v === 'boolean',
  preflight_rollout_pct: (v) => typeof v === 'number',
};

// Build AppSettings, surviving a settings.json written by a different app version -- mirrors
// store.py's p_coerce_settings: a field whose value fails its type check reverts to the default
// (logged) rather than bricking the whole load; a field absent from raw also gets its default
// (pydantic's own "field has a default" behavior). Unknown top-level keys are dropped, matching
// pydantic's default extra="ignore".
export function coerceSettings(raw: Record<string, unknown>, onDropped?: (fields: string[]) => void): AppSettings {
  const defaults = defaultAppSettings();
  const out = { ...defaults } as AppSettings;
  const dropped: string[] = [];
  for (const key of Object.keys(defaults) as (keyof AppSettings)[]) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (P_FIELD_VALIDATORS[key](value)) {
      (out as unknown as Record<string, unknown>)[key] = value;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) onDropped?.(dropped);
  return out;
}
