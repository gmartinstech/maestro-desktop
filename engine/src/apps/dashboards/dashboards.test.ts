// engine/src/apps/dashboards/dashboards.test.ts -- SUB-3's vitest twin covering
// backend/apps/dashboards/dashboards.py's route surface end to end through a real Fastify server
// (no backend/tests/test_dashboards*.py exists to port from -- confirmed by search, this SubApp
// has no dedicated Python test file; its swarm-facing half is covered by closure.test.ts's
// dashboard export/import tests instead). These are written directly against dashboards.ts's own
// ported behavior: list/create/get/put/delete/duplicate, the migration-on-first-use, and orphan
// card stripping.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { agentManager } from '../../agents/AgentManager';
import { handleDashboardsHttpRequest } from './dashboards';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleDashboardsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-dashboards-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  agentManager.sessions.clear();
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  agentManager.sessions.clear();
});

afterAll(async () => {
  await fastify.close();
});

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/dashboards/create + GET /api/dashboards/list', () => {
  test('creates a dashboard and lists it, newest first', async () => {
    const create1 = await postJson('/api/dashboards/create', { name: 'First' });
    expect(create1.status).toBe(200);
    const d1 = (await create1.json()) as { id: string; name: string };
    expect(d1.name).toBe('First');

    await new Promise((r) => setTimeout(r, 5)); // ensure a distinct updated_at ordering
    const create2 = await postJson('/api/dashboards/create', { name: 'Second' });
    const d2 = (await create2.json()) as { id: string; name: string };

    const list = await fetch(`${baseUrl}/api/dashboards/list`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { dashboards: Array<{ id: string; name: string }> };
    expect(body.dashboards.map((d) => d.id)).toContain(d1.id);
    expect(body.dashboards.map((d) => d.id)).toContain(d2.id);
  });

  test('create with no name defaults to "Untitled Dashboard"', async () => {
    const res = await postJson('/api/dashboards/create', {});
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Untitled Dashboard');
  });
});

