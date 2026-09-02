// engine/src/apps/modes/modes.test.ts -- SUB-1's HTTP-level tests for modes.ts, same scaffold
// settings/handler.test.ts established (a bare Fastify instance with only this handler wired in,
// MAESTRO_DATA_ROOT pointed at a throwaway temp dir).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { handleModesHttpRequest } from './modes';
import type { Mode } from './models';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-modes-handler-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleModesHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  rmSync(join(dataRoot, 'modes'), { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

describe('GET /api/modes/list', () => {
  test('seeds and returns the 5 builtin modes plus builtin_defaults', async () => {
    const res = await fetch(`${baseUrl}/api/modes/list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { modes: Mode[]; builtin_defaults: Record<string, Mode> };
    const ids = body.modes.map((m) => m.id).sort();
    expect(ids).toEqual(['agent', 'ask', 'plan', 'skill-builder', 'view-builder']);
    expect(Object.keys(body.builtin_defaults).sort()).toEqual(['agent', 'ask', 'plan', 'skill-builder', 'view-builder']);
  });
});

describe('POST /api/modes/create + GET /api/modes/{id}', () => {
  test('creates a custom mode and reads it back', async () => {
    const create = await fetch(`${baseUrl}/api/modes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Mode', description: 'custom' }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as { ok: boolean; mode: Mode };
    expect(created.ok).toBe(true);
    expect(created.mode.is_builtin).toBe(false);
    expect(created.mode.name).toBe('My Mode');

    const got = await fetch(`${baseUrl}/api/modes/${created.mode.id}`);
    expect(got.status).toBe(200);
    const mode = (await got.json()) as Mode;
    expect(mode.name).toBe('My Mode');
  });

  test('GET an unknown id 404s', async () => {
    const res = await fetch(`${baseUrl}/api/modes/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/modes/{id}', () => {
  test('only overwrites fields present in the body (exclude_unset semantics)', async () => {
    const create = await fetch(`${baseUrl}/api/modes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Original', description: 'orig-desc', icon: 'star' }),
    });
    const created = (await create.json()) as { mode: Mode };

    const update = await fetch(`${baseUrl}/api/modes/${created.mode.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as { ok: boolean; mode: Mode };
    expect(updated.mode.name).toBe('Renamed');
    expect(updated.mode.description).toBe('orig-desc');
    expect(updated.mode.icon).toBe('star');
  });
});

describe('POST /api/modes/{id}/reset', () => {
  test('restores a builtin mode to its hardcoded defaults', async () => {
    await fetch(`${baseUrl}/api/modes/list`); // trigger seed
    await fetch(`${baseUrl}/api/modes/agent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Tampered' }),
    });
    const reset = await fetch(`${baseUrl}/api/modes/agent/reset`, { method: 'POST' });
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { ok: boolean; mode: Mode };
    expect(body.mode.name).toBe('Agent');
  });

  test('refuses to reset a non-builtin id', async () => {
    const create = await fetch(`${baseUrl}/api/modes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Custom' }),
    });
    const created = (await create.json()) as { mode: Mode };
    const reset = await fetch(`${baseUrl}/api/modes/${created.mode.id}/reset`, { method: 'POST' });
    expect(reset.status).toBe(400);
  });
});

describe('DELETE /api/modes/{id}', () => {
  test('deletes a custom mode', async () => {
    const create = await fetch(`${baseUrl}/api/modes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Deletable' }),
    });
    const created = (await create.json()) as { mode: Mode };
    const del = await fetch(`${baseUrl}/api/modes/${created.mode.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const got = await fetch(`${baseUrl}/api/modes/${created.mode.id}`);
    expect(got.status).toBe(404);
  });

  test('refuses to delete a builtin mode (403)', async () => {
    await fetch(`${baseUrl}/api/modes/list`); // trigger seed
    const del = await fetch(`${baseUrl}/api/modes/agent`, { method: 'DELETE' });
    expect(del.status).toBe(403);
  });
});
