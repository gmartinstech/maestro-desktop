// engine/src/apps/swarm/swarm.ts -- SUB-3's native HTTP handler for backend/apps/swarm/swarm.py's
// whole router (~1815 LOC across backend/apps/swarm, this being the SubApp's own 131-line slice).
//
// Full route parity, 4 endpoints: POST /export/preflight, POST /export, POST /import/preflight
// (multipart file upload), POST /import/commit. Staging is in-process with a TTL; a lost token
// just means re-open the file -- identical contract to swarm.py's own P_STAGING dict.
//
// import/preflight is the one route needing multipart/form-data parsing: server.ts's Fastify
// instance disables ALL content-type parsers in favor of raw-buffer passthrough (see server.ts's
// header -- a proxy must forward exact bytes), so unlike a normal Fastify app there is no
// @fastify/multipart plugin already attached to decode this for us. parseMultipartFile() below is
// a minimal, purpose-built parser for exactly the one shape shareApi.ts's frontend sends
// (`FormData.append('file', file)`, one file field, no other fields) -- not a general
// multipart/form-data implementation.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import {
  buildBundle,
  buildManifest,
  commit,
  detectConflicts,
  reviewBundle,
  stageUpload,
  summarize,
  swarmFilename,
  type StagedBundle,
} from './closure';
import type { EntityType, ImportCommitRequest, RequirementView } from './models';
import { BundleError, MAX_TOTAL_BYTES } from './ziputil';

const P_STAGING = new Map<string, { entry: StagedBundle; createdAt: number }>();
const P_STAGING_TTL_MS = 30 * 60 * 1000; // 30 minutes

function pGcStaging(): void {
  const now = Date.now();
  for (const [token, { entry, createdAt }] of P_STAGING) {
    if (now - createdAt > P_STAGING_TTL_MS) {
      P_STAGING.delete(token);
      rmSync(entry.sandbox, { recursive: true, force: true });
    }
  }
}

function pDiscard(token: string): void {
  const entry = P_STAGING.get(token);
  if (entry) {
    P_STAGING.delete(token);
    rmSync(entry.entry.sandbox, { recursive: true, force: true });
  }
}

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

interface ParsedMultipartFile {
  filename: string;
  data: Buffer;
}

/** Extracts the `file` field from a `multipart/form-data` body sent as exactly one file part (the
 * only shape shareApi.ts's frontend ever sends -- `new FormData(); form.append('file', file)`).
 * Returns null on anything that doesn't parse as that shape (missing boundary, no matching part,
 * malformed headers) -- caller treats null as "no file uploaded", same user-facing 400 FastAPI's
 * `UploadFile = File(...)` gives when the multipart body is missing/malformed. */
function parseMultipartFile(contentType: string, body: Buffer): ParsedMultipartFile | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m ? (m[1] ?? m[2]).trim() : null;
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = body.indexOf(delimiter, searchFrom);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length, next));
    searchFrom = next;
  }
  for (const part of parts) {
    // Each part is `\r\n<headers>\r\n\r\n<body>\r\n` (leading \r\n after the boundary marker, one
    // trailing \r\n before the next boundary marker) -- strip both before inspecting.
    let p = part;
    if (p.subarray(0, 2).toString('latin1') === '\r\n') p = p.subarray(2);
    if (p.subarray(-2).toString('latin1') === '\r\n') p = p.subarray(0, p.length - 2);
    const headerEnd = p.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = p.subarray(0, headerEnd).toString('latin1');
    const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText);
    if (!dispositionMatch) continue;
    const params = dispositionMatch[1];
    const nameMatch = /name="([^"]*)"/.exec(params);
    if (!nameMatch || nameMatch[1] !== 'file') continue;
    const filenameMatch = /filename="([^"]*)"/.exec(params);
    const data = p.subarray(headerEnd + 4);
    return { filename: filenameMatch ? filenameMatch[1] : '', data };
  }
  return null;
}

