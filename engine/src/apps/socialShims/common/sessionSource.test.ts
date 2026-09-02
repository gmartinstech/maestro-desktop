import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { cookieValue, getSession, invalidate, resetSessionCacheForTest, SessionUnavailable } from './sessionSource';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetSessionCacheForTest();
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('getSession', () => {
  test('calls the local browser-session bridge with domain + bearer token, returns cookie header + UA', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(
      jsonResponse({ cookies: [{ name: 'reddit_session', value: 'abc123' }, { name: 'token_v2', value: 'xyz' }], userAgent: 'TestUA/1.0' }),
    );
    const [cookieHeader, ua] = await getSession('reddit.com');
    expect(cookieHeader).toBe('reddit_session=abc123; token_v2=xyz');
    expect(ua).toBe('TestUA/1.0');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18324/api/browser-session/cookies?domain=reddit.com');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  test('falls back to a default Chrome UA when the bridge omits userAgent', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(jsonResponse({ cookies: [{ name: 'a', value: 'b' }] }));
    const [, ua] = await getSession('x.com');
    expect(ua).toContain('Mozilla/5.0');
  });

  test('throws SessionUnavailable with an actionable message when there are no cookies', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(jsonResponse({ cookies: [] }));
    await expect(getSession('tiktok.com')).rejects.toThrow(/Not logged in to tiktok\.com/);
  });

  test('throws SessionUnavailable on the bridge reporting an error field', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(jsonResponse({ error: 'domain not allowed: evil.com' }));
    await expect(getSession('evil.com')).rejects.toThrow('domain not allowed: evil.com');
  });

  test('throws SessionUnavailable on an HTTP error status from the bridge', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(getSession('reddit.com')).rejects.toBeInstanceOf(SessionUnavailable);
  });

  test('throws SessionUnavailable when the bridge is unreachable (network error)', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getSession('reddit.com')).rejects.toThrow(/Session bridge unreachable/);
  });

  test('caches a session for CACHE_TTL_S, does not re-fetch on the second call', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async () => jsonResponse({ cookies: [{ name: 'a', value: 'b' }] }));
    let clock = 1000;
    await getSession('reddit.com', () => clock);
    clock += 10;
    await getSession('reddit.com', () => clock);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('re-fetches once the cache entry is older than CACHE_TTL_S', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async () => jsonResponse({ cookies: [{ name: 'a', value: 'b' }] }));
    let clock = 1000;
    await getSession('reddit.com', () => clock);
    clock += 61;
    await getSession('reddit.com', () => clock);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('invalidate() forces a re-fetch even within the TTL window', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async () => jsonResponse({ cookies: [{ name: 'a', value: 'b' }] }));
    await getSession('reddit.com', () => 1000);
    invalidate('reddit.com');
    await getSession('reddit.com', () => 1005);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('cookieValue', () => {
  test('pulls a single cookie value out of the borrowed session (e.g. tiktok msToken)', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(
      jsonResponse({ cookies: [{ name: 'msToken', value: 'tok-1' }, { name: 'sessionid', value: 'sess-1' }] }),
    );
    expect(await cookieValue('tiktok.com', 'msToken')).toBe('tok-1');
  });

  test('returns empty string when the named cookie is absent', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(jsonResponse({ cookies: [{ name: 'sessionid', value: 'sess-1' }] }));
    expect(await cookieValue('tiktok.com', 'msToken')).toBe('');
  });
});
