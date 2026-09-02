// engine/src/apps/outputs/versions.test.ts -- SUB-5's vitest twin covering the ported
// backend/apps/outputs/versions.py + versions_routes.py surface: content-addressed capture/list/
// restore/branch, and the /api/output_versions HTTP routes.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { hydrateOutput } from './models';
import { outputsWorkspaceDir } from './paths';
import { load, save } from './workspaceIo';
import { branch, capture, deleteAll, listVersions, restore } from './versions';
import { handleOutputVersionsHttpRequest } from './versionsRoutes';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-output-versions-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

function makeFlatOutput(files: Record<string, string> = { 'index.html': '<html>v1</html>' }): string {
  const output = hydrateOutput({ name: 'App', description: 'd', files });
  save(output);
  return output.id;
}

describe('capture + listVersions (flat app, no workspace)', () => {
  test('first capture creates a version; an unchanged second capture returns the SAME version (dedup)', () => {
    const id = makeFlatOutput();
    const v1 = capture(id, { source: 'manual', label: 'first' });
    expect(v1).not.toBeNull();
    expect(listVersions(id)).toHaveLength(1);

    const v2 = capture(id, { source: 'auto' });
    expect(v2!.id).toBe(v1!.id); // nothing changed: no new manifest written
    expect(listVersions(id)).toHaveLength(1);
  });

  test('a real content change produces a NEW version with the prior one as parent', () => {
    const id = makeFlatOutput();
    const v1 = capture(id, { source: 'manual' })!;
    const output = load(id)!;
    output.files = { 'index.html': '<html>v2</html>' };
    save(output);
    const v2 = capture(id, { source: 'auto' })!;
    expect(v2.id).not.toBe(v1.id);
    const versions = listVersions(id);
    expect(versions).toHaveLength(2);
    expect(versions[0].id).toBe(v2.id); // newest first
  });

  test('returns null for an app that does not exist', () => {
    expect(capture('nonexistent', {})).toBeNull();
  });
});

describe('capture + restore (webapp_template app with a real workspace)', () => {
  test('restore brings files back to an earlier version and takes a pre_restore backup first', () => {
    const wsId = 'ws-versions-1';
    const wsDir = join(outputsWorkspaceDir(), wsId);
    mkdirSync(join(wsDir, 'frontend'), { recursive: true });
    writeFileSync(join(wsDir, 'run.sh'), '#!/bin/bash\necho v1\n', 'utf8');
    writeFileSync(join(wsDir, 'frontend', 'App.tsx'), 'v1', 'utf8');
    writeFileSync(join(wsDir, '.env'), 'FRONTEND_PORT=1234\n', 'utf8'); // must never be captured/restored

    const output = hydrateOutput({ name: 'WebApp', workspace_id: wsId });
    save(output);
    const v1 = capture(output.id, { source: 'manual', label: 'v1' })!;

    // Left UNCAPTURED on purpose: restore()'s own pre_restore snapshot (below) is what must
    // preserve this state -- capture()'s content-hash dedup means a pre_restore call whose state
    // was ALREADY captured (nothing changed since) correctly reuses that existing manifest rather
    // than writing a redundant one, so this asserts the case where it must write a fresh one.
    writeFileSync(join(wsDir, 'frontend', 'App.tsx'), 'v2 -- changed', 'utf8');
    writeFileSync(join(wsDir, 'frontend', 'New.tsx'), 'brand new file', 'utf8');

    const restored = restore(output.id, v1.id);
    expect(restored).not.toBeNull();
    expect(readFileSync(join(wsDir, 'frontend', 'App.tsx'), 'utf8')).toBe('v1');
    // A file added after v1 must be pruned back out on restore.
    expect(existsSync(join(wsDir, 'frontend', 'New.tsx'))).toBe(false);
    // The live .env is never touched by restore (machine-specific, not part of any snapshot).
    expect(readFileSync(join(wsDir, '.env'), 'utf8')).toBe('FRONTEND_PORT=1234\n');
    // restore() itself captured a pre_restore safety version (of the pre-restore v2 state) before
    // rewriting anything, so the v2 content is recoverable even though it was never explicitly saved.
    const versions = listVersions(output.id);
    const preRestore = versions.find((v) => v.source === 'pre_restore');
    expect(preRestore).toBeDefined();
    const preRestoreManifest = restore(output.id, preRestore!.id); // undo the undo: recover v2
    expect(preRestoreManifest).not.toBeNull();
    expect(readFileSync(join(wsDir, 'frontend', 'App.tsx'), 'utf8')).toBe('v2 -- changed');
    expect(existsSync(join(wsDir, 'frontend', 'New.tsx'))).toBe(true);
  });

  test('restore returns null for an unknown version id', () => {
    const output = hydrateOutput({ name: 'App' });
    save(output);
    expect(restore(output.id, 'not-a-real-version')).toBeNull();
  });
});

