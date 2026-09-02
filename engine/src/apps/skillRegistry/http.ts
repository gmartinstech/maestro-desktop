// engine/src/apps/skillRegistry/http.ts -- SUB-2's native HTTP handler for the /api/skill-registry
// surface (backend/apps/skill_registry/skill_registry.py's FastAPI router, mounted at
// SubApp("skill-registry", ...) -> prefix "/api/skill-registry"), wired into server.ts the same
// way settings/handler.ts, apps/health/health.ts, and agents/http.ts already are.
//
// Full route parity with the Python router: GET /stats, GET /search, GET /detail/{skill_name},
// POST /install, POST /install-curated, GET /updates, POST /update. Note the route TABLE name is
// "skill-registry" (a hyphen, matching the actual /api/skill-registry URL prefix SubApp's
// name+prefix derivation produces), not "skill_registry" -- MAESTRO_ENGINE_ROUTES entries must use
// the hyphen form.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { SkillHttpError } from '../skills/skills';
import { registryDetail, registryInstall, registryInstallCurated, registrySearch, registryStats, registryUpdate, registryUpdates } from './skillRegistry';

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

async function sendSkillRegistryError(reply: FastifyReply, err: unknown): Promise<true> {
  if (err instanceof SkillHttpError) {
    reply.code(err.statusCode).send({ detail: err.message });
    return true;
  }
  throw err;
}

function parseIntParam(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Handles the /api/skill-registry subtree; returns false (reply left untouched) for any
 * path/method this file doesn't own so server.ts's caller falls back to proxying at Python. */
export async function handleSkillRegistryHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const sub = pathname.replace(/^\/api\/skill-registry/, '');
  const method = request.method.toUpperCase();

  if (sub === '/stats' && method === 'GET') {
    reply.code(200).send(registryStats());
    return true;
  }

  if (sub === '/search' && method === 'GET') {
    const query = request.query as Record<string, unknown>;
    const params = {
      q: typeof query.q === 'string' ? query.q : '',
      limit: Math.min(100, Math.max(1, parseIntParam(query.limit, 20))),
      offset: Math.max(0, parseIntParam(query.offset, 0)),
      category: typeof query.category === 'string' ? query.category : '',
      source: query.source === 'community' ? ('community' as const) : ('curated' as const),
    };
    reply.code(200).send(await registrySearch(params));
    return true;
  }

  const detailMatch = /^\/detail\/(.+)$/.exec(sub);
  if (detailMatch && method === 'GET') {
    const skillName = decodeURIComponent(detailMatch[1]);
    const result = registryDetail(skillName);
    if ('error' in result) {
      reply.code(404).send(result);
    } else {
      reply.code(200).send(result);
    }
    return true;
  }

  if (sub === '/install' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const source = typeof body.source === 'string' ? body.source : '';
    const skillId = typeof body.skill_id === 'string' ? body.skill_id : '';
    if (!source || !skillId) return badRequest(reply, 'source and skill_id are required');
    try {
      reply.code(200).send(await registryInstall({ source, skill_id: skillId, confirm: Boolean(body.confirm) }));
    } catch (err) {
      return sendSkillRegistryError(reply, err);
    }
    return true;
  }

  if (sub === '/install-curated' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const folder = typeof body.folder === 'string' ? body.folder : '';
    if (!folder) return badRequest(reply, 'folder is required');
    try {
      reply.code(200).send(await registryInstallCurated({ folder }));
    } catch (err) {
      return sendSkillRegistryError(reply, err);
    }
    return true;
  }

  if (sub === '/updates' && method === 'GET') {
    reply.code(200).send(await registryUpdates());
    return true;
  }

  if (sub === '/update' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const skillId = typeof body.skill_id === 'string' ? body.skill_id : '';
    if (!skillId) return badRequest(reply, 'skill_id is required');
    try {
      reply.code(200).send(await registryUpdate({ skill_id: skillId }));
    } catch (err) {
      return sendSkillRegistryError(reply, err);
    }
    return true;
  }

  return false;
}
