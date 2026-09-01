import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { defaultAppSettings } from './models';
import { saveSettings } from './store';
import { handleSettingsHttpRequest } from './handler';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-settings-handler-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleSettingsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  rmSync(join(dataRoot, 'settings'), { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

describe('GET /api/settings', () => {
  test('returns defaults when nothing is stored yet', async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { default_model: string };
    expect(body.default_model).toBe(defaultAppSettings().default_model);
  });
});

describe('PUT /api/settings', () => {
  test('persists a full object and returns it', async () => {
    const payload = { ...defaultAppSettings(), theme: 'dark', provedor_ia_token: 'mtok_x' };
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; settings: { theme: string; provedor_ia_token: string } };
    expect(body.ok).toBe(true);
    expect(body.settings.theme).toBe('dark');
    expect(body.settings.provedor_ia_token).toBe('mtok_x');

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const getBody = (await getRes.json()) as { theme: string };
    expect(getBody.theme).toBe('dark');
  });

  test('a server-owned field cannot be forged by a client PUT', async () => {
    saveSettings({ ...defaultAppSettings(), user_id: 'real-server-issued-id' });
    const forged = { ...defaultAppSettings(), user_id: 'attacker-supplied-id' };
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forged),
    });
    const body = (await res.json()) as { settings: { user_id: string } };
    expect(body.settings.user_id).toBe('real-server-issued-id');
  });

  test('a non-object body is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/settings', () => {
  test('merges only the sent fields onto current state', async () => {
    saveSettings({ ...defaultAppSettings(), theme: 'dark', browser_homepage: 'https://example.com' });
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'light' }),
    });
    const body = (await res.json()) as { settings: { theme: string; browser_homepage: string } };
    expect(body.settings.theme).toBe('light');
    expect(body.settings.browser_homepage).toBe('https://example.com');
  });
});

describe('unhandled paths', () => {
  test('a different /api/settings/* subpath is not handled here (falls through to proxy upstream)', async () => {
    const res = await fetch(`${baseUrl}/api/settings/maestro/token-status`);
    expect(res.status).toBe(404); // this test server's own fallback, proving handleSettingsHttpRequest returned false
  });
});
