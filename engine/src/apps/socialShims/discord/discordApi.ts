// engine/src/apps/socialShims/discord/discordApi.ts -- SUB-9, a full port of the HTTP-plumbing half
// of backend/apps/discord_mcp_shim/server.py (p_call). Carries no credentials of its own; every
// tool call is forwarded as a small HTTPS request to the Discord helper service that includes a
// per-install identifier (used for rate-limiting). Refuses operations against guilds not in
// MAESTRO_DISCORD_GUILD_IDS (set at spawn time from the user's authorized guild list).
//
// PROXY_BASE defaults to the SAME already-approved Maestro provider gateway host every other
// engine module uses (net/http.ts's ALWAYS_ALLOWED_HOSTS) -- this is the existing, already-settled
// MAESTRO_OAUTH_BASE_URL value (see apps/toolsLib/oauthConfig.ts), not a new default and not a
// reintroduction of the pre-DET cloud broker host that default used to point at (deliberately not
// spelled here -- that's check-callhome.mjs's job, see its own header). check-callhome.mjs/
// check-provider-egress.mjs both re-verified clean for this file (see this ticket's own gate notes).

import { encodeQuery, requestJson } from '../common/httpJson';

// Read at call time, not module-load time: every real spawn of this subprocess only ever sees one
// fixed env (mcpConfig.ts sets it once before spawning, exactly like the Python original's own
// os.environ.get() module-level globals), so this is behaviorally identical in production, but lets
// tests set process.env per-case without needing vi.resetModules()/dynamic-import gymnastics.
function proxyBase(): string {
  return (process.env.MAESTRO_OAUTH_BASE_URL || 'https://llm.martinstech.net/v1').replace(/\/+$/, '');
}
function installId(): string {
  return process.env.MAESTRO_INSTALL_ID || '';
}
function allowedGuilds(): Set<string> {
  return new Set((process.env.MAESTRO_DISCORD_GUILD_IDS || '').split(',').filter(Boolean));
}

export interface DiscordCallResult {
  status: number;
  body: unknown;
}

/** Single hop to the Discord helper service. install_id header attribution is mandatory
 * server-side; if empty this fails locally so the user gets a clear error instead of an opaque 401. */
export async function discordCall(
  method: string,
  path: string,
  options: { body?: Record<string, unknown>; query?: Record<string, unknown> } = {},
): Promise<DiscordCallResult> {
  const INSTALL_ID = installId();
  if (!INSTALL_ID) return { status: 0, body: 'MAESTRO_INSTALL_ID env var not set; cannot call Discord proxy' };

  let url = `${proxyBase()}/api/discord${path}`;
  if (options.query) {
    const qs = encodeQuery(options.query);
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { 'X-Maestro-Install-Id': INSTALL_ID, Accept: 'application/json' };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  try {
    const result = await requestJson({ method, url, headers, body, timeoutMs: 30_000 });
    return { status: result.status, body: result.body };
  } catch (e) {
    return { status: 0, body: `Helper service unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Return an error string if guild_id is outside the user-authorized set, else null. The set is
 * sourced from MAESTRO_DISCORD_GUILD_IDS env var (CSV) which mcpConfig.ts populates from the tool's
 * oauth_tokens.guilds. If the env var is empty (no guild authorization yet), allow all -- the agent
 * shouldn't be able to spawn this MCP without an OAuth flow having happened. */
export function checkGuild(guildId: string): string | null {
  const allowed = allowedGuilds();
  if (allowed.size === 0) return null;
  if (!allowed.has(guildId)) {
    return `Guild ${guildId} is not authorized for this Maestro install. Authorized guilds: ${[...allowed].sort().join(', ')}`;
  }
  return null;
}
