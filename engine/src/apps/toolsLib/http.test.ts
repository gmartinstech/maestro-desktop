// engine/src/apps/toolsLib/http.test.ts -- SUB-4's vitest twin of the /api/tools HTTP surface,
// same real-Fastify-server pattern settings/handler.test.ts and apps/skills/http.test.ts already
// established (a real listening server, exercised with plain `fetch()`, not a mocked request/reply
// pair).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handleToolsHttpRequest } from './http';
import { setBuiltinPermissionsPathForTests, setToolsDataDirForTests, setTrustedSensitivePathsPathForTests } from './store';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleToolsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fastify.close();
});

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-tools-http-test-'));
  setToolsDataDirForTests(join(dataRoot, 'tools'));
  setBuiltinPermissionsPathForTests(join(dataRoot, 'builtin_permissions.json'));
  setTrustedSensitivePathsPathForTests(join(dataRoot, 'trusted_sensitive_paths.json'));
});

afterEach(() => {
  setToolsDataDirForTests(null);
  setBuiltinPermissionsPathForTests(null);
  setTrustedSensitivePathsPathForTests(null);
  rmSync(dataRoot, { recursive: true, force: true });
});

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function putJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('GET /api/tools/builtin returns the full catalog', async () => {
  const res = await fetch(`${baseUrl}/api/tools/builtin`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tools: Array<{ name: string }> };
  expect(body.tools.some((t) => t.name === 'Bash')).toBe(true);
});

describe('create + list + get + update + delete', () => {
  test('full CRUD round trip', async () => {
    const created = await postJson('/api/tools/create', { name: 'My Tool', description: 'desc', mcp_config: { type: 'stdio', command: 'x' } });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { ok: boolean; tool: { id: string; name: string } };
    expect(createdBody.ok).toBe(true);
    const id = createdBody.tool.id;

    const listed = await fetch(`${baseUrl}/api/tools/list`);
    const listedBody = (await listed.json()) as { tools: Array<{ id: string }> };
    expect(listedBody.tools.some((t) => t.id === id)).toBe(true);

    const got = await fetch(`${baseUrl}/api/tools/${id}`);
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as { name: string };
    expect(gotBody.name).toBe('My Tool');

    const updated = await putJson(`/api/tools/${id}`, { description: 'new desc' });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { tool: { description: string } };
    expect(updatedBody.tool.description).toBe('new desc');

    const deleted = await fetch(`${baseUrl}/api/tools/${id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const afterDelete = await fetch(`${baseUrl}/api/tools/${id}`);
    expect(afterDelete.status).toBe(404);
  });
});

describe('builtin permissions', () => {
  test('GET returns {} on a fresh install, PUT persists a valid policy and rejects invalid ones', async () => {
    const initial = await fetch(`${baseUrl}/api/tools/builtin/permissions`);
    expect(((await initial.json()) as { permissions: Record<string, string> }).permissions).toEqual({});

    const put = await putJson('/api/tools/builtin/permissions', { permissions: { Bash: 'deny', NotARealTool: 'deny', Read: 'not_a_real_policy' } });
    const putBody = (await put.json()) as { permissions: Record<string, string> };
    expect(putBody.permissions.Bash).toBe('deny');
    expect(putBody.permissions.NotARealTool).toBeUndefined();
    expect(putBody.permissions.Read).toBeUndefined();

    const reread = await fetch(`${baseUrl}/api/tools/builtin/permissions`);
    expect(((await reread.json()) as { permissions: Record<string, string> }).permissions.Bash).toBe('deny');
  });
});

describe('trusted sensitive paths', () => {
  test('GET returns [] initially, PUT replaces the list, dedupes', async () => {
    const initial = await fetch(`${baseUrl}/api/tools/trusted-sensitive-paths`);
    expect(((await initial.json()) as { patterns: string[] }).patterns).toEqual([]);

    const put = await putJson('/api/tools/trusted-sensitive-paths', { patterns: ['*/.ssh/*', '*/.ssh/*', '/etc/*'] });
    const putBody = (await put.json()) as { patterns: string[] };
    expect(putBody.patterns).toEqual(['*/.ssh/*', '/etc/*']);
  });
});