/** Handles the /api/swarm subtree; returns false for any path/method this file doesn't own so
 * server.ts's caller falls back to proxying at Python. */
export async function handleSwarmHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const sub = pathname.replace(/^\/api\/swarm/, '');
  const method = request.method.toUpperCase();

  if (sub === '/export/preflight' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const type = body.type as EntityType | undefined;
    const id = body.id as string | undefined;
    if (!type || !id) return badRequest(reply, 'type and id are required');
    try {
      const manifest = await buildManifest(type, id);
      reply.code(200).send({
        ok: true,
        summary: summarize(manifest),
        filename: swarmFilename(manifest.root.name),
        link_supported: false,
      });
    } catch (e) {
      if (e instanceof BundleError) {
        reply.code(400).send({ detail: e.message });
        return true;
      }
      throw e;
    }
    return true;
  }

  if (sub === '/export' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const type = body.type as EntityType | undefined;
    const id = body.id as string | undefined;
    if (!type || !id) return badRequest(reply, 'type and id are required');
    try {
      const { raw, rootName } = await buildBundle(type, id);
      const fname = swarmFilename(rootName);
      reply
        .code(200)
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${fname}"`)
        .send(raw);
    } catch (e) {
      if (e instanceof BundleError) {
        reply.code(400).send({ detail: e.message });
        return true;
      }
      throw e;
    }
    return true;
  }

  if (sub === '/import/preflight' && method === 'POST') {
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (raw.length > MAX_TOTAL_BYTES) {
      reply.code(400).send({ detail: 'file is too large' });
      return true;
    }
    const contentType = String(request.headers['content-type'] ?? '');
    const file = parseMultipartFile(contentType, raw);
    if (!file) return badRequest(reply, 'no file uploaded (expected multipart/form-data with a "file" field)');
    try {
      const { sandbox, manifest, warnings } = await stageUpload(file.data, file.filename);
      const conflicts = detectConflicts(sandbox, manifest);
      const review = await reviewBundle(sandbox, manifest);
      pGcStaging();
      const token = randomUUID().replace(/-/g, '');
      P_STAGING.set(token, { entry: { sandbox, manifest, warnings }, createdAt: Date.now() });
      reply.code(200).send({
        ok: true,
        summary: summarize(manifest),
        staging_token: token,
        conflicts,
        review,
        warnings,
      });
    } catch (e) {
      if (e instanceof BundleError) {
        reply.code(400).send({ detail: e.message });
        return true;
      }
      throw e;
    }
    return true;
  }

  if (sub === '/import/commit' && method === 'POST') {
    const body = parseJsonObjectBody(request) as (ImportCommitRequest & Record<string, unknown>) | null;
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const stagingToken = body.staging_token;
    if (typeof stagingToken !== 'string' || !stagingToken) return badRequest(reply, 'staging_token is required');
    const entry = P_STAGING.get(stagingToken);
    if (!entry) {
      reply.code(404).send({ detail: 'import session expired; please re-open the file' });
      return true;
    }
    const acceptRequirements = Array.isArray(body.accept_requirements) ? (body.accept_requirements as string[]) : [];
    try {
      const { rootType, rootId, created, unresolved } = commit(entry.entry.sandbox, entry.entry.manifest, acceptRequirements);
      pDiscard(stagingToken);
      if (rootId === null) {
        reply.code(400).send({ detail: 'bundle has no root entity' });
        return true;
      }
      const unresolvedView: RequirementView[] = unresolved.map((r) => ({ kind: r.kind, key: r.key, label: r.label, detail: r.detail }));
      reply.code(200).send({ ok: true, root_type: rootType, root_id: rootId, created, unresolved_requirements: unresolvedView });
    } catch (e) {
      pDiscard(stagingToken);
      if (e instanceof BundleError) {
        reply.code(400).send({ detail: e.message });
        return true;
      }
      throw e;
    }
    return true;
  }

  return false;
}
