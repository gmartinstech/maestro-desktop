import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { API_BASE, PROVEDOR_IA_DEFAULT_MODEL } from '@/shared/config';

const SETTINGS_API = `${API_BASE}/settings`;

export const DEFAULT_SYSTEM_PROMPT =
  `You are a personal AI assistant running inside Maestro Studio.\n\n` +
  `## Tool Priority\n` +
  `When a dedicated MCP tool exists for a task, use it directly. Do not use the browser for things MCP tools can handle.\n` +
  `Priority order:\n` +
  `1. MCP tools first (Reddit, Google Workspace, etc.); fastest and most reliable\n` +
  `2. WebSearch / WebFetch for general web lookups without a dedicated MCP\n` +
  `3. BrowserAgent only when you need to visually interact with a website, fill forms, or do something no other tool can handle\n\n` +
  `## Tool Call Style\n` +
  `Default: do not narrate routine tool calls. Just call the tool.\n` +
  `Narrate only when it helps: multi-step work, complex problems, or when the user explicitly asks.\n` +
  `Keep narration brief. Use plain language.\n\n` +
  `## Interaction Style\n` +
  `Be direct and action-oriented. Do not ask clarifying questions unless genuinely ambiguous; ` +
  `make reasonable assumptions and act. If you need to ask, use the AskUserQuestion tool.\n` +
  `Do not over-explain what you are about to do. Just do it and show the results.`;

export interface CustomProvider {
  name: string;
  base_url: string;
  api_key: string;
  models: Array<{ value: string; label: string; context_window?: number }>;
}

export interface AppSettings {
  default_system_prompt: string | null;
  default_folder: string | null;
  default_model: string;
  default_mode: string;
  default_max_turns: number | null;
  default_thinking_level: 'off' | 'low' | 'medium' | 'high' | 'auto';
  zoom_sensitivity: number;
  theme: 'light' | 'dark';
  new_agent_shortcut: string;
  anthropic_api_key: string | null;
  openai_api_key?: string | null;
  google_api_key?: string | null;
  openrouter_api_key?: string | null;
  provedor_ia_token?: string | null;
  custom_providers?: CustomProvider[];
  browser_homepage: string;
  auto_select_mode_on_new_agent: boolean;
  expand_new_chats_in_dashboard: boolean;
  auto_reveal_sub_agents: boolean;
  dev_mode: boolean;
  allow_experimental_updates: boolean;
  /** Server-owned routing state. */
  connection_mode?: 'own_key';
  maestro_bearer_token?: string | null;
  maestro_proxy_url?: string | null;
  /** Server-owned identity. */
  user_id?: string | null;
  user_email?: string | null;
  signin_method?: 'google' | 'email' | 'stripe' | null;
  /** Anonymous device id (first-run generated); stitches anon to authed PostHog Persons. */
  installation_id?: string | null;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  directories: string[];
  files: string[];
}

interface SettingsState {
  data: AppSettings;
  loading: boolean;
  loaded: boolean;
  modalOpen: boolean;
  /** When non-null, Settings opens to this tab instead of 'general'. */
  initialTab: string | null;
  /** In-flight form edits preserved across modal close/reopen; null = synced with `data`. */
  draft: AppSettings | null;
  /** Tab the user was on when they closed the modal with unsaved edits. */
  draftTab: string | null;
  /** Newest settings-write requestId. A stale GET that resolves after a newer
   *  fetch/PUT is dropped, so a slow boot fetch can't clobber a fresh write. */
  latestWriteId: string | null;
}

/** Baseline for every required settings field. Spread under any backend payload so an older saved shape that predates a newer field (e.g. new_agent_shortcut) can't surface as undefined and crash a consumer. */
export const DEFAULT_SETTINGS: AppSettings = {
  default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  default_folder: null,
  default_model: PROVEDOR_IA_DEFAULT_MODEL,
  default_mode: 'agent',
  default_max_turns: null,
  default_thinking_level: 'auto',
  zoom_sensitivity: 50,
  theme: 'light',
  new_agent_shortcut: 'Meta+l',
  anthropic_api_key: null,
  browser_homepage: 'https://duckduckgo.com',
  auto_select_mode_on_new_agent: false,
  expand_new_chats_in_dashboard: true,
  auto_reveal_sub_agents: true,
  dev_mode: false,
  allow_experimental_updates: false,
};

