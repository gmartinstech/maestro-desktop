// engine/src/agents/http.ts -- AGT-6's native HTTP handler for the /api/agents surface (backend/
// apps/agents/agents.py), wired into server.ts's native/proxy branch the same way settings/
// handler.ts, apps/health/health.ts and apps/service/service.ts already are (a `handle*HttpRequest`
// returning true/false).
//
// NOT every route in agents.py's 896 lines is ported here -- only the ones this ticket's own gate
// (e2e/contract/golden-turn.spec.ts + the http/ws contract suite + a real driven turn) actually
// exercises, plus a handful of cheap, low-risk additions that reuse already-ported AGT-5 building
// blocks with no new persistence dependency (session list/get, message send, stop, approval, edit,
// branch switch/list, session update, close/delete). Everything else this file returns false for
// falls through to server.ts's proxy branch -- same "partial native" convention settings/handler.ts
// established, documented there and re-affirmed here: /generate-title, /generate-group-meta,
// /duplicate, /resume, /warm-cache, /compact, /clear, /browser-memory (GET+DELETE) all need either
// an aux LLM client or session_store.py's on-disk format, neither ported yet -- proxying them to the
// still-spawned Python backend keeps them working exactly as today, just not natively.
//
// One real behavioral gap this creates, documented rather than hidden: a session created through
// this native /launch lives ONLY in this engine process's AgentManager.sessions map. A client that
// falls through to Python for one of the un-ported routes above (e.g. GET /history, or a stray
// /duplicate call) is asking a process that has never heard of that session id -- Python's own
// agent_manager has a disjoint, independently-populated session dict. This is a real seam, not a
// bug in either side; SUB-10 ("Python is dark") is what removes the seam by removing Python
// entirely, not this ticket.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentConfig } from './core/models';
import { DEFAULT_ALLOWED_TOOLS } from './core/models';
import { agentManager } from './AgentManager';

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

function notFound(reply: FastifyReply, detail = 'Session not found'): true {
  reply.code(404).send({ detail });
  return true;
}

/** Builds a full AgentConfig from a parsed JSON body, filling every field pydantic's own defaults
 * would (core/models.py's AgentConfig) -- see that class's field defaults; this is the one place a
 * partial client payload becomes the fully-populated shape AgentLaunch.ts's launchAgent expects. */
function parseAgentConfig(body: Record<string, unknown>): AgentConfig {
  const initialRaw = body.initial_message as Record<string, unknown> | null | undefined;
  return {
    name: typeof body.name === 'string' ? body.name : '',
    model: typeof body.model === 'string' ? body.model : 'sonnet',
    mode: typeof body.mode === 'string' ? body.mode : 'agent',
    provider: typeof body.provider === 'string' ? body.provider : 'anthropic',
    system_prompt: (body.system_prompt as string | null) ?? null,
    allowed_tools: Array.isArray(body.allowed_tools) ? (body.allowed_tools as string[]) : [...DEFAULT_ALLOWED_TOOLS],
    max_turns: (body.max_turns as number | null) ?? null,
    target_directory: (body.target_directory as string | null) ?? null,
    dashboard_id: (body.dashboard_id as string | null) ?? null,
    workflow_run_id: (body.workflow_run_id as string | null) ?? null,
    workflow_edit_id: (body.workflow_edit_id as string | null) ?? null,
    selected_app_output_ids: (body.selected_app_output_ids as string[] | null) ?? null,
    initial_message: initialRaw
      ? {
          prompt: typeof initialRaw.prompt === 'string' ? initialRaw.prompt : '',
          images: (initialRaw.images as Array<Record<string, unknown>> | null) ?? null,
          context_paths: (initialRaw.context_paths as Array<Record<string, unknown>> | null) ?? null,
          forced_tools: (initialRaw.forced_tools as string[] | null) ?? null,
          attached_skills: (initialRaw.attached_skills as Array<Record<string, unknown>> | null) ?? null,
          selected_browser_ids: (initialRaw.selected_browser_ids as string[] | null) ?? null,
          selected_setting_ids: (initialRaw.selected_setting_ids as string[] | null) ?? null,
          client_message_id: (initialRaw.client_message_id as string | null) ?? null,
        }
      : null,
  };
}

async function handleLaunch(request: FastifyRequest, reply: FastifyReply): Promise<true> {
  const body = parseJsonObjectBody(request);
  if (body === null) return badRequest(reply, 'body must be a JSON object');
  const config = parseAgentConfig(body);
  const session = await agentManager.launchAgent(config);

  const initial = config.initial_message;
  if (initial === null) {
    reply.code(200).send({ session_id: session.id, session, prompt_delivered: false });
    return true;
  }
  if (!initial.prompt.trim()) {
    reply.code(400).send({ detail: 'initial_message.prompt is empty' });
    return true;
  }
  const delivered = await agentManager.sendMessage(session.id, initial.prompt, {
    images: initial.images ?? undefined,
    context_paths: initial.context_paths ?? undefined,
    forced_tools: initial.forced_tools ?? undefined,
    selected_browser_ids: initial.selected_browser_ids ?? undefined,
    selected_app_output_ids: config.selected_app_output_ids ?? undefined,
    selected_setting_ids: initial.selected_setting_ids ?? undefined,
    client_message_id: initial.client_message_id ?? undefined,
  });
  if (!delivered) {
    reply.code(500).send({ detail: 'Session launched but its first message could not be delivered' });
    return true;
  }
  reply.code(200).send({ session_id: session.id, session, prompt_delivered: true });
  return true;
}

