import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { initAuthToken, resetAuthTokenForTests } from '../../auth/token';
import { handleDevHttpRequest } from './dev';

let fastify: FastifyInstance;
let baseUrl: string;
let savedPackaged: string | undefined;
let dataRoot: string;

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-dev-token-test-'));
  fastify = Fastify({ logger: false });
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleDevHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  if (savedPackaged !== undefined) process.env.MAESTRO_PACKAGED = savedPackaged;
  else delete process.env.MAESTRO_PACKAGED;
  resetAuthTokenForTests('');
});

afterAll(async () => {
  await fastify.close();
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('GET /api/dev/token', () => {
  test('answers with the real per-install token', async () => {
    initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    const res = await fetch(`${baseUrl}/api/dev/token`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token.length).toBeGreaterThan(0);
  });

  test('404s when MAESTRO_PACKAGED=1 (a real preload exists there instead)', async () => {
    savedPackaged = process.env.MAESTRO_PACKAGED;
    process.env.MAESTRO_PACKAGED = '1';
    const res = await fetch(`${baseUrl}/api/dev/token`);
    expect(res.status).toBe(404);
  });

  test('a different method on the same path is 405', async () => {
    const res = await fetch(`${baseUrl}/api/dev/token`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('unhandled paths', () => {
  test('a different path falls through (returns false)', async () => {
    const res = await fetch(`${baseUrl}/api/dev/other`);
    expect(res.status).toBe(404); // this test server's own fallback
  });
});
