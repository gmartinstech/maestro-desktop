// engine/src/apps/swarm/swarm.test.ts -- SUB-3's vitest coverage of swarm.ts's own HTTP surface
// (export/preflight, export, import/preflight multipart parsing, import/commit + staging TTL) end
// to end through a real Fastify server. closure.test.ts already covers the underlying
// export/import machinery directly; this file's job is proving the HTTP plumbing around it (JSON
// bodies, the multipart file upload, status codes, staging-token lifecycle) actually works.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { loadIndex, resetSkillsDirForTests, saveIndex, setSkillsDirForTests, skillsDir } from '../skills/skills';
import { handleSwarmHttpRequest } from './swarm';

let skillDir: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleSwarmHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

beforeEach(() => {
  skillDir = mkdtempSync(join(tmpdir(), 'maestro-swarm-http-test-'));
  setSkillsDirForTests(skillDir);
});

afterEach(() => {
  resetSkillsDirForTests();
  rmSync(skillDir, { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
});

function makeSkill(slug: string, name: string, content: string): void {
  writeFileSync(join(skillsDir(), `${slug}.md`), content, 'utf8');
  const index = loadIndex();
  index[slug] = { name, description: 'desc', command: slug };
  saveIndex(index);
}

function multipartBody(filename: string, content: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----vitestSwarmBoundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /api/swarm/export/preflight + /export', () => {
  test('preflight summarizes a skill without writing a zip; export returns the real bundle', async () => {
    makeSkill('my-skill', 'My Skill', '# hi');
    const preflight = await fetch(`${baseUrl}/api/swarm/export/preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'skill', id: 'my-skill' }),
    });
    expect(preflight.status).toBe(200);
    const preflightBody = (await preflight.json()) as { ok: boolean; filename: string; summary: { root: { name: string } } };
    expect(preflightBody.ok).toBe(true);
    expect(preflightBody.filename).toBe('my-skill.swarm');
    expect(preflightBody.summary.root.name).toBe('My Skill');

    const exportRes = await fetch(`${baseUrl}/api/swarm/export`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'skill', id: 'my-skill' }),
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toBe('application/zip');
    expect(exportRes.headers.get('content-disposition')).toContain('my-skill.swarm');
    const bytes = Buffer.from(await exportRes.arrayBuffer());
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // zip magic
  });

  test('export of a nonexistent skill is a 400 with a safe message', async () => {
    const res = await fetch(`${baseUrl}/api/swarm/export`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'skill', id: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/nothing found to share/);
  });

  test('missing type/id is a 400', async () => {
    const res = await fetch(`${baseUrl}/api/swarm/export/preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/swarm/import/preflight + /import/commit', () => {
  test('a bare .md upload stages, previews, and commits into a real skill', async () => {
    const { body, contentType } = multipartBody('Cool Trick.md', Buffer.from('# Just markdown'));
    const preflight = await fetch(`${baseUrl}/api/swarm/import/preflight`, {
      method: 'POST', headers: { 'content-type': contentType }, body,
    });
    expect(preflight.status).toBe(200);
    const preflightBody = (await preflight.json()) as { ok: boolean; staging_token: string; summary: { root: { name: string } } };
    expect(preflightBody.ok).toBe(true);
    expect(preflightBody.summary.root.name).toBe('Cool Trick');
    expect(preflightBody.staging_token).toBeTruthy();

    const commitRes = await fetch(`${baseUrl}/api/swarm/import/commit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staging_token: preflightBody.staging_token, accept_requirements: [] }),
    });
    expect(commitRes.status).toBe(200);
    const commitBody = (await commitRes.json()) as { ok: boolean; root_type: string; root_id: string };
    expect(commitBody.ok).toBe(true);
    expect(commitBody.root_type).toBe('skill');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(skillsDir(), commitBody.root_id, 'SKILL.md'), 'utf8')).toBe('# Just markdown');
  });

  test('an expired/unknown staging token 404s on commit', async () => {
    const res = await fetch(`${baseUrl}/api/swarm/import/commit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staging_token: 'never-existed', accept_requirements: [] }),
    });
    expect(res.status).toBe(404);
  });

  test('a staging token is single-use: committing twice 404s the second time', async () => {
    const { body, contentType } = multipartBody('Once.md', Buffer.from('# once'));
    const preflight = await fetch(`${baseUrl}/api/swarm/import/preflight`, { method: 'POST', headers: { 'content-type': contentType }, body });
    const { staging_token: token } = (await preflight.json()) as { staging_token: string };
    const first = await fetch(`${baseUrl}/api/swarm/import/commit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ staging_token: token, accept_requirements: [] }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${baseUrl}/api/swarm/import/commit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ staging_token: token, accept_requirements: [] }),
    });
    expect(second.status).toBe(404);
  });

  test('a non-multipart body on import/preflight is a 400', async () => {
    const res = await fetch(`${baseUrl}/api/swarm/import/preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ not: 'multipart' }),
    });
    expect(res.status).toBe(400);
  });
});
