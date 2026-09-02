// engine/src/apps/toolsLib/http.ts -- SUB-4, native HTTP handler for the /api/tools surface
// (backend/apps/tools_lib/tools_lib.py's FastAPI router), wired into server.ts the same way
// settings/handler.ts, apps/health/health.ts, and apps/skills/http.ts already are.
//
// Ported in full: /builtin, /builtin/permissions (GET/PUT), /trusted-sensitive-paths (GET/PUT),
// /list, /{id} (GET/PUT/DELETE), /create, /{id}/discover (the real MCP-server spawn-and-list path,
// this ticket's core ask), /{id}/oauth/disconnect.
//
// Deliberately NOT ported here (documented scope cuts, not silent gaps):
//   - /{id}/m365/device-login (+ /status, /disconnect) -- spawns a long-lived Node/Electron-as-Node
//     child that prints a device code to stdout for the user to enter at microsoft.com/device,
//     polled via a background thread until it exits. Real, but secondary (MS365 is one of many
//     integrations) process-management surface; the ticket's own gate gate is discover_tools'
//     spawn-then-list-then-teardown path, which IS fully ported. A follow-up ticket can port this
//     using the same ChildProcessWithoutNullStreams + stdout-line-scan pattern mcpDiscovery.ts
//     already establishes.
//   - /oauth/start, /oauth/cloud-claim, /google-oauth-token -- the proxied-OAuth browser-callback
//     dance (redirect to the Maestro gateway, claim a session_id, Google userinfo enrichment, a
//     local mimic of Google's token endpoint for the google-workspace-mcp subprocess). Pure HTTP
//     plumbing with no process-spawning of its own; cut to keep this ticket's scope on the
//     process-management core. oauthTokens.ts's persistCloudTokens/refresh* are still FULL ports
//     (used by /discover's pre-refresh check below), so wiring these three routes in later is
//     mostly new handler code, not new logic.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { homeStateDir } from '../../agents/manager/statePaths';
import { getAuthToken } from '../../auth/token';
import { engineFetch } from '../../net/http';
import { getInstallId } from './installId';
import { deriveMcpConfig } from './mcpConfig';
import { discoverMcpToolsHttp, discoverMcpToolsSse, discoverMcpToolsStdio, McpDiscoveryError } from './mcpDiscovery';
import { applyToolUpdate, BUILTIN_TOOLS, makeToolDefinition, type ToolCreate, type ToolDefinition, type ToolUpdate } from './models';
import {
  deleteTool,
  loadAllTools,
  loadBuiltinPermissions,
  loadTool,
  loadTrustedSensitivePaths,
  saveBuiltinPermissions,
  saveTool,
  saveTrustedSensitivePaths,
  ToolsLibHttpError,
} from './store';
import { classifyServices } from './toolTaxonomy';
import { refreshAirtableToken, refreshGoogleToken, refreshHubspotToken } from './oauthTokens';

function parseJsonObjectBody(request: FastifyRequest): Record<string, unknown> | null {
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ error: 'bad_request', detail });
  return true;
}

function sendToolsLibError(reply: FastifyReply, err: unknown): true {
  if (err instanceof ToolsLibHttpError) {
    reply.code(err.statusCode).send({ detail: err.message });
    return true;
  }
  throw err;
}

const MAESTRO_PORT = (): string => process.env.MAESTRO_PORT ?? '8324';

