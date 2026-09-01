// engine/src/server.test.ts -- proves the transparent-proxy behavior buildServer() promises,
// against a throwaway fake "backend" (plain node:http + a `ws` WebSocketServer), not the real
// Python process. Spawning the real backend and driving it through the engine end-to-end is
// exactly what the ENG-1 gate (scripts/run-contract-tests-via-engine.mjs / e2e/contract) does
// instead -- this file is the fast, dependency-free unit layer underneath that.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import type { RouteMode } from './split';

// Fixed test token -- these tests exercise proxy/native routing, not auth itself (see
// auth/middleware.test.ts for that), so every request below just needs to carry a valid one.
const P_TEST_TOKEN = 'server-test-token-0123456789';
const P_AUTH_HEADERS = { Authorization: `Bearer ${P_TEST_TOKEN}` };

let fakeBackend: Server;
let fakeBackendPort: number;
let wss: WebSocketServer;
let engine: FastifyInstance;
let engineHttpBaseUrl: string;
let engineWsBaseUrl: string;

beforeAll(async () => {
  // Fake backend: echoes back method/path/body so the proxy round-trip can be asserted byte-for-
  // byte, and answers a fixed status + a marker header so response-side forwarding is provable too.
  fakeBackend = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(201, { 'content-type': 'application/json', 'x-fake-backend': 'yes' });
      res.end(JSON.stringify({ method: req.method, url: req.url, bodyLength: body.length, bodyText: body.toString('utf8') }));
    });
  });
  wss = new WebSocketServer({ server: fakeBackend, path: '/ws/agents/echo' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => ws.send(data.toString()));
  });
  await new Promise<void>((resolvePromise) => fakeBackend.listen(0, '127.0.0.1', resolvePromise));
  fakeBackendPort = (fakeBackend.address() as AddressInfo).port;

  const routes = new Map<string, RouteMode>([['native-thing', 'native']]);
  engine = buildServer({ port: 0, host: '127.0.0.1', routes, backendPort: fakeBackendPort, authToken: P_TEST_TOKEN });
  const address = await engine.listen({ port: 0, host: '127.0.0.1' });
  engineHttpBaseUrl = address;
  engineWsBaseUrl = address.replace(/^http/, 'ws');
});

afterAll(async () => {
  await engine.close();
  wss.close();
  await new Promise<void>((resolvePromise) => fakeBackend.close(() => resolvePromise()));
});

describe('proxy mode (the day-one default)', () => {
  test('forwards method, path, and body bytes to the backend, and relays its response back unmodified', async () => {
    const payload = JSON.stringify({ hello: 'world' });
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...P_AUTH_HEADERS },
      body: payload,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-fake-backend')).toBe('yes');
    const body = (await res.json()) as { method: string; url: string; bodyText: string };
    expect(body.method).toBe('POST');
    expect(body.url).toBe('/api/agents/launch');
    expect(body.bodyText).toBe(payload);
  });

  test('a GET with no body proxies cleanly (no phantom content-length)', async () => {
    // /api/health is auth-exempt (see auth/middleware.test.ts), so this deliberately sends no
    // token -- proving both that routing still works AND that the exemption reaches this far.
    const res = await fetch(`${engineHttpBaseUrl}/api/health/check`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { method: string; bodyLength: number };
    expect(body.method).toBe('GET');
    expect(body.bodyLength).toBe(0);
  });

  test('a path outside /api and /ws (no subsystem owner) still proxies', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/openapi.json`, { headers: P_AUTH_HEADERS });
    expect(res.status).toBe(201);
  });

  test('proxies a WS upgrade transparently -- frames pass through unmodified', async () => {
    const ws = new WebSocket(`${engineWsBaseUrl}/ws/agents/echo`, { headers: P_AUTH_HEADERS });
    await new Promise<void>((resolvePromise, reject) => {
      ws.once('open', () => resolvePromise());
      ws.once('error', reject);
    });
    const echoed = new Promise<string>((resolvePromise) => {
      ws.once('message', (data) => resolvePromise(data.toString()));
    });
    ws.send('hello over the wire');
    expect(await echoed).toBe('hello over the wire');
    ws.close();
  });
});

describe('native mode (placeholder, no handler ported yet)', () => {
  test('answers 501 for a route configured native', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/native-thing/whatever`, { headers: P_AUTH_HEADERS });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { route: string };
    expect(body.route).toBe('native-thing');
  });

  test('rejects a WS upgrade for a native-mode route with a clean HTTP 501', async () => {
    const ws = new WebSocket(`${engineWsBaseUrl}/ws/native-thing/whatever`, { headers: P_AUTH_HEADERS });
    const failure = await new Promise<{ code: number }>((resolvePromise) => {
      ws.once('unexpected-response', (_req, res) => resolvePromise({ code: res.statusCode ?? 0 }));
      ws.once('error', () => resolvePromise({ code: -1 }));
    });
    expect(failure.code).toBe(501);
  });
});