const initialState: SettingsState = {
  data: DEFAULT_SETTINGS,
  loading: false,
  loaded: false,
  modalOpen: false,
  initialTab: null,
  draft: null,
  draftTab: null,
  latestWriteId: null,
};

export const fetchSettings = createAsyncThunk('settings/fetch', async () => {
  const res = await fetch(SETTINGS_API);
  return (await res.json()) as AppSettings;
});

// Save ONLY the fields the user changed, merged server-side onto fresh state. Every renderer save uses this so a stale full object can never clobber a field the user didn't touch (e.g. one an agent just changed).
export const updateSettingsPatch = createAsyncThunk(
  'settings/patch',
  async (changes: Partial<AppSettings>) => {
    const res = await fetch(SETTINGS_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    const data = await res.json();
    return data.settings as AppSettings;
  }
);

export const resetSystemPrompt = createAsyncThunk(
  'settings/resetSystemPrompt',
  async () => {
    const res = await fetch(`${SETTINGS_API}/reset-system-prompt`, { method: 'POST' });
    const data = await res.json();
    return data.settings as AppSettings;
  }
);

export const dismissMcpSuggestion = createAsyncThunk(
  'settings/dismissMcpSuggestion',
  async (ids: string[]) => {
    const res = await fetch(`${SETTINGS_API}/dismiss-mcp-suggestion`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    return data.settings as AppSettings;
  }
);

export const browseDirectories = createAsyncThunk(
  'settings/browseDirectories',
  async (path: string) => {
    const res = await fetch(`${SETTINGS_API}/browse-directories?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return (await res.json()) as BrowseResult;
  }
);

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    openSettingsModal(state, action: PayloadAction<string | undefined>) {
      state.modalOpen = true;
      state.initialTab = action.payload ?? null;
    },
    closeSettingsModal(state) {
      state.modalOpen = false;
      state.initialTab = null;
    },
    /** Persist in-flight form edits + tab so they survive modal close; clearDraft drops the marker. */
    setDraft(state, action: PayloadAction<{ form: AppSettings; tab: string }>) {
      state.draft = action.payload.form;
      state.draftTab = action.payload.tab;
    },
    clearDraft(state) {
      state.draft = null;
      state.draftTab = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettings.pending, (state, action) => {
        state.loading = true;
        state.latestWriteId = action.meta.requestId;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        // Drop a stale response: boot fetches can race, so only the newest write/fetch wins.
        if (state.latestWriteId && action.meta.requestId !== state.latestWriteId) return;
        // Fill any field an older backend shape omitted so no consumer reads undefined; the payload still wins for everything it does send.
        const merged = { ...DEFAULT_SETTINGS, ...action.payload };
        // Skip ref-assignment when byte-identical; keeps background refetch polls from re-firing every effect.
        const next = JSON.stringify(merged);
        const prev = JSON.stringify(state.data);
        if (next !== prev) {
          state.data = merged;
        }
      })
      .addCase(fetchSettings.rejected, (state) => {
        state.loading = false;
        state.loaded = true;
      })
      .addCase(updateSettingsPatch.fulfilled, (state, action) => {
        // A user save is authoritative; claim newest so an in-flight GET can't overwrite it, and consume the draft so reopening shows the saved state.
        state.latestWriteId = action.meta.requestId;
        state.data = { ...DEFAULT_SETTINGS, ...action.payload };
        state.draft = null;
        state.draftTab = null;
      })
      .addCase(resetSystemPrompt.fulfilled, (state, action) => {
        state.latestWriteId = action.meta.requestId;
        state.data = { ...DEFAULT_SETTINGS, ...action.payload };
        state.draft = null;
        state.draftTab = null;
      })
      .addCase(dismissMcpSuggestion.fulfilled, (state, action) => {
        state.latestWriteId = action.meta.requestId;
        state.data = { ...DEFAULT_SETTINGS, ...action.payload };
      });
  },
});

export const { openSettingsModal, closeSettingsModal, setDraft, clearDraft } = settingsSlice.actions;
export default settingsSlice.reducer;