// Handles the /api/agents subtree; returns false (reply left untouched) for any path/method this
// file doesn't own so server.ts's caller falls back to proxying at Python -- see this file's own
// header for the exact list and why.
export async function handleAgentsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const sub = pathname.replace(/^\/api\/agents/, '');
  const method = request.method.toUpperCase();

  if (sub === '/launch' && method === 'POST') return handleLaunch(request, reply);

  if (sub === '/activity' && method === 'GET') {
    reply.code(200).send({ active: agentManager.activeCount() });
    return true;
  }

  if (sub === '/sessions' && method === 'GET') {
    const query = request.query as Record<string, unknown>;
    const dashboardId = typeof query?.dashboard_id === 'string' && query.dashboard_id ? query.dashboard_id : undefined;
    reply.code(200).send({ sessions: agentManager.getAllSessions(dashboardId) });
    return true;
  }

  if (sub === '/approval' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const requestId = body.request_id;
    if (typeof requestId !== 'string' || !requestId) return badRequest(reply, 'request_id is required');
    agentManager.handleApproval(requestId, {
      behavior: body.behavior === 'allow' ? 'allow' : 'deny',
      message: (body.message as string | null) ?? null,
      updated_input: (body.updated_input as Record<string, unknown> | null) ?? null,
      trust_pattern: Boolean(body.trust_pattern),
      set_always_allow: Boolean(body.set_always_allow),
    });
    reply.code(200).send({ ok: true });
    return true;
  }

  const sessionMatch = /^\/sessions\/([^/]+)(\/.*)?$/.exec(sub);
  if (!sessionMatch) return false;
  const sessionId = sessionMatch[1];
  const rest = sessionMatch[2] ?? '';

  if (rest === '' && method === 'GET') {
    const session = agentManager.getSession(sessionId);
    if (!session) return notFound(reply);
    reply.code(200).send(session);
    return true;
  }

  if (rest === '' && method === 'PATCH') {
    if (!agentManager.getSession(sessionId)) return notFound(reply);
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    await agentManager.updateSession(sessionId, body);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '' && method === 'DELETE') {
    await agentManager.deleteSession(sessionId);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '/message' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (!prompt) return badRequest(reply, 'prompt is required');
    const delivered = await agentManager.sendMessage(sessionId, prompt, {
      mode: body.mode as string | undefined,
      model: body.model as string | undefined,
      images: body.images as Array<Record<string, unknown>> | undefined,
      context_paths: body.context_paths as Array<Record<string, unknown>> | undefined,
      forced_tools: body.forced_tools as string[] | undefined,
      hidden: Boolean(body.hidden),
      selected_browser_ids: body.selected_browser_ids as string[] | undefined,
      selected_app_output_ids: body.selected_app_output_ids as string[] | undefined,
      selected_setting_ids: body.selected_setting_ids as string[] | undefined,
      client_message_id: body.client_message_id as string | undefined,
    });
    reply.code(200).send({ ok: true, delivered });
    return true;
  }

  if (rest === '/stop' && method === 'POST') {
    await agentManager.stopAgent(sessionId);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '/edit_message' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const messageId = body.message_id;
    const content = typeof body.content === 'string' ? body.content : '';
    if (typeof messageId !== 'string' || !messageId || !content) return badRequest(reply, 'message_id and content are required');
    await agentManager.editMessage(sessionId, messageId, content);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '/switch_branch' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const branchId = typeof body.branch_id === 'string' ? body.branch_id : '';
    if (!branchId) return badRequest(reply, 'branch_id is required');
    await agentManager.switchBranch(sessionId, branchId);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '/close' && method === 'POST') {
    if (!agentManager.getSession(sessionId)) return notFound(reply);
    await agentManager.closeSession(sessionId);
    reply.code(200).send({ ok: true });
    return true;
  }

  if (rest === '/branches' && method === 'GET') {
    const session = agentManager.getSession(sessionId);
    if (!session) return notFound(reply);
    reply.code(200).send({ branches: session.branches, active_branch_id: session.active_branch_id });
    return true;
  }

  if (rest === '/browser-agents' && method === 'GET') {
    reply.code(200).send({ sessions: agentManager.getBrowserAgentChildren(sessionId) });
    return true;
  }

  return false;
}
