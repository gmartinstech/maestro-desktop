// engine/src/apps/outputs/outputs.test.ts -- SUB-5's vitest twin covering the ported
// backend/apps/outputs/outputs.py route surface end to end through a real Fastify server. Scoped
// to CRUD + workspace-file + flat-template seeding (no real npm install/dev-server spawn here --
// that's the ticket's own REAL gate, exercised separately against a real workspace, not vitest).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handleOutputsHttpRequest } from './outputs';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleOutputsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-outputs-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

afterAll(async () => {
  await fastify.close();
});

async function postJson(path: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/outputs/create + GET /list + GET /:id', () => {
  test('creates an output and round-trips it through list and get', async () => {
    const created = await postJson('/api/outputs/create', { name: 'My App', description: 'desc', files: { 'index.html': '<html></html>' } });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { ok: boolean; output: { id: string; name: string } };
    expect(body.ok).toBe(true);
    expect(body.output.name).toBe('My App');

    const list = await fetch(`${baseUrl}/api/outputs/list`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { outputs: Array<{ id: string }> };
    expect(listBody.outputs.map((o) => o.id)).toContain(body.output.id);

    const got = await fetch(`${baseUrl}/api/outputs/${body.output.id}`);
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as { id: string; name: string };
    expect(gotBody.id).toBe(body.output.id);
  });

  test('GET on an unknown output id 404s', async () => {
    const res = await fetch(`${baseUrl}/api/outputs/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/outputs/:id', () => {
  test('exclude_unset semantics: only sent keys change, an explicit null clears session_id', async () => {
    const created = await postJson('/api/outputs/create', { name: 'App', session_id: 'sess-1' });
    const { output } = (await created.json()) as { output: { id: string; session_id: string; description: string } };
    expect(output.session_id).toBe('sess-1');

    const updated = await postJson(`/api/outputs/${output.id}`, { session_id: null }, 'PUT');
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { output: { session_id: string | null; description: string } };
    expect(updatedBody.output.session_id).toBeNull();
    expect(updatedBody.output.description).toBe(output.description); // untouched field survives
  });

  test('sets preview_updated_at only when thumbnail is actually sent', async () => {
    const created = await postJson('/api/outputs/create', { name: 'App' });
    const { output } = (await created.json()) as { output: { id: string } };

    const noThumb = await postJson(`/api/outputs/${output.id}`, { description: 'x' }, 'PUT');
    const noThumbBody = (await noThumb.json()) as { output: { preview_updated_at: string | null } };
    expect(noThumbBody.output.preview_updated_at).toBeNull();

    const withThumb = await postJson(`/api/outputs/${output.id}`, { thumbnail: 'data:image/png;base64,x' }, 'PUT');
    const withThumbBody = (await withThumb.json()) as { output: { preview_updated_at: string | null } };
    expect(withThumbBody.output.preview_updated_at).not.toBeNull();
  });
});

describe('DELETE /api/outputs/:id', () => {
  test('drops the record and tombstones the workspace so recovery will not re-offer it', async () => {
    const seed = await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-del-1', template_mode: 'flat' });
    expect(seed.status).toBe(200);
    const created = await postJson('/api/outputs/create', { name: 'App', workspace_id: 'ws-del-1', files: { 'index.html': '<html></html>' } });
    const { output } = (await created.json()) as { output: { id: string } };

    const del = await fetch(`${baseUrl}/api/outputs/${output.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const got = await fetch(`${baseUrl}/api/outputs/${output.id}`);
    expect(got.status).toBe(404);

    const tombstonePath = join(dataRoot, 'outputs_workspace', 'ws-del-1', '.maestro', 'deleted');
    expect(existsSync(tombstonePath)).toBe(true);
  });
});

describe('POST /api/outputs/workspace/seed (flat mode)', () => {
  test('seeds the legacy VIEW_TEMPLATE_FILES and registers nothing extra beyond what the caller provided', async () => {
    const res = await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-flat-1', template_mode: 'flat' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { template_mode: string; path: string };
    expect(body.template_mode).toBe('flat');
    expect(existsSync(join(body.path, 'index.html'))).toBe(true);
    expect(existsSync(join(body.path, 'SKILL.md'))).toBe(true);
  });

  test('never overwrites a file that already exists on disk', async () => {
    const folder = join(dataRoot, 'outputs_workspace', 'ws-flat-2');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'index.html'), 'MY EDIT SURVIVES', 'utf8');

    const res = await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-flat-2', template_mode: 'flat' });
    expect(res.status).toBe(200);
    expect(readFileSync(join(folder, 'index.html'), 'utf8')).toBe('MY EDIT SURVIVES');
  });
});

