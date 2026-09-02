import { afterEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { encodeQuery, requestJson } from './httpJson';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encodeQuery', () => {
  test('drops null/undefined values, keeps everything else stringified', () => {
    expect(encodeQuery({ a: 1, b: null, c: undefined, d: 'x y' })).toBe('a=1&d=x+y');
  });

  test('empty object yields empty string', () => {
    expect(encodeQuery({})).toBe('');
  });
});

describe('requestJson', () => {
  test('parses a JSON body and lower-cases response headers', async () => {
    const headers = new Headers({ 'X-Ratelimit-Remaining': '3' });
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers }));
    const result = await requestJson({ method: 'GET', url: 'https://www.reddit.com/api/me.json' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(result.headers['x-ratelimit-remaining']).toBe('3');
  });

  test('non-JSON body text falls back to the raw string, never throws', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('not json', { status: 502 }));
    const result = await requestJson({ method: 'GET', url: 'https://www.tiktok.com/api/x' });
    expect(result.status).toBe(502);
    expect(result.body).toBe('not json');
  });

  test('empty body becomes {} for .body but rawText stays the real empty string', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(null, { status: 204 }));
    const result = await requestJson({ method: 'POST', url: 'https://www.reddit.com/api/vote' });
    expect(result.body).toEqual({});
    expect(result.rawText).toBe('');
  });

  test('passes method/headers/body through to engineFetch', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await requestJson({ method: 'POST', url: 'https://www.reddit.com/x', headers: { Cookie: 'a=b' }, body: 'form=1' });
    expect(spy).toHaveBeenCalledWith(
      'https://www.reddit.com/x',
      expect.objectContaining({ method: 'POST', headers: { Cookie: 'a=b' }, body: 'form=1' }),
    );
  });

  test('a network failure propagates (caller decides how to report it)', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('boom'));
    await expect(requestJson({ method: 'GET', url: 'https://www.reddit.com/x' })).rejects.toThrow('boom');
  });
});
