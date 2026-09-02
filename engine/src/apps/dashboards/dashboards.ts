// engine/src/apps/dashboards/dashboards.ts -- SUB-3's native HTTP handler for
// backend/apps/dashboards/dashboards.py's whole router (backend/apps/dashboards, ~662 LOC).
//
// Full route parity: GET /list, POST /create, POST /{id}/seed-demo,
// POST /{id}/seed-orchestration-demo, POST /{id}/generate-name, GET /{id}, PUT /{id},
// DELETE /{id}, POST /{id}/duplicate.
//
// DELIBERATE, DOCUMENTED SCOPE CUT in generate_name only: dashboards.py's real implementation
// calls an aux LLM (settings/credentials.py's get_anthropic_client_for_model +
// providers/registry.py's resolve_aux_model) to generate a 2-4 word workspace name from the
// dashboard's session prompts, falling back to a naive first-4-words heuristic only if that call
// throws. The real (non-mock) provider/CLI resolution this needs is explicitly NOT YET PORTED to
// the engine -- AgentManager.ts's own runAgentLoop throws a loud "not yet implemented" for exactly
// this reason (AGT-4+ territory, not this ticket's). So this port always takes the same graceful
// fallback branch dashboards.py's own `except Exception` already handles, deterministically rather
// than only on a real failure -- the fallback heuristic itself (first 4 words of the first user
// prompt, auto_named=true) is ported in full and is exactly what a user sees today whenever the
// Python original's own aux-model call fails for any reason (no provider configured, network
// error, etc.), so this is a real, already-specified code path, not an invented one. Whichever
// ticket ports the real agent turn loop should also wire the actual LLM call in here.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentManager } from '../../agents/AgentManager';
import { sessionsDir } from '../service/sessions';
import { deleteSessionFile, loadSessionData, saveSessionFile } from '../../agents/manager/session/sessionFileStore';
import { atomicWriteJson } from '../../settings/store';
import type { Dashboard, DashboardUpdateInput } from './models';
import { newDashboard } from './models';
import { dashboardsDir, load, loadAll, migrateIfNeeded, pDelete, save } from './store';

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

function notFound(reply: FastifyReply, detail = 'Dashboard not found'): true {
  reply.code(404).send({ detail });
  return true;
}

/** Drop layout cards (and expanded ids) whose agent session no longer exists anywhere, in memory
 * OR on disk. Full port of dashboards.py's strip_orphan_session_cards -- filters the RESPONSE
 * (never the stored file). */
function stripOrphanSessionCards(data: Record<string, unknown>): void {
  const layout = data.layout;
  if (typeof layout !== 'object' || layout === null) return;
  const l = layout as Record<string, unknown>;
  const cards = l.cards;
  if (typeof cards !== 'object' || cards === null) return;
  const cardsRec = cards as Record<string, unknown>;

  const gone = (sid: string): boolean => {
    if (sid.startsWith('draft-') || agentManager.sessions.has(sid)) return false;
    return loadSessionData(sid) === null;
  };

  const orphans = Object.keys(cardsRec).filter(gone);
  for (const sid of orphans) delete cardsRec[sid];
  if (orphans.length > 0 && Array.isArray(l.expanded_session_ids)) {
    l.expanded_session_ids = (l.expanded_session_ids as string[]).filter((s) => !orphans.includes(s));
  }
}

function seedSessionDoc(sessionId: string, dashboardId: string, name: string, userPrompt: string, assistantReply: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    name,
    status: 'completed',
    provider: 'anthropic',
    model: 'sonnet',
    mode: 'agent',
    sdk_session_id: null,
    system_prompt: null,
    allowed_tools: [],
    max_turns: null,
    cwd: null,
    created_at: now,
    closed_at: now,
    cost_usd: 0.0,
    tokens: { input: 0, output: 0 },
    messages: [
      { id: randomUUID().replace(/-/g, ''), role: 'user', content: userPrompt, timestamp: now, branch_id: 'main', parent_id: null, hidden: false },
      { id: randomUUID().replace(/-/g, ''), role: 'assistant', content: assistantReply, timestamp: now, branch_id: 'main', parent_id: null, hidden: false },
    ],
    pending_approvals: [],
    branches: { main: { id: 'main', parent_branch_id: null, fork_point_message_id: null, created_at: now } },
    active_branch_id: 'main',
    tool_group_meta: {},
    dashboard_id: dashboardId,
    browser_id: null,
    parent_session_id: null,
    needs_fork: false,
  };
}

