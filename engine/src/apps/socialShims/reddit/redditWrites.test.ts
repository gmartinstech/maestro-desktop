import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { resetRateLimiterForTest } from './rateLimit';
import { resetModhashCacheForTest } from './redditHttp';
import { comment, compose, del, edit, save, submit, subscribe, vote } from './redditWrites';

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

function mockReddit(byPath: Record<string, unknown>): void {
  vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('browser-session')) {
      return new Response(JSON.stringify({ cookies: [{ name: 'reddit_session', value: 's1' }] }), { status: 200 });
    }
    if (url.includes('/api/me.json')) return new Response(JSON.stringify({ data: { modhash: 'mh-1' } }), { status: 200 });
    for (const [needle, body] of Object.entries(byPath)) {
      if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    throw new Error(`unexpected reddit URL in test: ${url}`);
  });
}

describe('submit', () => {
  test('a self post sends text, not url', async () => {
    mockReddit({ '/api/submit': { json: { data: { name: 't3_new', url: 'https://reddit.com/r/x/comments/new' } } } });
    const result = await submit('x', 'My Title', 'self', 'body text', '', false, false, true);
    expect(result).toEqual({ id: 't3_new', url: 'https://reddit.com/r/x/comments/new' });
    const call = (vi.mocked(http.engineFetch).mock.calls as [string, RequestInit][]).find(([u]) => u.includes('/api/submit'))!;
    const body = new URLSearchParams(call[1].body as string);
    expect(body.get('text')).toBe('body text');
    expect(body.get('url')).toBeNull();
  });

  test("errors surfaced in Reddit's json.errors envelope raise RedditError", async () => {
    mockReddit({ '/api/submit': { json: { errors: [['RATELIMIT', 'you are doing that too much']] } } });
    await expect(submit('x', 't', 'self', 'b', '', false, false, true)).rejects.toThrow(/RATELIMIT/);
  });
});

describe('comment / edit / delete', () => {
  test('comment extracts the new thing\'s id + permalink', async () => {
    mockReddit({ '/api/comment': { json: { data: { things: [{ data: { name: 't1_new', permalink: '/r/x/comments/1/_/2' } }] } } } });
    expect(await comment('t3_parent', 'nice post')).toEqual({ id: 't1_new', permalink: '/r/x/comments/1/_/2' });
  });

  test('delete always reports success (Reddit\'s del endpoint returns no body)', async () => {
    mockReddit({ '/api/del': {} });
    expect(await del('t1_x')).toEqual({ id: 't1_x', deleted: true });
  });

  test('edit falls back to the original thing_id when the response omits things[]', async () => {
    mockReddit({ '/api/editusertext': { json: { data: {} } } });
    expect(await edit('t1_x', 'updated text')).toEqual({ id: 't1_x', edited: true });
  });
});

describe('vote', () => {
  test.each([
    ['up', 1],
    ['upvote', 1],
    ['down', -1],
    ['downvote', -1],
    ['clear', 0],
    ['unrecognized', 0],
  ])('direction %s maps to dir=%d', async (direction, expected) => {
    mockReddit({ '/api/vote': {} });
    const result = await vote('t3_x', direction);
    expect(result).toEqual({ id: 't3_x', dir: expected });
  });
});

describe('save / subscribe / compose', () => {
  test('unsave routes to /api/unsave', async () => {
    mockReddit({ '/api/unsave': {} });
    const result = await save('t3_x', true);
    expect(result).toEqual({ id: 't3_x', saved: false });
    const spy = vi.mocked(http.engineFetch);
    expect(spy.mock.calls.some(([u]) => String(u).includes('/api/unsave'))).toBe(true);
  });

  test('subscribe/unsubscribe pick the right action value', async () => {
    mockReddit({ '/api/subscribe': {} });
    await subscribe('aww', true);
    const spy = vi.mocked(http.engineFetch);
    const call = spy.mock.calls.find(([u]) => String(u).includes('/api/subscribe'))!;
    const body = new URLSearchParams((call[1] as RequestInit).body as string);
    expect(body.get('action')).toBe('unsub');
  });

  test('compose reports sent:true on success', async () => {
    mockReddit({ '/api/compose': { json: { data: {} } } });
    expect(await compose('bob', 'hi', 'hello there')).toEqual({ to: 'bob', sent: true });
  });
});
