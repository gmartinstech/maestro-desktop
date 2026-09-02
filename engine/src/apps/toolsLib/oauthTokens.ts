// engine/src/apps/toolsLib/oauthTokens.ts -- SUB-4, a full port of the token-shaping/refresh half
// of backend/apps/tools_lib/oauth_tokens.py. The proxied OAuth start/claim HTTP routes themselves
// (oauth/start, oauth/cloud-claim, google-oauth-token) are a deliberate scope cut -- see
// apps/toolsLib/http.ts's own header for why -- but the pure token-shaping + refresh-over-HTTP
// logic those routes (and discover_tools' pre-refresh check) depend on is ported here in full,
// since it's real, testable logic with no HTTP-route-specific plumbing of its own.

import { join } from 'node:path';
import { engineFetch } from '../../net/http';
import { MAESTRO_OAUTH_BASE_URL } from './oauthConfig';
import type { ToolDefinition } from './models';

// Tool name -> provider key for the OAuth helper service. All providers go through the Maestro
// gateway's cloud-proxy so client_secret values never ship inside the desktop binary.
const TOOL_NAME_TO_PROVIDER: Record<string, string> = {
  airtable: 'airtable',
  hubspot: 'hubspot',
  discord: 'discord',
  notion: 'notion',
  github: 'github',
  // Built-in Google tool's name is "Google Workspace"; accept the bare "google" alias too.
  'google workspace': 'google',
  google: 'google',
};

export function proxiedProviderFor(tool: ToolDefinition): string | null {
  return TOOL_NAME_TO_PROVIDER[tool.name.toLowerCase()] ?? null;
}

/** Normalize the cloud's claim response into tool.oauth_tokens. Per-provider shaping mirrors what
 * the pre-cloud-proxy local-callback flow used to write; the rest of the app (refresh helpers, MCP
 * env injection) expects exactly this shape. Mutates `tool` in place, matching the Python
 * original's own mutate-then-caller-saves convention. */
export function persistCloudTokens(tool: ToolDefinition, tokens: Record<string, unknown>): void {
  const name = tool.name.toLowerCase();
  if (name === 'discord') {
    const newGuilds = (Array.isArray(tokens._guilds) ? (tokens._guilds as Array<Record<string, unknown>>) : []);
    const existing = (Array.isArray((tool.oauth_tokens as Record<string, unknown>).guilds) ? ((tool.oauth_tokens as Record<string, unknown>).guilds as Array<Record<string, unknown>>) : []);
    for (const g of newGuilds) {
      if (g.id && !existing.some((e) => e.id === g.id)) existing.push({ id: g.id, name: g.name ?? '' });
    }
    tool.oauth_tokens = { guilds: existing };
    const names = existing.map((g) => g.name).filter(Boolean).join(', ');
    tool.connected_account_email = `${existing.length} server${existing.length !== 1 ? 's' : ''}` + (names ? ` · ${names}` : '');
  } else if (name === 'notion') {
    tool.oauth_tokens = { access_token: tokens.access_token ?? '' };
    tool.connected_account_email = (tokens.workspace_name as string | undefined) || 'Notion workspace';
  } else if (name === 'github') {
    // GitHub OAuth-App tokens don't expire and carry no refresh_token, so store the bare token; the
    // cloud callback enriches `login` for the label.
    tool.oauth_tokens = { access_token: tokens.access_token ?? '' };
    const login = tokens.login as string | undefined;
    tool.connected_account_email = login ? `@${login}` : '';
  } else {
    tool.oauth_tokens = {
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token ?? '',
      token_expiry: Date.now() / 1000 + ((tokens.expires_in as number | undefined) ?? 3600),
    };
    tool.connected_account_email =
      (tokens.email as string | undefined) || // Google (post-userinfo enrichment)
      (tokens.hub_domain as string | undefined) || // HubSpot
      (tokens.workspace_name as string | undefined) ||
      `${tool.name} account`;
  }
  tool.auth_type = 'oauth2';
  tool.auth_status = 'connected';
}

export interface RefreshDeps {
  /** Persists the tool's mutated oauth_tokens/auth_status back to disk. Injected rather than
   * imported to avoid a store.ts <-> oauthTokens.ts import cycle risk (store.ts has no need to
   * import this file); the real caller passes apps/toolsLib/store.ts's saveTool. */
  save: (tool: ToolDefinition) => void;
}