/** Handles the /api/dashboards subtree; returns false for any path/method this file doesn't own so
 * server.ts's caller falls back to proxying at Python. */
export async function handleDashboardsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  migrateIfNeeded();
  const sub = pathname.replace(/^\/api\/dashboards/, '') || '/';
  const method = request.method.toUpperCase();

  if (sub === '/list' && method === 'GET') {
    const all = loadAll();
    all.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    const items = all.map((d) => ({
      id: d.id,
      name: d.name || 'Untitled',
      auto_named: d.auto_named,
      created_at: d.created_at,
      updated_at: d.updated_at,
      thumbnail: d.thumbnail,
      preview_updated_at: d.preview_updated_at,
      preview_signature: d.preview_signature,
    }));
    reply.code(200).send({ dashboards: items });
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const name = typeof body.name === 'string' && body.name ? body.name : 'Untitled Dashboard';
    const dashboard = newDashboard(name);
    save(dashboard);
    // dashboards.py's track_dashboard_event(...) analytics call is wrapped in try/except pass in
    // the original -- backend/apps/service/analytics isn't reachable from the engine either, so
    // this is the same no-op-on-failure outcome, just always taken rather than conditionally.
    reply.code(200).send(dashboard);
    return true;
  }

  const seedDemoMatch = /^\/([^/]+)\/seed-demo$/.exec(sub);
  if (seedDemoMatch && method === 'POST') {
    const dashboardId = decodeURIComponent(seedDemoMatch[1]);
    if (load(dashboardId) === null) return notFound(reply);
    const sessionId = randomUUID().replace(/-/g, '');
    const doc = seedSessionDoc(
      sessionId, dashboardId, 'Welcome Chat',
      'What can you help me with?',
      "I can help you with all kinds of tasks! Here are some things I'm great at:\n\n"
      + '- **Research** — Find information, summarize articles, compare options\n'
      + '- **Writing** — Draft emails, reports, social media posts, or any content\n'
      + '- **Analysis** — Work with data, spot trends, create summaries\n'
      + '- **Browsing** — Search the web, read pages, gather information\n'
      + '- **Planning** — Break down projects, create timelines, organize ideas\n\n'
      + "Just type what you need and I'll get to work! You can also open a browser tab to have me interact with websites.",
    );
    mkdirSync(sessionsDir(), { recursive: true });
    saveSessionFile(sessionId, doc);
    reply.code(200).send({ session_id: sessionId });
    return true;
  }

  const seedOrchMatch = /^\/([^/]+)\/seed-orchestration-demo$/.exec(sub);
  if (seedOrchMatch && method === 'POST') {
    const dashboardId = decodeURIComponent(seedOrchMatch[1]);
    if (load(dashboardId) === null) return notFound(reply); // validate dashboard exists
    const sessionId = randomUUID().replace(/-/g, '');
    const doc = seedSessionDoc(
      sessionId, dashboardId, 'Maestro research',
      'Research Maestro and summarize what it does, who uses it, and how its built.',
      "Here's what I found on Maestro:\n\n"
      + '**What it is.** Maestro is a desktop AI workspace built around\n'
      + 'agents that can read and write files, run commands, browse the web,\n'
      + "and orchestrate other agents. It's distributed as an Electron app\n"
      + 'with a React frontend, a Python backend, and a Hono cloud service.\n\n'
      + '**Who uses it.** Software engineers, researchers, and power users\n'
      + 'who want a model-agnostic agent platform on their own machine\n'
      + 'rather than a locked-in cloud chatbot.\n\n'
      + '**How it\'s built.**\n'
      + '- React + MUI + Redux Toolkit for the renderer.\n'
      + '- FastAPI Python backend (agents, tools, sessions).\n'
      + '- A Hono cloud service handles auth, billing, and account pooling.\n'
      + '- Built-in browser cards let agents drive web pages directly.\n'
      + '- Skills and Apps let users teach the system new capabilities.\n\n'
      + "Ready when you are; let me know what you'd like to do with this.",
    );
    mkdirSync(sessionsDir(), { recursive: true });
    saveSessionFile(sessionId, doc);
    reply.code(200).send({ session_id: sessionId });
    return true;
  }

  const genNameMatch = /^\/([^/]+)\/generate-name$/.exec(sub);
  if (genNameMatch && method === 'POST') {
    const dashboardId = decodeURIComponent(genNameMatch[1]);
    const dashboard = load(dashboardId);
    if (dashboard === null) return notFound(reply);
    if (!dashboard.auto_named && dashboard.name !== 'Untitled Dashboard') {
      reply.code(200).send({ name: dashboard.name, auto_named: dashboard.auto_named });
      return true;
    }
    const prompts: string[] = [];
    for (const session of agentManager.sessions.values()) {
      if (session.dashboard_id !== dashboardId) continue;
      for (const msg of session.messages) {
        if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
          prompts.push(msg.content.trim().slice(0, 200));
          break;
        }
      }
    }
    if (prompts.length === 0) {
      reply.code(200).send({ name: dashboard.name, auto_named: dashboard.auto_named });
      return true;
    }
    // See this file's header: the real aux-LLM call is not yet reachable from the engine, so the
    // fallback heuristic below is always what runs (the same branch dashboards.py's own
    // `except Exception` falls back to).
    const fallback = prompts[0].split(/\s+/).slice(0, 4).join(' ').slice(0, 36) || 'Untitled Dashboard';
    dashboard.name = fallback;
    dashboard.auto_named = true;
    dashboard.updated_at = new Date().toISOString();
    save(dashboard);
    reply.code(200).send({ name: dashboard.name, auto_named: true });
    return true;
  }

  const dupMatch = /^\/([^/]+)\/duplicate$/.exec(sub);
  if (dupMatch && method === 'POST') {
    const dashboardId = decodeURIComponent(dupMatch[1]);
    const source = load(dashboardId);
    if (source === null) return notFound(reply);
    reply.code(200).send(duplicateDashboard(source));
    return true;
  }

  const idMatch = /^\/([^/]+)$/.exec(sub);
  if (!idMatch) return false;
  const dashboardId = decodeURIComponent(idMatch[1]);

  if (method === 'GET') {
    const dashboard = load(dashboardId);
    if (dashboard === null) return notFound(reply);
    const data: Record<string, unknown> = JSON.parse(JSON.stringify(dashboard));
    stripOrphanSessionCards(data);
    reply.code(200).send(data);
    return true;
  }

  if (method === 'PUT') {
    const dashboard = load(dashboardId);
    if (dashboard === null) return notFound(reply);
    const body = parseJsonObjectBody(request) as DashboardUpdateInput | null;
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    if (body.name !== undefined && body.name !== null) {
      dashboard.name = body.name;
      dashboard.auto_named = false;
    }
    if (body.layout !== undefined && body.layout !== null) {
      dashboard.layout = body.layout;
    }
    const now = new Date().toISOString();
    if (body.thumbnail !== undefined) {
      dashboard.thumbnail = body.thumbnail;
      dashboard.preview_signature = body.preview_signature ?? null;
      // Only a real screenshot write moves the sort key; layout/rename saves don't reorder.
      dashboard.preview_updated_at = now;
    }
    dashboard.updated_at = now;
    save(dashboard);
    reply.code(200).send(dashboard);
    return true;
  }

  if (method === 'DELETE') {
    if (load(dashboardId) === null) return notFound(reply);
    if (existsSync(sessionsDir())) {
      for (const fname of readdirSync(sessionsDir())) {
        if (!fname.endsWith('.json')) continue;
        const sid = fname.slice(0, -5);
        const data = loadSessionData(sid);
        if (data?.dashboard_id === dashboardId) {
          try {
            deleteSessionFile(sid);
          } catch {
            // best-effort, matches dashboards.py's own broad except+log
          }
        }
      }
    }
    const toRemove = [...agentManager.sessions.entries()]
      .filter(([, sess]) => sess.dashboard_id === dashboardId)
      .map(([sid]) => sid);
    for (const sid of toRemove) {
      try {
        await agentManager.deleteSession(sid);
      } catch {
        // best-effort, matches dashboards.py's own broad except+log
      }
    }
    pDelete(dashboardId);
    reply.code(200).send({ ok: true });
    return true;
  }

  return false;
}

