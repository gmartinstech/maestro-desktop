// engine/src/apps/modes/modes.ts -- SUB-1's native HTTP handler for backend/apps/modes/modes.py's
// /api/modes surface, wired into server.ts the same way settings/handler.ts, apps/health/health.ts
// and agents/http.ts already are (a `handle*HttpRequest` returning true/false). Full native --
// every route modes.py exposes is ported here (unlike settings/agents' deliberately partial cuts),
// since the whole SubApp is 6 small routes over one on-disk JSON store, no external dependency.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { applyModeUpdate, builtinModes, modeFromCreate, type ModeCreateInput, type ModeUpdateInput } from './models';
import { deleteModeFile, ensureSeeded, loadAllModes, loadModeByIdOrNull, saveMode } from './store';

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

function notFound(reply: FastifyReply): true {
  reply.code(404).send({ detail: 'Mode not found' });
  return true;
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ error: 'bad_request', detail });
  return true;
}

export async function handleModesHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!pathname.startsWith('/api/modes')) return false;
  const sub = pathname.slice('/api/modes'.length);
  const method = request.method.toUpperCase();

  if (sub === '/list' && method === 'GET') {
    ensureSeeded();
    const builtinDefaults: Record<string, unknown> = {};
    for (const m of builtinModes()) builtinDefaults[m.id] = m;
    reply.code(200).send({ modes: loadAllModes(), builtin_defaults: builtinDefaults });
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    if (typeof body.name !== 'string') return badRequest(reply, 'name is required');
    ensureSeeded();
    const mode = modeFromCreate(body as unknown as ModeCreateInput);
    saveMode(mode);
    reply.code(200).send({ ok: true, mode });
    return true;
  }

  const idMatch = /^\/([^/]+)(\/reset)?$/.exec(sub);
  if (!idMatch) return false;
  const modeId = decodeURIComponent(idMatch[1]);
  const isReset = idMatch[2] !== undefined;

  if (isReset && method === 'POST') {
    ensureSeeded();
    const builtin = builtinModes().find((m) => m.id === modeId);
    if (!builtin) return badRequest(reply, 'Only built-in modes can be reset');
    saveMode(builtin);
    reply.code(200).send({ ok: true, mode: builtin });
    return true;
  }

  if (!isReset && method === 'GET') {
    ensureSeeded();
    const mode = loadModeByIdOrNull(modeId);
    if (!mode) return notFound(reply);
    reply.code(200).send(mode);
    return true;
  }

  if (!isReset && method === 'PUT') {
    ensureSeeded();
    const mode = loadModeByIdOrNull(modeId);
    if (!mode) return notFound(reply);
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const updated = applyModeUpdate(mode, body as unknown as ModeUpdateInput);
    saveMode(updated);
    reply.code(200).send({ ok: true, mode: updated });
    return true;
  }

  if (!isReset && method === 'DELETE') {
    ensureSeeded();
    const mode = loadModeByIdOrNull(modeId);
    if (!mode) return notFound(reply);
    if (mode.is_builtin) {
      reply.code(403).send({ detail: 'Cannot delete built-in modes' });
      return true;
    }
    deleteModeFile(modeId);
    reply.code(200).send({ ok: true });
    return true;
  }

  return false;
}
