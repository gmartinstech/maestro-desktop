// engine/src/apps/skills/http.ts -- SUB-2's native HTTP handler for the /api/skills surface
// (backend/apps/skills/skills.py's FastAPI router), wired into server.ts the same way
// settings/handler.ts, apps/health/health.ts, and agents/http.ts already are (a
// `handle<X>HttpRequest` returning true/false).
//
// Full route parity with the Python router: GET /list, POST /load, POST /workspace/seed,
// GET /workspace/{workspace_id}, GET /{skill_id}, POST /create, PUT /{skill_id}, DELETE /{skill_id}.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SkillCreate, SkillUpdate } from './models';
import {
  SkillHttpError,
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  loadSkill,
  readSkillWorkspace,
  seedSkillWorkspace,
  updateSkill,
} from './skills';

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

function sendSkillError(reply: FastifyReply, err: unknown): true {
  if (err instanceof SkillHttpError) {
    reply.code(err.statusCode).send({ detail: err.message });
    return true;
  }
  throw err;
}

/** Handles the /api/skills subtree; returns false (reply left untouched) for any path/method this
 * file doesn't own so server.ts's caller falls back to proxying at Python. */
export async function handleSkillsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const sub = pathname.replace(/^\/api\/skills/, '');
  const method = request.method.toUpperCase();

  if (sub === '/list' && method === 'GET') {
    reply.code(200).send(listSkills());
    return true;
  }

  if (sub === '/load' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return badRequest(reply, 'id is required');
    reply.code(200).send(loadSkill(id));
    return true;
  }

  if (sub === '/workspace/seed' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : '';
    if (!workspaceId) return badRequest(reply, 'workspace_id is required');
    const skillContent = (body.skill_content as string | null | undefined) ?? null;
    const meta = (body.meta as Record<string, unknown> | null | undefined) ?? null;
    reply.code(200).send(seedSkillWorkspace(workspaceId, skillContent, meta));
    return true;
  }

  const workspaceMatch = /^\/workspace\/([^/]+)$/.exec(sub);
  if (workspaceMatch && method === 'GET') {
    try {
      reply.code(200).send(readSkillWorkspace(workspaceMatch[1]));
    } catch (err) {
      return sendSkillError(reply, err);
    }
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const name = typeof body.name === 'string' ? body.name : '';
    const content = typeof body.content === 'string' ? body.content : '';
    if (!name || !content) return badRequest(reply, 'name and content are required');
    const create: SkillCreate = {
      name,
      content,
      description: typeof body.description === 'string' ? body.description : '',
      command: typeof body.command === 'string' ? body.command : '',
    };
    reply.code(200).send(createSkill(create));
    return true;
  }

  const idMatch = /^\/([^/]+)$/.exec(sub);
  if (!idMatch) return false;
  const skillId = decodeURIComponent(idMatch[1]);

  if (method === 'GET') {
    try {
      reply.code(200).send(getSkill(skillId));
    } catch (err) {
      return sendSkillError(reply, err);
    }
    return true;
  }

  if (method === 'PUT') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const update: SkillUpdate = {
      name: (body.name as string | null | undefined) ?? undefined,
      description: (body.description as string | null | undefined) ?? undefined,
      content: (body.content as string | null | undefined) ?? undefined,
      command: (body.command as string | null | undefined) ?? undefined,
    };
    try {
      reply.code(200).send(updateSkill(skillId, update));
    } catch (err) {
      return sendSkillError(reply, err);
    }
    return true;
  }

  if (method === 'DELETE') {
    try {
      reply.code(200).send(deleteSkill(skillId));
    } catch (err) {
      return sendSkillError(reply, err);
    }
    return true;
  }

  return false;
}