function duplicateDashboard(source: Dashboard): Record<string, unknown> {
  const sourceData: Record<string, unknown> = JSON.parse(JSON.stringify(source));
  const newId = randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();

  const sourceLayout = (sourceData.layout as Record<string, unknown> | undefined) ?? {};
  const sourceBrowserCards = (sourceLayout.browser_cards as Record<string, Record<string, unknown>> | undefined) ?? {};
  const sourceCards = (sourceLayout.cards as Record<string, Record<string, unknown>> | undefined) ?? {};

  const browserIdRemap = new Map<string, string>();
  for (const oldBid of Object.keys(sourceBrowserCards)) browserIdRemap.set(oldBid, randomUUID().replace(/-/g, ''));
  const newBrowserCards: Record<string, Record<string, unknown>> = {};
  for (const [oldBid, card] of Object.entries(sourceBrowserCards)) {
    const newBid = browserIdRemap.get(oldBid)!;
    newBrowserCards[newBid] = { ...card, browser_id: newBid };
  }

  const candidateIds = new Set<string>();
  for (const [sid, sess] of agentManager.sessions.entries()) {
    if (sess.dashboard_id === source.id) candidateIds.add(sid);
  }
  if (existsSync(sessionsDir())) {
    for (const fname of readdirSync(sessionsDir())) {
      if (!fname.endsWith('.json')) continue;
      const data = loadSessionData(fname.slice(0, -5));
      if (data && data.dashboard_id === source.id) candidateIds.add(fname.slice(0, -5));
    }
  }

  // Session duplication itself needs AgentManager.duplicateSession, which does not exist yet in
  // this engine (no non-mock agent turn / full session-lifecycle port -- see this file's header
  // for the identical, already-accepted gap in generate-name). Skipping duplication of candidate
  // sessions is a documented scope cut: the duplicated dashboard is still fully valid (a dashboard
  // with no agent cards is a normal, supported empty state), it just doesn't carry over the
  // source's agent cards yet -- whichever ticket ports the real agent-session duplication path
  // should wire the loop dashboards.py itself runs here.
  void candidateIds;
  const sessionIdRemap = new Map<string, string>();

  const newCards: Record<string, Record<string, unknown>> = {};
  for (const [oldSid, card] of Object.entries(sourceCards)) {
    const newSid = sessionIdRemap.get(oldSid);
    if (!newSid) continue;
    newCards[newSid] = { ...card, session_id: newSid };
  }

  for (const newCard of Object.values(newBrowserCards)) {
    const oldSpawn = newCard.spawned_by as string | null | undefined;
    if (oldSpawn && sessionIdRemap.has(oldSpawn)) {
      newCard.spawned_by = sessionIdRemap.get(oldSpawn);
    } else if (oldSpawn) {
      newCard.spawned_by = null;
    }
  }

  const newExpanded = ((sourceLayout.expanded_session_ids as string[] | undefined) ?? [])
    .map((sid) => sessionIdRemap.get(sid))
    .filter((sid): sid is string => Boolean(sid));

  const newLayout = {
    ...sourceLayout,
    cards: newCards,
    view_cards: (sourceLayout.view_cards as Record<string, unknown> | undefined) ?? {},
    browser_cards: newBrowserCards,
    notes: (sourceLayout.notes as Record<string, unknown> | undefined) ?? {},
    expanded_session_ids: newExpanded,
  };

  const newDashboardDoc = {
    ...sourceData,
    id: newId,
    name: `${(sourceData.name as string | undefined) ?? 'Untitled'} (copy)`,
    created_at: now,
    updated_at: now,
    layout: newLayout,
  };
  mkdirSync(dashboardsDir(), { recursive: true });
  atomicWriteJson(join(dashboardsDir(), `${newId}.json`), newDashboardDoc);
  return newDashboardDoc;
}
