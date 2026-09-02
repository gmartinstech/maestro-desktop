// engine/src/apps/skills/http.test.ts -- SUB-2's vitest twin of the /api/skills HTTP surface,
// same real-Fastify-server pattern settings/handler.test.ts already established (a real listening
// server, exercised with plain `fetch()`, not a mocked request/reply pair).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { resetSkillsDirForTests, saveIndex, setSkillsDirForTests } from './skills';
import { handleSkillsHttpRequest } from './http';

let dir: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleSkillsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fastify.close();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-engine-skills-http-test-'));
  setSkillsDirForTests(dir);
});

afterEach(() => {
  resetSkillsDirForTests();
  rmSync(dir, { recursive: true, force: true });
});

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/skills/create + GET /api/skills/list', () => {
  test('creates a folder skill and lists it', async () => {
    const res = await postJson('/api/skills/create', { name: 'PDF Tk', content: 'body', description: 'fill forms' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skill: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.skill.id).toBe('pdf-tk');

    const listed = await fetch(`${baseUrl}/api/skills/list`);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { skills: Array<{ id: string }> };
    expect(listedBody.skills.some((s) => s.id === 'pdf-tk')).toBe(true);
  });
});

describe('GET/PUT/DELETE /api/skills/{id}', () => {
  test('full lifecycle: create, read, update, delete', async () => {
    await postJson('/api/skills/create', { name: 'Cycle', content: 'v1' });

    const got = await fetch(`${baseUrl}/api/skills/cycle`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { content: string }).content).toBe('v1');

    const updated = await fetch(`${baseUrl}/api/skills/cycle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'v2' }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { skill: { content: string } }).skill.content).toBe('v2');

    const deleted = await fetch(`${baseUrl}/api/skills/cycle`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);

    const missing = await fetch(`${baseUrl}/api/skills/cycle`);
    expect(missing.status).toBe(404);
  });

  test('DELETE on a built-in skill returns 409', async () => {
    // Seed the index directly so the skill is flagged built_in without needing the real bundled
    // source files (outputs/*.md) on disk.
    mkdirSync(join(dir, 'app_builder_skill'), { recursive: true });
    writeFileSync(join(dir, 'app_builder_skill', 'SKILL.md'), 'content', 'utf8');
    saveIndex({ app_builder_skill: { name: 'App Builder', built_in: true } });

    const res = await fetch(`${baseUrl}/api/skills/app_builder_skill`, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/skills/load', () => {
  test('resolves an installed skill to prompt-ready text', async () => {
    await postJson('/api/skills/create', { name: 'Loadable', content: 'loaded body' });
    const res = await postJson('/api/skills/load', { id: 'loadable' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; text: string };
    expect(body.ok).toBe(true);
    expect(body.text).toContain('loaded body');
  });

  test('an unknown id reports available ids instead of 404ing', async () => {
    await postJson('/api/skills/create', { name: 'Known', content: 'x' });
    const res = await postJson('/api/skills/load', { id: 'nope' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string; available: string[] };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unknown_skill');
    expect(body.available).toContain('known');
  });
});

describe('workspace seed/read', () => {
  test('seeds a workspace then reads it back with parsed frontmatter', async () => {
    const seeded = await postJson('/api/skills/workspace/seed', {
      workspace_id: 'ws1',
      skill_content: '---\nname: WS\ndescription: d\n---\nbody',
      meta: { foo: 'bar' },
    });
    expect(seeded.status).toBe(200);

    const read = await fetch(`${baseUrl}/api/skills/workspace/ws1`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { skill_content: string; meta: { foo: string }; frontmatter: { name: string } };
    expect(body.skill_content).toContain('body');
    expect(body.meta.foo).toBe('bar');
    expect(body.frontmatter.name).toBe('WS');
  });

  test('an unknown workspace 404s', async () => {
    const res = await fetch(`${baseUrl}/api/skills/workspace/nope`);
    expect(res.status).toBe(404);
  });
});
