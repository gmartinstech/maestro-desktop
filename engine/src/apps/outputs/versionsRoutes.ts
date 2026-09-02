// engine/src/apps/outputs/versionsRoutes.ts -- SUB-5, a full TypeScript port of backend/apps/
// outputs/versions_routes.py: the HTTP surface for app version history. Thin: each route
// validates then delegates to versions.ts. Own route-table name ("output_versions", matching
// Python's `SubApp("output_versions", ...)` -> `/api/output_versions`), same
// handle<X>HttpRequest convention server.ts already uses for every other native SubApp.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { branch, capture, restore, listVersions } from './versions';
import { load } from './workspaceIo';
import { agentManager } from '../../agents/AgentManager';

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

function notFound(reply: FastifyReply, detail: string): true {
  reply.code(404).send({ detail });
  return true;
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ detail });
  return true;
}

export async function handleOutputVersionsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!pathname.startsWith('/api/output_versions')) return false;
  const sub = pathname.slice('/api/output_versions'.length) || '/';
  const method = request.method.toUpperCase();

  let m = /^\/([^/]+)\/([^/]+)\/restore$/.exec(sub);
  if (m && method === 'POST') {
    const [, outputId, versionId] = m;
    const output = load(outputId);
    if (!output) return notFound(reply, 'Output not found');
    // Don't restore out from under a live builder run -- the frontend disables the button while
    // the agent is active; this is the backend half of that guard.
    if (output.session_id) {
      const session = agentManager.sessions.get(output.session_id);
      if (session && (session.status === 'running' || session.status === 'waiting_approval')) {
        reply.code(409).send({ detail: 'This app is still being edited. Wait for the current change to finish, then try again.' });
        return true;
      }
    }
    const restored = restore(outputId, versionId);
    if (restored === null) return notFound(reply, 'Version not found');
    reply.code(200).send({ ok: true, output: restored });
    return true;
  }

  m = /^\/([^/]+)\/([^/]+)\/branch$/.exec(sub);
  if (m && method === 'POST') {
    const [, outputId, versionId] = m;
    if (!load(outputId)) return notFound(reply, 'Output not found');
    const newId = branch(outputId, versionId);
    if (newId === null) return notFound(reply, 'Version not found');
    reply.code(200).send({ ok: true, new_output_id: newId });
    return true;
  }

  m = /^\/([^/]+)$/.exec(sub);
  if (m && method === 'GET') {
    const [, outputId] = m;
    reply.code(200).send({ versions: listVersions(outputId) });
    return true;
  }
  if (m && method === 'POST') {
    const [, outputId] = m;
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    // Clients can only ask for auto/manual; pre_restore is set internally by restore().
    const source = body.source === 'auto' ? 'auto' : 'manual';
    const label = typeof body.label === 'string' ? body.label : '';
    const thumbnail = typeof body.thumbnail === 'string' ? body.thumbnail : null;
    const v = capture(outputId, { source, label, thumbnail });
    if (v === null) return notFound(reply, 'Output not found');
    reply.code(200).send({ ok: true, version: v });
    return true;
  }

  return false;
}
