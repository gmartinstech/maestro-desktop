import { describe, expect, test, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleHealthHttpRequest } from './health';

function fakeReply() {
  const reply: Partial<FastifyReply> & { _code?: number; _headers: Record<string, string>; _body?: unknown } = {
    _headers: {},
  };
  reply.code = vi.fn((c: number) => {
    reply._code = c;
    return reply as FastifyReply;
  });
  reply.header = vi.fn((name: string, value: string) => {
    reply._headers[name] = value;
    return reply as FastifyReply;
  });
  reply.send = vi.fn((body?: unknown) => {
    reply._body = body;
    return reply as FastifyReply;
  });
  return reply as FastifyReply & { _code?: number; _headers: Record<string, string>; _body?: unknown };
}

function fakeRequest(method = 'GET'): FastifyRequest {
  return { method } as unknown as FastifyRequest;
}

describe('handleHealthHttpRequest', () => {
  test('returns false (no-op) for any other path', async () => {
    const reply = fakeReply();
    const handled = await handleHealthHttpRequest('/api/health/other', fakeRequest(), reply);
    expect(handled).toBe(false);
    expect(reply.code).not.toHaveBeenCalled();
  });

  test('GET /api/health/check returns "OK" with 200 and the right headers', async () => {
    const reply = fakeReply();
    const handled = await handleHealthHttpRequest('/api/health/check', fakeRequest('GET'), reply);
    expect(handled).toBe(true);
    expect(reply._code).toBe(200);
    expect(reply._headers['Content-Type']).toBe('text/plain');
    expect(reply._headers['Content-Length']).toBe('2');
    expect(reply._body).toBe('OK');
  });

  test('a non-GET method on the check path is rejected with 405, not proxied', async () => {
    const reply = fakeReply();
    const handled = await handleHealthHttpRequest('/api/health/check', fakeRequest('POST'), reply);
    expect(handled).toBe(true);
    expect(reply._code).toBe(405);
  });
});
