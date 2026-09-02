// engine/src/agents/proxy/anthropicProxy.test.ts -- Fastify-level tests of the native
// /api/anthropic-proxy handler: real routing, a real (temp-dir-backed) settings store, and an
// injected fake fetch/nine-router-URL so no test ever dials a real network host. Covers this
// ticket's own two named risks: the CLI's x-api-key auth path, and the GPT-5 max_tokens rename
// provably firing on the wire body sent onward.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { defaultAppSettings } from '../../settings/models';
import { saveSettings } from '../../settings/store';
import { createHttpAuthHook } from '../../auth/middleware';
import { handleAnthropicProxyHttpRequest, type AnthropicProxyDeps } from './anthropicProxy';

const TEST_TOKEN = 'anthropic-proxy-test-token-0123456789';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;
let fakeUpstream: Server;
let fakeUpstreamBaseUrl: string;
let lastFakeUpstreamRequest: { method: string; url: string; headers: Record<string, string | string[] | undefined>; bodyText: string } | null = null;

function buildDeps(overrides: Partial<AnthropicProxyDeps> = {}): AnthropicProxyDeps {
  return { fetchImpl: fetch as any, nineRouterUrl: fakeUpstreamBaseUrl, ...overrides };
}

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-anthropic-proxy-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;

  // Stands in for "9Router" -- echoes back method/path/headers/body so both the routing (URL) and
  // the request-body transformation (the max_tokens rename) can be asserted on the wire, not just
  // in a unit test of the pure scrub function.
  fakeUpstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      lastFakeUpstreamRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, bodyText };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_fake', type: 'message', model: 'echo' }));
    });
  });
  await new Promise<void>((resolvePromise) => fakeUpstream.listen(0, '127.0.0.1', resolvePromise));
  fakeUpstreamBaseUrl = `http://127.0.0.1:${(fakeUpstream.address() as AddressInfo).port}`;

  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.addHook('onRequest', createHttpAuthHook(() => TEST_TOKEN));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleAnthropicProxyHttpRequest(pathname, request, reply, buildDeps());
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  lastFakeUpstreamRequest = null;
  rmSync(join(dataRoot, 'settings'), { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
  await new Promise<void>((resolvePromise) => fakeUpstream.close(() => resolvePromise()));
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

describe('auth (this ticket\'s risk #1: the route must stay NON-exempt, and x-api-key must be accepted)', () => {
  test('a request with no credentials at all is rejected before it ever reaches the handler', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/v1/messages`, {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [] }),
    });
    expect(res.status).toBe(401);
    expect(lastFakeUpstreamRequest).toBeNull();
  });

  test('the CLI\'s own credential shape -- x-api-key carrying our per-install token -- is accepted', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(lastFakeUpstreamRequest).not.toBeNull();
  });
});

describe('root healthcheck', () => {
  test('GET /api/anthropic-proxy answers 200 {ok:true} without touching any upstream', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy`, { headers: { 'x-api-key': TEST_TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(lastFakeUpstreamRequest).toBeNull();
  });
});

describe('routing + the GPT-5 max_tokens rename (this ticket\'s risk #2)', () => {
  test('a model with no configured key routes to the (fake) loopback 9Router with the 9router auth header', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(lastFakeUpstreamRequest!.url).toBe('/v1/messages');
    expect(lastFakeUpstreamRequest!.headers['x-api-key']).toBe('9router');
    // The CLI's own token must never reach the upstream -- it's stripped as a hop header.
    expect(lastFakeUpstreamRequest!.headers['x-api-key']).not.toBe(TEST_TOKEN);
  });

  test('GATE: a GPT-5-class model id gets max_tokens renamed to max_completion_tokens on the wire body actually sent onward', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(lastFakeUpstreamRequest!.bodyText);
    expect(sent.max_tokens).toBeUndefined();
    expect(sent.max_completion_tokens).toBe(256);
  });

  test('a non-GPT-5 model\'s body is forwarded with max_tokens left completely alone', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet', max_tokens: 256, messages: [] }),
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(lastFakeUpstreamRequest!.bodyText);
    expect(sent.max_tokens).toBe(256);
    expect(sent.max_completion_tokens).toBeUndefined();
  });

  test('a Claude model with an own Anthropic key set routes to api.anthropic.com on the anthropic-passthrough lane, never touching the loopback fake', async () => {
    saveSettings({ ...defaultAppSettings(), anthropic_api_key: 'sk-ant-configured' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    // reply.raw must be a real Writable (Readable.fromWeb(...).pipe(reply.raw) calls .on/.write/
    // .end on it) -- a PassThrough with writeHead/end spied on stands in for Fastify's real
    // http.ServerResponse here, same idea as server.test.ts's fake backend but for the response
    // side instead of the request side.
    const fakeRaw = new PassThrough() as unknown as { writeHead: (...args: unknown[]) => void; on: (...args: unknown[]) => void; write: (...args: unknown[]) => boolean; end: (...args: unknown[]) => void };
    (fakeRaw as unknown as PassThrough).resume(); // drain whatever gets piped in, we only assert on fetchImpl below
    fakeRaw.writeHead = vi.fn();
    const handled = await handleAnthropicProxyHttpRequest(
      '/api/anthropic-proxy/v1/messages',
      { method: 'POST', headers: {}, body: Buffer.from(JSON.stringify({ model: 'claude-3-5-sonnet', messages: [] })), raw: { url: '/api/anthropic-proxy/v1/messages' } } as any,
      { hijack: () => {}, raw: fakeRaw } as any,
      { fetchImpl: fetchImpl as any, nineRouterUrl: fakeUpstreamBaseUrl },
    );
    expect(handled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options).toEqual({ passthroughLane: 'anthropic-passthrough' });
    expect(init.headers['x-api-key']).toBe('sk-ant-configured');
    expect(lastFakeUpstreamRequest).toBeNull();
  });
});

describe('fallthrough', () => {
  test('a path outside /api/anthropic-proxy/v1/* returns false (not handled)', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic-proxy/some-other-path`, { headers: { 'x-api-key': TEST_TOKEN } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unhandled_by_this_test_server');
  });
});