describe('no backend spawned (MAESTRO_ENGINE_SKIP_BACKEND=1)', () => {
  test('a proxy-mode request answers 502 rather than hanging or crashing', async () => {
    const routes = new Map<string, RouteMode>();
    const noBackendEngine = buildServer({ port: 0, host: '127.0.0.1', routes, backendPort: null, authToken: P_TEST_TOKEN });
    const address = await noBackendEngine.listen({ port: 0, host: '127.0.0.1' });
    try {
      const res = await fetch(`${address}/api/agents/launch`, { headers: P_AUTH_HEADERS });
      expect(res.status).toBe(502);
    } finally {
      await noBackendEngine.close();
    }
  });
});

// ENG-2: the cross-cutting auth hook (auth/middleware.ts) wired into buildServer() above, proven
// end-to-end against a real listening engine -- unit coverage for the exemption/credential logic
// itself lives in auth/middleware.test.ts.
describe('auth (ENG-2)', () => {
  test('a gated route with no token answers 401, and never reaches the backend', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, { method: 'POST' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('a gated route with the wrong token still answers 401', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-the-real-token' },
    });
    expect(res.status).toBe(401);
  });

  test('a native-mode (501 placeholder) route is gated too -- auth runs regardless of routing', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/native-thing/whatever`);
    expect(res.status).toBe(401);
  });

  test('x-maestro-token is accepted as an alternative to Authorization: Bearer', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-maestro-token': P_TEST_TOKEN },
      body: '{}',
    });
    expect(res.status).toBe(201);
  });

  test('x-api-key is accepted (the bundled Claude Code CLI path)', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': P_TEST_TOKEN },
      body: '{}',
    });
    expect(res.status).toBe(201);
  });

  test('?token= query param is accepted (the App Builder iframe path)', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch?token=${P_TEST_TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  test('OPTIONS preflight bypasses auth outright, even on a gated route with no token', async () => {
    const res = await fetch(`${engineHttpBaseUrl}/api/agents/launch`, { method: 'OPTIONS' });
    expect(res.status).not.toBe(401);
  });

  test('a WS upgrade with no token gets destroyed, not a clean close/response', async () => {
    const ws = new WebSocket(`${engineWsBaseUrl}/ws/agents/echo`);
    const outcome = await new Promise<'error' | 'open'>((resolvePromise) => {
      ws.once('open', () => resolvePromise('open'));
      ws.once('error', () => resolvePromise('error'));
      ws.once('unexpected-response', () => resolvePromise('error'));
    });
    expect(outcome).toBe('error');
  });

  test('a WS upgrade with the wrong token gets destroyed too', async () => {
    const ws = new WebSocket(`${engineWsBaseUrl}/ws/agents/echo?token=not-the-real-token`);
    const outcome = await new Promise<'error' | 'open'>((resolvePromise) => {
      ws.once('open', () => resolvePromise('open'));
      ws.once('error', () => resolvePromise('error'));
    });
    expect(outcome).toBe('error');
  });
});