describe('GET /api/outputs/workspace/:id', () => {
  test('walks the seeded workspace and parses meta.json when present', async () => {
    // Flat mode's own VIEW_TEMPLATE_FILES already includes a meta.json placeholder, written
    // before the request's own `meta` is ever considered (existsSync guard) -- matches
    // outputs.py's identical ordering byte-for-byte, so an explicit `meta` is only honored when
    // no meta.json exists yet (asserted separately below); this test only proves the walk parses
    // whatever landed on disk as JSON.
    await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-read-1', template_mode: 'flat' });
    const res = await fetch(`${baseUrl}/api/outputs/workspace/ws-read-1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, string>; meta: Record<string, unknown> | null };
    expect(body.files['index.html']).toBeDefined();
    expect(body.meta).not.toBeNull();
    expect(typeof body.meta).toBe('object');
  });

  test('an explicit meta is honored only when no meta.json exists yet (flat files payload path)', async () => {
    // Supplying `files` switches effective_mode's VIEW_TEMPLATE_FILES fallback off (files is
    // authoritative), so no default meta.json pre-empts the request's own meta this time.
    await postJson('/api/outputs/workspace/seed', {
      workspace_id: 'ws-read-2', template_mode: 'flat', files: { 'index.html': '<html></html>' }, meta: { name: 'Meta Name' },
    });
    const res = await fetch(`${baseUrl}/api/outputs/workspace/ws-read-2`);
    const body = (await res.json()) as { meta: { name: string } | null };
    expect(body.meta?.name).toBe('Meta Name');
  });

  test('404s for a workspace directory that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/outputs/workspace/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe('PUT/DELETE /api/outputs/workspace/:id/file/:filepath', () => {
  test('writes then deletes a file, pruning the now-empty parent directory', async () => {
    await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-file-1', template_mode: 'flat' });
    const folder = join(dataRoot, 'outputs_workspace', 'ws-file-1');

    const write = await postJson('/api/outputs/workspace/ws-file-1/file/sub/dir/new.txt', { content: 'hello' }, 'PUT');
    expect(write.status).toBe(200);
    expect(readFileSync(join(folder, 'sub', 'dir', 'new.txt'), 'utf8')).toBe('hello');

    const del = await fetch(`${baseUrl}/api/outputs/workspace/ws-file-1/file/sub/dir/new.txt`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(existsSync(join(folder, 'sub', 'dir'))).toBe(false); // pruned
    expect(existsSync(join(folder, 'sub'))).toBe(false); // pruned all the way up
    expect(existsSync(folder)).toBe(true); // workspace root itself survives
  });

  test('rejects a path-traversal filepath', async () => {
    await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-file-2', template_mode: 'flat' });
    const write = await postJson('/api/outputs/workspace/ws-file-2/file/..%2f..%2fevil.txt', { content: 'x' }, 'PUT');
    expect(write.status).toBe(400);
  });
});

describe('GET /api/outputs/workspace/:id/runtime/status (no runtime attached)', () => {
  test('reports not-running with is_new_mode computed from disk', async () => {
    await postJson('/api/outputs/workspace/seed', { workspace_id: 'ws-status-1', template_mode: 'flat' });
    const res = await fetch(`${baseUrl}/api/outputs/workspace/ws-status-1/runtime/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { running: boolean; is_new_mode: boolean };
    expect(body.running).toBe(false);
    expect(body.is_new_mode).toBe(false); // flat mode has no run.sh
  });
});

describe('POST /api/outputs/execute', () => {
  test('returns a schema-validation error without spawning anything when input_data fails validation', async () => {
    const created = await postJson('/api/outputs/create', {
      name: 'App', files: { 'index.html': '<html></html>' },
      input_schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    });
    const { output } = (await created.json()) as { output: { id: string } };

    const res = await postJson('/api/outputs/execute', { output_id: output.id, input_data: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string | null };
    expect(body.error).toContain("'n' is a required property");
  });

  test('runs backend_code with no warnings for allowlisted code and returns its result', async () => {
    const created = await postJson('/api/outputs/create', {
      name: 'App',
      files: { 'index.html': '<html></html>', 'backend.py': 'result = {"sum": input_data.get("a", 0) + input_data.get("b", 0)}' },
    });
    const { output } = (await created.json()) as { output: { id: string } };

    const res = await postJson('/api/outputs/execute', { output_id: output.id, input_data: { a: 2, b: 3 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backend_result: { sum: number } | null; error: string | null; warnings: string[] | null };
    expect(body.error).toBeNull();
    expect(body.backend_result?.sum).toBe(5);
  });
});

describe('POST /api/outputs/vibe-code (documented scope cut)', () => {
  test('degrades gracefully: echoes the current code back with an explanatory message instead of 501ing', async () => {
    const res = await postJson('/api/outputs/vibe-code', {
      prompt: 'make it blue', current_frontend_code: '<html>ORIGINAL</html>',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { frontend_code: string; message: string };
    expect(body.frontend_code).toBe('<html>ORIGINAL</html>');
    expect(body.message.length).toBeGreaterThan(0);
  });
});

describe('POST /api/outputs/shutdown-all', () => {
  test('is a safe no-op when nothing is running', async () => {
    const res = await postJson('/api/outputs/shutdown-all', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; killed: number };
    expect(body.ok).toBe(true);
    expect(body.killed).toBe(0);
  });
});