export async function handleToolsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!pathname.startsWith('/api/tools')) return false;
  const sub = pathname.slice('/api/tools'.length);
  const method = request.method.toUpperCase();

  if (sub === '/builtin' && method === 'GET') {
    reply.code(200).send({ tools: BUILTIN_TOOLS });
    return true;
  }

  if (sub === '/builtin/permissions' && method === 'GET') {
    reply.code(200).send({ permissions: loadBuiltinPermissions() });
    return true;
  }

  if (sub === '/builtin/permissions' && method === 'PUT') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const validTools = new Set(BUILTIN_TOOLS.map((t) => t.name));
    const validPolicies = new Set(['always_allow', 'ask', 'deny']);
    const perms = loadBuiltinPermissions();
    const incoming = (body.permissions as Record<string, unknown> | undefined) ?? {};
    for (const [name, policy] of Object.entries(incoming)) {
      if (validTools.has(name) && typeof policy === 'string' && validPolicies.has(policy)) perms[name] = policy;
    }
    saveBuiltinPermissions(perms);
    reply.code(200).send({ permissions: perms });
    return true;
  }

  if (sub === '/trusted-sensitive-paths' && method === 'GET') {
    reply.code(200).send({ patterns: loadTrustedSensitivePaths() });
    return true;
  }

  if (sub === '/trusted-sensitive-paths' && method === 'PUT') {
    const body = parseJsonObjectBody(request);
    const incoming = body && Array.isArray(body.patterns) ? (body.patterns as unknown[]) : null;
    if (!incoming) {
      reply.code(200).send({ patterns: loadTrustedSensitivePaths() });
      return true;
    }
    saveTrustedSensitivePaths(incoming.filter((p): p is string => typeof p === 'string' && p.length > 0));
    reply.code(200).send({ patterns: loadTrustedSensitivePaths() });
    return true;
  }

  if (sub === '/list' && method === 'GET') {
    const tools = loadAllTools().map((t) => {
      const placeholder = `${t.name} account`;
      if (t.connected_account_email === placeholder) return { ...t, connected_account_email: '' };
      return t;
    });
    reply.code(200).send({ tools });
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    if (typeof body.name !== 'string') return badRequest(reply, 'name is required');
    const create = body as unknown as ToolCreate;
    const tool = makeToolDefinition({
      name: create.name,
      description: create.description,
      command: create.command,
      mcp_config: create.mcp_config,
      credentials: create.credentials,
      auth_type: create.auth_type,
      auth_status: create.auth_status,
    });
    saveTool(tool);
    reply.code(200).send({ ok: true, tool });
    return true;
  }

  const discoverMatch = /^\/([^/]+)\/discover$/.exec(sub);
  if (discoverMatch && method === 'POST') {
    try {
      const tool = loadTool(decodeURIComponent(discoverMatch[1]));
      await runDiscovery(tool);
      reply.code(200).send({ ok: true, tool });
    } catch (err) {
      return sendToolsLibError(reply, err);
    }
    return true;
  }

  const oauthDisconnectMatch = /^\/([^/]+)\/oauth\/disconnect$/.exec(sub);
  if (oauthDisconnectMatch && method === 'POST') {
    try {
      const tool = loadTool(decodeURIComponent(oauthDisconnectMatch[1]));
      const accessToken = (tool.oauth_tokens as Record<string, unknown>).access_token as string | undefined;
      if (accessToken && tool.name.toLowerCase() !== 'notion') {
        try {
          await engineFetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: accessToken }).toString(),
          });
        } catch (e) {
          console.warn(`Failed to revoke Google token for tool ${tool.id}: ${(e as Error).message}`);
        }
      }
      tool.oauth_tokens = {};
      tool.auth_status = 'configured';
      tool.connected_account_email = null;
      saveTool(tool);
      reply.code(200).send({ ok: true, tool });
    } catch (err) {
      return sendToolsLibError(reply, err);
    }
    return true;
  }

  const idMatch = /^\/([^/]+)$/.exec(sub);
  if (!idMatch) return false;
  const toolId = decodeURIComponent(idMatch[1]);

  if (method === 'GET') {
    try {
      reply.code(200).send(loadTool(toolId));
    } catch (err) {
      return sendToolsLibError(reply, err);
    }
    return true;
  }

  if (method === 'PUT') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    try {
      const tool = loadTool(toolId);
      const updated = applyToolUpdate(tool, body as unknown as ToolUpdate);
      saveTool(updated);
      reply.code(200).send({ ok: true, tool: updated });
    } catch (err) {
      return sendToolsLibError(reply, err);
    }
    return true;
  }

  if (method === 'DELETE') {
    deleteTool(toolId);
    reply.code(200).send({ ok: true });
    return true;
  }

  return false;
}

/** The real discover_tools handler: refreshes an expiring OAuth token if needed, derives the
 * claude_agent_sdk mcp_servers config, spawns/connects through whichever transport the config
 * names, classifies the returned tool names into services/read-write, and persists the result onto
 * the tool. This is the process-spawn path the ticket's own GATE exercises end-to-end. */
