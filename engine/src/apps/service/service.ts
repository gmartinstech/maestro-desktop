// engine/src/apps/service/service.ts -- ENG-7's native handler for /api/service/*, wired into
// server.ts ahead of its generic native/proxy branch, same convention as ENG-3's
// settings/handler.ts::handleSettingsHttpRequest.
//
// Ports backend/apps/service/service.py's user-facing HTTP surface: usage-summary, cost-breakdown,
// status, submit/event (frontend telemetry ingestion), spool/count. Does NOT port the SubApp's
// lifespan background loops (p_pulse_loop's periodic 9Router cost sampling, p_drain_loop's spool
// drainer, the 9Router auto-start kickoff) -- those need ENG-6 (9Router native supervision, a
// sibling ticket in this phase) and AGT's agent_manager, neither in scope here. See sessions.ts's
// and telemetryClient.ts's own headers for the identical, more detailed version of this gap.
// drainSpool() from telemetryClient.ts is exported and ready for whichever ticket wires up the
// periodic loop.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { computeCostBreakdown, computeUsageSummary } from './sessions';
import { count as spoolCount, type SpoolEntry } from './spool';
import { spoolPath, sync } from './telemetryClient';

function parseJsonBody(request: FastifyRequest): unknown {
  // Fastify's own body parsers are disabled engine-wide (server.ts), so request.body always
  // arrives as a raw Buffer here -- same convention settings/handler.ts's
  // parseJsonObjectBody establishes, generalized to accept an array body too (service.py's
  // /submit endpoint accepts either a JSON object OR a batched array; see its own docstring).
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Handles one /submit item -- accepts the frontend report() flat shape {s,a,p,...} or the legacy
// {kind,payload} wrapper. Mirrors service.py's post_submit per-item logic (minus the analytics
// frontend-bridge validation, which lives in backend/apps/service/analytics/* -- out of this
// ticket's scope, same "not ported yet" note as the pulse loop above).
function submitOneItem(item: unknown): void {
  if (!isPlainObject(item)) return;
  if ('s' in item || 'a' in item || 'p' in item) {
    sync(item);
    return;
  }
  const kind = typeof item.kind === 'string' ? item.kind : '';
  const payload = item.payload;
  if (kind && isPlainObject(payload)) {
    sync({ ...payload, kind });
  }
}

function handleSubmit(body: unknown, reply: FastifyReply): void {
  if (Array.isArray(body)) {
    for (const item of body) submitOneItem(item);
    reply.code(200).send({ ok: true });
    return;
  }
  if (!isPlainObject(body)) {
    reply.code(200).send({ ok: false, error: 'JSON object or array required' });
    return;
  }
  if ('s' in body || 'a' in body || 'p' in body) {
    sync(body);
    reply.code(200).send({ ok: true });
    return;
  }
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const payload = body.payload;
  if (kind && isPlainObject(payload)) {
    sync(payload);
    reply.code(200).send({ ok: true });
    return;
  }
  reply.code(200).send({ ok: false, error: 'expected {s,a,p,...} or {kind,payload}' });
}

function handleEvent(body: unknown, reply: FastifyReply): void {
  const b = isPlainObject(body) ? body : {};
  let surface = typeof b.surface === 'string' ? b.surface : typeof b.event_type === 'string' ? b.event_type : '';
  let action = typeof b.action === 'string' ? b.action : '';
  if (!action && surface.includes('.')) {
    const idx = surface.indexOf('.');
    action = surface.slice(idx + 1);
    surface = surface.slice(0, idx);
  }
  if (!surface) {
    reply.code(200).send({ ok: false, error: 'surface required' });
    return;
  }
  if (!action) action = 'fired';
  const props = isPlainObject(b.props) ? b.props : isPlainObject(b.properties) ? b.properties : {};
  sync({ s: surface.slice(0, 64), a: action.slice(0, 64), p: props });
  reply.code(200).send({ ok: true });
}

// Handles every /api/service/* path this ticket ports; returns false (reply untouched) for any
// other path/method so the caller falls back to proxying at Python -- same convention as
// settings/handler.ts::handleSettingsHttpRequest.
export async function handleServiceHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const method = request.method.toUpperCase();

  if (pathname === '/api/service/status' && method === 'GET') {
    reply.code(200).send({ status: 'ok', enabled: true });
    return true;
  }

  if (pathname === '/api/service/usage-summary' && method === 'GET') {
    reply.code(200).send(computeUsageSummary());
    return true;
  }

  if (pathname === '/api/service/cost-breakdown' && method === 'GET') {
    reply.code(200).send(computeCostBreakdown());
    return true;
  }

  if (pathname === '/api/service/submit' && method === 'POST') {
    handleSubmit(parseJsonBody(request), reply);
    return true;
  }

  if (pathname === '/api/service/event' && method === 'POST') {
    handleEvent(parseJsonBody(request), reply);
    return true;
  }

  if (pathname === '/api/service/spool/count' && method === 'GET') {
    let pending = 0;
    try { pending = spoolCount(spoolPath()); } catch { /* best-effort, matches client.py's own posture */ }
    reply.code(200).send({ pending });
    return true;
  }

  return false;
}

export type { SpoolEntry };
export { drainSpool } from './telemetryClient';
