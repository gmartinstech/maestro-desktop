import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { get, post, TikTokError } from './tiktokHttp';
import { resetRateLimiterForTest } from './rateLimit';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
  resetSessionCacheForTest();
  resetRateLimiterForTest(fakeInstantRateLimiterDeps());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function mockTiktok(byPath: Record<string, unknown | string>): void {
  vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'sessionid', value: 's1' }] }), { status: 200 });
    for (const [needle, body] of Object.entries(byPath)) {
      if (url.includes(needle)) {
        return typeof body === 'string' ? new Response(body, { status: 200 }) : new Response(JSON.stringify(body), { status: 200 });
      }
    }
    throw new Error(`unexpected tiktok URL in test: ${url}`);
  });
}

describe('get', () => {
  test('attaches Cookie/User-Agent/Referer and signs the query', async () => {
    mockTiktok({ 'recommend/item_list': { statusCode: 0, itemList: [] } });
    await get('recommend/item_list/', { count: 5 });
    const tiktokCall = vi.mocked(http.engineFetch).mock.calls.find(([u]) => String(u).startsWith('https://www.tiktok.com'))!;
    const [url, init] = tiktokCall as [string, RequestInit];
    expect(url).toContain('recommend/item_list/?');
    expect(url).toContain('count=5');
    expect((init.headers as Record<string, string>).Referer).toBe('https://www.tiktok.com/');
  });

  test('statusCode !== 0 raises TikTokError with the signature hint', async () => {
    mockTiktok({ item_list: { statusCode: 10222, statusMsg: 'verify required' } });
    await expect(get('post/item_list/', {})).rejects.toThrow(/statusCode 10222/);
    await expect(get('post/item_list/', {})).rejects.toThrow(/X-Bogus/);
  });

  test('an empty response body raises an actionable TikTokError', async () => {
    mockTiktok({ item_list: '' });
    await expect(get('post/item_list/', {})).rejects.toThrow(/empty response/);
  });

  test('a non-JSON page (verify/captcha wall) raises an actionable TikTokError', async () => {
    mockTiktok({ item_list: '<html>verify</html>' });
    await expect(get('post/item_list/', {})).rejects.toThrow(/non-JSON page/);
  });

  test('a 429 raises a rate-limit TikTokError', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 's', value: 'v' }] }), { status: 200 });
      return new Response('', { status: 429 });
    });
    await expect(get('post/item_list/', {})).rejects.toThrow(/rate-limiting/);
  });

  test('self-heals once on a 401, then succeeds', async () => {
    let calls = 0;
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 's', value: 'v' }] }), { status: 200 });
      calls += 1;
      return calls === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ statusCode: 0, itemList: [] }), { status: 200 });
    });
    const result = await get('post/item_list/', {});
    expect(result).toEqual({ statusCode: 0, itemList: [] });
    expect(calls).toBe(2);
  });

  test('a network failure raises TikTokError, not an uncaught rejection', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 's', value: 'v' }] }), { status: 200 });
      throw new Error('ECONNRESET');
    });
    await expect(get('post/item_list/', {})).rejects.toBeInstanceOf(TikTokError);
  });
});

describe('post', () => {
  test('form-encodes the body and sets Content-Type', async () => {
    mockTiktok({ 'comment/list': { statusCode: 0 } });
    await post('comment/list/', {}, { text: 'hello world' }, { action: 'comment' });
    const call = vi.mocked(http.engineFetch).mock.calls.find(([u]) => String(u).includes('comment/list'))!;
    const [, init] = call as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body as string).get('text')).toBe('hello world');
  });
});