async function runDiscovery(tool: ToolDefinition): Promise<void> {
  if (tool.auth_type === 'oauth2' && tool.auth_status === 'connected') {
    const oauthTokens = tool.oauth_tokens as Record<string, unknown>;
    if (oauthTokens.refresh_token) {
      const lower = tool.name.toLowerCase();
      const refreshed =
        lower === 'airtable' ? await refreshAirtableToken(tool, { save: saveTool })
        : lower === 'hubspot' ? await refreshHubspotToken(tool, { save: saveTool })
        : await refreshGoogleToken(tool, { save: saveTool });
      if (!refreshed && oauthTokens.access_token) {
        const expiry = (oauthTokens.token_expiry as number | undefined) ?? 0;
        if (Date.now() / 1000 >= expiry - 60) {
          throw new ToolsLibHttpError(502, `OAuth token expired and refresh failed. Try reconnecting ${tool.name}.`);
        }
      }
    }
  }

  const config = deriveMcpConfig(tool, {
    homeStateDir: () => homeStateDir(),
    getInstallId,
    getAuthToken,
    maestroPort: MAESTRO_PORT,
  });
  if (!config) throw new ToolsLibHttpError(400, 'Cannot derive MCP config for tool');

  const transport = (config.type as string | undefined) ?? '';

  let rawTools: Array<{ name: string; description: string; inputSchema?: unknown }>;
  try {
    if (transport === 'stdio') {
      const command = config.command as string | undefined;
      if (!command) throw new ToolsLibHttpError(400, "stdio transport requires a 'command' in MCP config");
      rawTools = await discoverMcpToolsStdio(command, config.args as string[] | undefined, config.env as Record<string, string> | undefined);
    } else if (transport === 'http' || transport === 'sse' || config.url) {
      const url = (config.url as string | undefined) ?? '';
      if (!url) throw new ToolsLibHttpError(400, "HTTP/SSE transport requires a 'url' in MCP config");
      if (transport === 'sse') {
        rawTools = await discoverMcpToolsSse(url, config.headers as Record<string, string> | undefined);
      } else {
        try {
          rawTools = await discoverMcpToolsHttp(url, config.headers as Record<string, string> | undefined);
        } catch (e) {
          if (!(e instanceof McpDiscoveryError)) throw e;
          console.info(`Streamable HTTP failed for ${tool.name}, retrying with SSE transport`);
          rawTools = await discoverMcpToolsSse(url, config.headers as Record<string, string> | undefined);
        }
      }
    } else {
      throw new ToolsLibHttpError(400, `Unsupported MCP transport type: '${transport}'. Use 'stdio', 'http', or 'sse'.`);
    }
  } catch (e) {
    if (e instanceof ToolsLibHttpError || e instanceof McpDiscoveryError) {
      throw new ToolsLibHttpError(e.statusCode, e.message);
    }
    const msg = (e as Error).message?.trim() || (e as Error).constructor?.name || 'unknown error';
    console.warn(`MCP tool discovery failed for ${tool.name}: ${msg}`);
    throw new ToolsLibHttpError(502, `Discovery failed: ${msg}`);
  }

  const toolNames = rawTools.map((t) => t.name);
  const { services, serviceGroups, allRead, allWrite } = classifyServices(toolNames, tool.name);
  const existingPerms = (tool.tool_permissions ?? {}) as Record<string, unknown>;
  // Read-only actions auto-allow by default (no prompt for safe, scoped reads); writes still
  // default to "ask". Any choice the user already made is kept.
  const permissions: Record<string, unknown> = {};
  for (const n of toolNames) {
    permissions[n] = existingPerms[n] ?? (allRead.includes(n) ? 'always_allow' : 'ask');
  }
  permissions._categories = { read: allRead, write: allWrite };
  permissions._services = services;
  permissions._service_groups = serviceGroups;
  permissions._tool_descriptions = Object.fromEntries(rawTools.map((t) => [t.name, t.description]));
  permissions._tool_schemas = Object.fromEntries(rawTools.filter((t) => t.inputSchema).map((t) => [t.name, t.inputSchema]));

  tool.tool_permissions = permissions;
  saveTool(tool);
}
