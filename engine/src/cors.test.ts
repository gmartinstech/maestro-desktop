import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handleCorsPreflight } from './cors';

let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.all('*', async (request, reply) => {
    if (handleCorsPreflight(request, reply)) return;
    reply.code(200).send({ ok: true, method: request.method });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fastify.close();
});

describe('handleCorsPreflight', () => {
  test('a non-OPTIONS request is left untouched (falls through to the caller)', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { headers: { Origin: 'http://localhost:3000' } });
    const body = (await res.json()) as { method: string };
    expect(body.method).toBe('GET');
  });

  test('an allowed http://localhost:<port> origin gets a full CORS-sane 200', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods') ?? '').toContain('GET');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization');
    expect(res.headers.get('access-control-max-age')).toBe('600');
  });

  test('an allowed 127.0.0.1:<port> origin is accepted too', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });

  test('the exact Tauri WebView2 production origin is accepted', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { method: 'OPTIONS', headers: { Origin: 'http://tauri.localhost' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
  });

  test('a file:// origin (any suffix) is accepted', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { method: 'OPTIONS', headers: { Origin: 'file:///C:/some/renderer/index.html' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('file:///C:/some/renderer/index.html');
  });

  test('a disallowed origin never gets echoed back, and is answered 400', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example.com');
    expect(res.status).toBe(400);
  });

  test('a preflight with no Origin header at all is also refused (nothing to echo)', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.status).toBe(400);
  });

  test('answers OPTIONS identically regardless of which path is asked', async () => {
    const res = await fetch(`${baseUrl}/api/anything/at/all`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