describe('branch', () => {
  test('mints a brand-new app (fresh id, "(copy)" suffix, independent workspace) from a version', () => {
    const wsId = 'ws-versions-branch';
    const wsDir = join(outputsWorkspaceDir(), wsId);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'run.sh'), '#!/bin/bash\necho hi\n', 'utf8');
    writeFileSync(join(wsDir, '.env.example'), 'BACKEND_PORT=NONE\nFRONTEND_PORT=4949\n', 'utf8');

    const output = hydrateOutput({ name: 'Original', workspace_id: wsId });
    save(output);
    const v1 = capture(output.id, { source: 'manual' })!;

    const newId = branch(output.id, v1.id);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(output.id);
    const branched = load(newId as string)!;
    expect(branched.name).toBe('Original (copy)');
    expect(branched.workspace_id).not.toBe(wsId);
    expect(existsSync(join(outputsWorkspaceDir(), branched.workspace_id as string, 'run.sh'))).toBe(true);
  });

  test('returns null for an unknown version id', () => {
    const output = hydrateOutput({ name: 'App' });
    save(output);
    expect(branch(output.id, 'nope')).toBeNull();
  });
});

describe('deleteAll', () => {
  test('removes every manifest/blob for an app without touching another app', () => {
    const idA = makeFlatOutput({ 'index.html': 'a' });
    const idB = makeFlatOutput({ 'index.html': 'b' });
    capture(idA, {});
    capture(idB, {});
    expect(listVersions(idA).length).toBeGreaterThan(0);
    deleteAll(idA);
    expect(listVersions(idA)).toHaveLength(0);
    expect(listVersions(idB).length).toBeGreaterThan(0);
  });

  test('is a no-op (never throws) when the app was never captured', () => {
    expect(() => deleteAll('never-captured')).not.toThrow();
  });
});

describe('HTTP /api/output_versions', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    fastify = Fastify({ logger: false });
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    fastify.all('*', async (request, reply) => {
      const pathname = (request.raw.url ?? '/').split('?')[0];
      const handled = await handleOutputVersionsHttpRequest(pathname, request, reply);
      if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
    });
    baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('GET lists versions, POST captures a new one', async () => {
    const id = makeFlatOutput();
    const captureRes = await fetch(`${baseUrl}/api/output_versions/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'manual', label: 'checkpoint' }),
    });
    expect(captureRes.status).toBe(200);
    const captured = (await captureRes.json()) as { ok: boolean; version: { label: string } };
    expect(captured.ok).toBe(true);
    expect(captured.version.label).toBe('checkpoint');

    const listRes = await fetch(`${baseUrl}/api/output_versions/${id}`);
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { versions: unknown[] };
    expect(listed.versions).toHaveLength(1);
  });

  test('POST /:id/:version/restore 404s on an unknown output', async () => {
    const res = await fetch(`${baseUrl}/api/output_versions/nope/nope/restore`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('POST /:id/:version/branch round-trips through the real store', async () => {
    const id = makeFlatOutput();
    const v = capture(id, {})!;
    const res = await fetch(`${baseUrl}/api/output_versions/${id}/${v.id}/branch`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; new_output_id: string };
    expect(body.ok).toBe(true);
    expect(load(body.new_output_id)).not.toBeNull();
  });
});
