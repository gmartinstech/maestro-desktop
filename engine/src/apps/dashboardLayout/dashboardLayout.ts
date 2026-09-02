// engine/src/apps/dashboardLayout/dashboardLayout.ts -- SUB-1's native HTTP handler for
// backend/apps/dashboard_layout/dashboard_layout.py's 2 routes (GET/PUT the bare /api/dashboard_layout
// path). See models.ts's header: this SubApp is unmounted/dead in the real backend today, so this
// handler has no live Python behavior to proxy-fall-back-parity against -- it only activates via an
// explicit MAESTRO_ENGINE_ROUTES=dashboard_layout:native opt-in (not in split.ts's DEFAULT_ROUTES).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { coerceDashboardLayout } from './models';
import { loadDashboardLayout, saveDashboardLayout } from './store';

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

export async function handleDashboardLayoutHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (pathname !== '/api/dashboard_layout') return false;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    reply.code(200).send(loadDashboardLayout());
    return true;
  }

  if (method === 'PUT') {
    const body = parseJsonObjectBody(request);
    if (body === null) {
      reply.code(400).send({ error: 'bad_request', detail: 'body must be a JSON object' });
      return true;
    }
    if (typeof body.cards !== 'object' || body.cards === null) {
      reply.code(400).send({ error: 'bad_request', detail: 'cards is required' });
      return true;
    }
    // DashboardLayoutUpdate(cards=..., view_cards=...) then re-wrapped into DashboardLayout by
    // dashboard_layout.py's update_layout -- coerceDashboardLayout applies the same per-entry
    // shape tolerance load() does (a documented leniency vs. pydantic's stricter 422-on-bad-shape,
    // acceptable given this SubApp's dead-code status, see this file's header).
    const layout = coerceDashboardLayout(body);
    saveDashboardLayout(layout);
    reply.code(200).send(layout);
    return true;
  }

  reply.code(405).send({ error: 'method_not_allowed', detail: `${method} not supported on /api/dashboard_layout` });
  return true;
}