/** Refresh an OAuth access_token by POSTing the refresh_token to the Maestro gateway's helper
 * service. Per-provider wrappers below pass a default expires_in fallback for providers that don't
 * return one. */
async function refreshViaProxy(provider: string, tool: ToolDefinition, defaultExpiry: number, deps: RefreshDeps): Promise<string | null> {
  if (tool.auth_type !== 'oauth2') return null;
  const refreshToken = (tool.oauth_tokens as Record<string, unknown>).refresh_token as string | undefined;
  if (!refreshToken) return null;
  const expiry = ((tool.oauth_tokens as Record<string, unknown>).token_expiry as number | undefined) ?? 0;
  if (Date.now() / 1000 < expiry - 60) return (tool.oauth_tokens as Record<string, unknown>).access_token as string | undefined ?? null;

  try {
    const resp = await engineFetch(`${MAESTRO_OAUTH_BASE_URL}/api/oauth/${provider}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (resp.status === 401) {
      // Provider rejected; user revoked at the provider's side. Mark as needing re-auth so the UI
      // prompts a Reconnect.
      tool.auth_status = 'expired';
      deps.save(tool);
      console.warn(`${provider} refresh rejected (user revoked); marking tool as expired`);
      return null;
    }
    if (resp.status !== 200) {
      console.warn(`${provider} cloud refresh failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const body = (await resp.json()) as { tokens?: Record<string, unknown> };
    const data = body.tokens ?? {};
    const newToken = data.access_token as string | undefined;
    if (!newToken) return null;
    (tool.oauth_tokens as Record<string, unknown>).access_token = newToken;
    (tool.oauth_tokens as Record<string, unknown>).token_expiry = Date.now() / 1000 + ((data.expires_in as number | undefined) ?? defaultExpiry);
    if (data.refresh_token) {
      // Some providers (HubSpot, Airtable) rotate refresh_tokens on every refresh. Persist the new
      // one or future refreshes will fail.
      (tool.oauth_tokens as Record<string, unknown>).refresh_token = data.refresh_token;
    }
    // Backfill identity label on first successful refresh after upgrade.
    if (!tool.connected_account_email && data.email) tool.connected_account_email = data.email as string;
    deps.save(tool);
    return newToken;
  } catch (e) {
    console.warn(`${provider} cloud refresh exception for tool ${tool.id}: ${(e as Error).message}`);
    return null;
  }
}

/** Refresh an expired Google access_token via the Maestro gateway's cloud-proxy. The client_secret
 * never leaves the gateway; desktop only POSTs the refresh_token. */
export function refreshGoogleToken(tool: ToolDefinition, deps: RefreshDeps): Promise<string | null> {
  return refreshViaProxy('google', tool, 3600, deps);
}

export function refreshAirtableToken(tool: ToolDefinition, deps: RefreshDeps): Promise<string | null> {
  return refreshViaProxy('airtable', tool, 7200, deps);
}

export function refreshHubspotToken(tool: ToolDefinition, deps: RefreshDeps): Promise<string | null> {
  return refreshViaProxy('hubspot', tool, 1800, deps);
}

/** Return the on-disk path to the bundled MS365 MCP server entry, falling back to the legacy
 * pre-bundle npm-servers layout when the bundle isn't present. `backendDir` is the absolute path to
 * the (read-only) backend/ tree, injected so this file doesn't hardcode a repo-root walk of its
 * own -- apps/toolsLib/mcpConfig.ts's P_BACKEND_DIR is the canonical resolution. */
export function m365ServerScript(backendDir: string): string {
  return join(backendDir, 'mcp-bundles', 'softeria-ms-365-mcp-server', 'dist', 'index.js');
}

/** MS365 MCP token-cache paths, shared across process spawns. `homeStateDir` is the caller's
 * apps/toolsLib/store.ts-adjacent home-state-dir resolver (statePaths.ts's homeStateDir()). */
export function m365CacheEnv(cacheDir: string): Record<string, string> {
  return {
    MS365_MCP_TOKEN_CACHE_PATH: join(cacheDir, 'ms365-token-cache.json'),
    MS365_MCP_SELECTED_ACCOUNT_PATH: join(cacheDir, 'ms365-selected-account.json'),
  };
}
