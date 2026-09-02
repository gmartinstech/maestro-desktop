// engine/src/apps/dashboardLayout/dashboardLayout.test.ts -- SUB-1's tests for this SubApp's own
// behavior. No backend/tests/ file exercises backend/apps/dashboard_layout directly (confirmed by
// search: zero references) -- it's unmounted dead code superseded by backend/apps/dashboards (see
// models.ts's header). These are written directly against this module's own ported logic, not a
// ported twin, and cover the same cases dashboard_layout.py's own code makes load-bearing: default
// on missing file, legacy-column-format reset, and a save/load round trip.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { handleDashboardLayoutHttpRequest } from './dashboardLayout';
import { defaultLayout } from './models';
import { loadDashboardLayout } from './store';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-dashboard-layout-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleDashboardLayoutHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  rmSync(join(dataRoot, 'dashboard_layout'), { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

test('loadDashboardLayout returns the empty default when no file exists', () => {
  expect(loadDashboardLayout()).toEqual(defaultLayout());
});

test('loadDashboardLayout resets to default for the old column-based shape', () => {
  const dir = join(dataRoot, 'dashboard_layout');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'layout.json'), JSON.stringify({ columns: [{ id: 'c1' }] }));
  expect(loadDashboardLayout()).toEqual(defaultLayout());
});

describe('GET/PUT /api/dashboard_layout', () => {
  test('round-trips a layout through PUT then GET', async () => {
    const payload = {
      cards: { s1: { session_id: 's1', x: 10, y: 20, width: 400, height: 300 } },
      view_cards: {},
    };
    const put = await fetch(`${baseUrl}/api/dashboard_layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/dashboard_layout`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as typeof payload;
    expect(body.cards.s1.session_id).toBe('s1');
    expect(body.cards.s1.x).toBe(10);
  });

  test('PUT without cards is a 400', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard_layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('unsupported method is a 405', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard_layout`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});