describe('GET/PUT/DELETE /api/dashboards/{id}', () => {
  test('round-trips a rename and a layout update through GET after PUT', async () => {
    const created = (await (await postJson('/api/dashboards/create', { name: 'Orig' })).json()) as { id: string };
    const put = await fetch(`${baseUrl}/api/dashboards/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { name: string; auto_named: boolean };
    expect(putBody.name).toBe('Renamed');
    expect(putBody.auto_named).toBe(false); // an explicit rename clears auto_named

    const get = await fetch(`${baseUrl}/api/dashboards/${created.id}`);
    const getBody = (await get.json()) as { name: string };
    expect(getBody.name).toBe('Renamed');
  });

  test('GET on a missing dashboard is a 404', async () => {
    const res = await fetch(`${baseUrl}/api/dashboards/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test('DELETE removes the dashboard (subsequent GET 404s)', async () => {
    const created = (await (await postJson('/api/dashboards/create', {})).json()) as { id: string };
    const del = await fetch(`${baseUrl}/api/dashboards/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
    const get = await fetch(`${baseUrl}/api/dashboards/${created.id}`);
    expect(get.status).toBe(404);
  });

  test('GET strips a card whose session exists nowhere (in memory or on disk)', async () => {
    const created = (await (await postJson('/api/dashboards/create', {})).json()) as { id: string };
    const put = await fetch(`${baseUrl}/api/dashboards/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        layout: {
          cards: { 'ghost-session': { session_id: 'ghost-session', x: 0, y: 0, width: 1, height: 1 } },
          view_cards: {}, browser_cards: {}, workflow_cards: {}, workflows_hub: null, notes: {},
          expanded_session_ids: ['ghost-session'],
        },
      }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${baseUrl}/api/dashboards/${created.id}`);
    const body = (await get.json()) as { layout: { cards: Record<string, unknown>; expanded_session_ids: string[] } };
    expect(body.layout.cards).toEqual({});
    expect(body.layout.expanded_session_ids).toEqual([]);
  });
});

describe('POST /api/dashboards/{id}/seed-demo + seed-orchestration-demo', () => {
  test('seed-demo creates a completed welcome session tagged to the dashboard', async () => {
    const created = (await (await postJson('/api/dashboards/create', {})).json()) as { id: string };
    const res = await postJson(`/api/dashboards/${created.id}/seed-demo`, {});
    expect(res.status).toBe(200);
    const { session_id: sessionId } = (await res.json()) as { session_id: string };
    expect(sessionId).toBeTruthy();
    const { loadSessionData } = await import('../../agents/manager/session/sessionFileStore');
    const doc = loadSessionData(sessionId)!;
    expect(doc.dashboard_id).toBe(created.id);
    expect(doc.status).toBe('completed');
    expect((doc.messages as unknown[]).length).toBe(2);
  });

  test('seed-orchestration-demo 404s for a nonexistent dashboard', async () => {
    const res = await postJson('/api/dashboards/nonexistent/seed-orchestration-demo', {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/dashboards/{id}/generate-name', () => {
  test('an already explicitly-named dashboard is returned unchanged', async () => {
    const created = (await (await postJson('/api/dashboards/create', { name: 'My Board' })).json()) as { id: string };
    const res = await postJson(`/api/dashboards/${created.id}/generate-name`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; auto_named: boolean };
    expect(body.name).toBe('My Board');
    expect(body.auto_named).toBe(false);
  });

  test('an untitled dashboard with a live session prompt gets a heuristic fallback name (documented scope cut: no real aux-LLM call yet)', async () => {
    const created = (await (await postJson('/api/dashboards/create', {})).json()) as { id: string };
    const { createAgentSession, createMessage, createMessageBranch } = await import('../../agents/sessionFactory');
    agentManager.sessions.set('live1', createAgentSession({
      id: 'live1', name: 'Agent', created_at: '2026-01-01T00:00:00Z', dashboard_id: created.id,
      branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00Z' }) },
      messages: [createMessage({ id: 'm1', role: 'user', content: 'plan my vacation to Japan', branch_id: 'main', timestamp: '2026-01-01T00:00:00Z' })],
    }));
    const res = await postJson(`/api/dashboards/${created.id}/generate-name`, {});
    const body = (await res.json()) as { name: string; auto_named: boolean };
    expect(body.auto_named).toBe(true);
    expect(body.name).toBe('plan my vacation to');
  });

  test('an untitled dashboard with no prompts is left as-is', async () => {
    const created = (await (await postJson('/api/dashboards/create', {})).json()) as { id: string };
    const res = await postJson(`/api/dashboards/${created.id}/generate-name`, {});
    const body = (await res.json()) as { name: string; auto_named: boolean };
    expect(body.name).toBe('Untitled Dashboard');
    expect(body.auto_named).toBe(false);
  });
});

describe('POST /api/dashboards/{id}/duplicate', () => {
  test('duplicates a dashboard under a new id with "(copy)" appended to the name', async () => {
    const created = (await (await postJson('/api/dashboards/create', { name: 'Original' })).json()) as { id: string };
    const res = await postJson(`/api/dashboards/${created.id}/duplicate`, {});
    expect(res.status).toBe(200);
    const dup = (await res.json()) as { id: string; name: string };
    expect(dup.id).not.toBe(created.id);
    expect(dup.name).toBe('Original (copy)');
  });

  test('404s for a nonexistent source dashboard', async () => {
    const res = await postJson('/api/dashboards/nonexistent/duplicate', {});
    expect(res.status).toBe(404);
  });
});

test('the very first request runs the one-time migration without error', async () => {
  const list = await fetch(`${baseUrl}/api/dashboards/list`);
  expect(list.status).toBe(200);
  const body = (await list.json()) as { dashboards: unknown[] };
  expect(Array.isArray(body.dashboards)).toBe(true);
});
