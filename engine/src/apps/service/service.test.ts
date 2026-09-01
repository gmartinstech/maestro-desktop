import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionsDir } from './sessions';
import { handleServiceHttpRequest } from './service';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-service-http-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  mkdirSync(sessionsDir(), { recursive: true });
  delete process.env.MAESTRO_TELEMETRY_URL;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

function fakeReply() {
  const reply: Partial<FastifyReply> & { _code?: number; _body?: unknown } = {};
  reply.code = vi.fn((c: number) => {
    reply._code = c;
    return reply as FastifyReply;
  });
  reply.send = vi.fn((body?: unknown) => {
    reply._body = body;
    return reply as FastifyReply;
  });
  return reply as FastifyReply & { _code?: number; _body?: unknown };
}

function fakeRequest(method: string, body?: unknown): FastifyRequest {
  return { method, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8') } as unknown as FastifyRequest;
}

describe('handleServiceHttpRequest', () => {
  test('returns false for an unrecognized /api/service/* path', async () => {
    const reply = fakeReply();
    const handled = await handleServiceHttpRequest('/api/service/nope', fakeRequest('GET'), reply);
    expect(handled).toBe(false);
    expect(reply.code).not.toHaveBeenCalled();
  });

  test('GET /api/service/status', async () => {
    const reply = fakeReply();
    const handled = await handleServiceHttpRequest('/api/service/status', fakeRequest('GET'), reply);
    expect(handled).toBe(true);
    expect(reply._code).toBe(200);
    expect(reply._body).toEqual({ status: 'ok', enabled: true });
  });

  test('GET /api/service/usage-summary on an empty install', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/usage-summary', fakeRequest('GET'), reply);
    expect(reply._code).toBe(200);
    expect((reply._body as { total_sessions: number }).total_sessions).toBe(0);
  });

  test('GET /api/service/cost-breakdown reports unavailable', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/cost-breakdown', fakeRequest('GET'), reply);
    expect(reply._body).toEqual({ available: false, by_model: {}, by_provider: {} });
  });

  test('GET /api/service/spool/count starts at 0', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/spool/count', fakeRequest('GET'), reply);
    expect(reply._body).toEqual({ pending: 0 });
  });

  test('POST /api/service/submit with the flat {s,a,p} report() shape', async () => {
    const reply = fakeReply();
    const handled = await handleServiceHttpRequest('/api/service/submit', fakeRequest('POST', { s: 'chat', a: 'sent', p: {} }), reply);
    expect(handled).toBe(true);
    expect(reply._body).toEqual({ ok: true });
  });

  test('POST /api/service/submit with the legacy {kind,payload} shape', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/submit', fakeRequest('POST', { kind: 'state', payload: { sessions_open: 1 } }), reply);
    expect(reply._body).toEqual({ ok: true });
  });

  test('POST /api/service/submit with a batched array processes every item', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest(
      '/api/service/submit',
      fakeRequest('POST', [{ s: 'a', a: 'x', p: {} }, { s: 'b', a: 'y', p: {} }]),
      reply,
    );
    expect(reply._body).toEqual({ ok: true });
  });

  test('POST /api/service/submit with an unrecognized body shape reports ok:false, still 200', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/submit', fakeRequest('POST', { nonsense: true }), reply);
    expect(reply._code).toBe(200);
    expect(reply._body).toEqual({ ok: false, error: 'expected {s,a,p,...} or {kind,payload}' });
  });

  test('POST /api/service/event splits a dotted legacy event_type into surface/action', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/event', fakeRequest('POST', { event_type: 'chat.sent', properties: { n: 1 } }), reply);
    expect(reply._body).toEqual({ ok: true });
  });

  test('POST /api/service/event with no surface at all is rejected, still 200', async () => {
    const reply = fakeReply();
    await handleServiceHttpRequest('/api/service/event', fakeRequest('POST', {}), reply);
    expect(reply._body).toEqual({ ok: false, error: 'surface required' });
  });
});
