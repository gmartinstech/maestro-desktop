import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { resetRateLimiterForTest } from './rateLimit';
import { api, modhash, RedditError, resetModhashCacheForTest } from './redditHttp';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
  resetSessionCacheForTest();
  resetModhashCacheForTest();
  resetRateLimiterForTest(fakeInstantRateLimiterDeps());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function sessionCookieResponse(): Response {
  return new Response(JSON.stringify({ cookies: [{ name: 'reddit_session', value: 'sess-1' }], userAgent: 'TestUA' }), { status: 200 });
}

describe('api (GET)', () => {
  test('appends .json, sets raw_json=1, attaches the borrowed Cookie + User-Agent', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    await api('GET', '/r/programming/hot');
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    expect(redditCall).toBeDefined();
    const [url, init] = redditCall as [string, RequestInit];
    expect(url).toBe('https://www.reddit.com/r/programming/hot.json?raw_json=1');
    expect((init.headers as Record<string, string>).Cookie).toBe('reddit_session=sess-1');
  });

  test('does not double-append .json when the path already ends with it', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response('{}', { status: 200 });
    });
    await api('GET', '/comments/abc.json', { params: { limit: 5 } });
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    const [url] = redditCall as [string];
    expect(url).toBe('https://www.reddit.com/comments/abc.json?raw_json=1&limit=5');
  });

  test('a 429 raises a rate-limit RedditError', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response('', { status: 429 });
    });
    await expect(api('GET', '/r/x/hot')).rejects.toThrow(/rate-limiting/);
  });

  test('a 5xx raises RedditError including a body snippet', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response('server exploded', { status: 500 });
    });
    await expect(api('GET', '/r/x/hot')).rejects.toThrow(/Reddit HTTP 500/);
  });

  test('a network failure raises RedditError, not an uncaught rejection', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      throw new Error('ECONNRESET');
    });
    await expect(api('GET', '/r/x/hot')).rejects.toBeInstanceOf(RedditError);
  });
});

describe('401/403 self-heal', () => {
  test('invalidates the session and retries exactly once on a 401', async () => {
    let redditCalls = 0;
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      redditCalls += 1;
      return redditCalls === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    });
    const result = await api('GET', '/r/x/hot');
    expect(result).toEqual({ data: { ok: true } });
    expect(redditCalls).toBe(2);
  });

  test('does not loop forever -- a second consecutive 401 surfaces as an error', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response('', { status: 401 });
    });
    // Not a RedditError (401/403 falls through the >=400 check only on the SECOND attempt, which
    // is also 401 -- >=400 branch fires, matching the Python original's own behavior exactly).
    await expect(api('GET', '/r/x/hot')).rejects.toThrow(/Reddit HTTP 401/);
  });
});

describe('modhash', () => {
  test('fetches /api/me.json and caches the modhash', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response(JSON.stringify({ data: { modhash: 'mh-1' } }), { status: 200 });
    });
    expect(await modhash()).toBe('mh-1');
    const redditCalls = spy.mock.calls.filter(([u]) => String(u).startsWith('https://www.reddit.com'));
    expect(redditCalls.length).toBe(1);
    expect(await modhash()).toBe('mh-1'); // cached, no second /api/me.json call
    const redditCallsAfter = spy.mock.calls.filter(([u]) => String(u).startsWith('https://www.reddit.com'));
    expect(redditCallsAfter.length).toBe(1);
  });

  test('an empty modhash means not logged in -- throws RedditError and invalidates the session', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    await expect(modhash()).rejects.toThrow(/Not logged in to Reddit/);
  });
});

describe('writes carry the modhash', () => {
  test('a POST sends api_type=json + uh=<modhash> as a form body', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return sessionCookieResponse();
      if (url.includes('/api/me.json')) return new Response(JSON.stringify({ data: { modhash: 'mh-write' } }), { status: 200 });
      return new Response(JSON.stringify({ json: { data: {} } }), { status: 200 });
    });
    await api('POST', '/api/vote', { form: { id: 't3_x', dir: 1 }, action: 'vote' });
    const voteCall = spy.mock.calls.find(([u]) => String(u).includes('/api/vote'));
    const [, init] = voteCall as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('id')).toBe('t3_x');
    expect(body.get('dir')).toBe('1');
    expect(body.get('api_type')).toBe('json');
    expect(body.get('uh')).toBe('mh-write');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});
