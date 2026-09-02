import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { resetRateLimiterForTest } from './rateLimit';
import { resetModhashCacheForTest } from './redditHttp';
import { browse, getPost, getUser, inbox, mySubreddits, saved, search, whoami } from './redditReads';

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
      return new Response(JSON.stringify({ cookies: [{ name: 'reddit_session', value: 's1' }], userAgent: 'UA' }), { status: 200 });
    }
    for (const [needle, body] of Object.entries(byPath)) {
      if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    throw new Error(`unexpected reddit URL in test: ${url}`);
  });
}

describe('whoami', () => {
  test('shapes the /api/me.json response down to name + karma', async () => {
    mockReddit({ '/api/me.json': { data: { name: 'alice', id: 't2_1', total_karma: 500, link_karma: 300, comment_karma: 200, has_mail: false, created_utc: 1 } } });
    expect(await whoami()).toEqual({ name: 'alice', id: 't2_1', total_karma: 500, link_karma: 300, comment_karma: 200, has_mail: false, created_utc: 1 });
  });
});

describe('browse', () => {
  test('defaults to hot on the home feed when subreddit is omitted', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { children: [], after: null } }), { status: 200 });
    });
    await browse('', 'bogus-sort', '', 25, '');
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    const [url] = redditCall as [string];
    expect(url).toContain('/hot.json');
  });

  test('truncates a post body over BODY_CAP and reports how much was cut', async () => {
    const longBody = 'x'.repeat(2500);
    mockReddit({
      '/r/programming/hot': { data: { children: [{ kind: 't3', data: { name: 't3_1', selftext: longBody } }], after: 'abc' } },
    });
    const result = await browse('programming', 'hot', '', 25, '');
    expect((result.items[0] as { selftext: string }).selftext).toContain('[+500 chars]');
    expect(result.after).toBe('abc');
  });

  test('a t1 child in a listing renders as a comment record, not a post', async () => {
    mockReddit({ '/r/x/hot': { data: { children: [{ kind: 't1', data: { name: 't1_9', body: 'a reply' } }] } } });
    const result = await browse('x', 'hot', '', 25, '');
    expect(result.items[0]).toMatchObject({ id: 't1_9', body: 'a reply' });
  });
});

describe('search', () => {
  test('restricts to a subreddit when one is given', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    });
    await search('cats', 'aww', 'top', 'week', 10);
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    const [url] = redditCall as [string];
    expect(url).toContain('/r/aww/search');
    expect(url).toContain('restrict_sr=1');
  });
});

describe('getPost', () => {
  test('splits the [post-listing, comment-listing] pair Reddit returns for a thread', async () => {
    mockReddit({
      '/comments/abc123': [
        { data: { children: [{ data: { name: 't3_abc123', title: 'Hello' } }] } },
        { data: { children: [{ kind: 't1', data: { name: 't1_1', body: 'first!' } }] } },
      ],
    });
    const result = await getPost('https://reddit.com/r/x/comments/abc123/title/', 50);
    expect(result.post).toMatchObject({ id: 't3_abc123', title: 'Hello' });
    expect(result.comments).toEqual([expect.objectContaining({ id: 't1_1', body: 'first!' })]);
  });
});

describe('getUser', () => {
  test('merges /about with the requested feed kind', async () => {
    mockReddit({
      '/user/bob/about': { data: { name: 'bob', link_karma: 10, comment_karma: 5, created_utc: 1, is_mod: false } },
      '/user/bob/submitted': { data: { children: [] } },
    });
    const result = await getUser('bob', 'submitted', 25);
    expect(result).toMatchObject({ name: 'bob', link_karma: 10, items: [] });
  });
});

describe('inbox / mySubreddits / saved', () => {
  test('inbox falls back to "inbox" for an unrecognized `where`', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    });
    await inbox('bogus', 25);
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    const [url] = redditCall as [string];
    expect(url).toContain('/message/inbox');
  });

  test('mySubreddits maps display_name/subscribers', async () => {
    mockReddit({ '/subreddits/mine/subscriber': { data: { children: [{ data: { display_name: 'aww', subscribers: 100 } }] } } });
    expect(await mySubreddits(100)).toEqual({ subreddits: [{ name: 'aww', subscribers: 100 }] });
  });

  test('saved defaults to the logged-in username when none is given', async () => {
    mockReddit({
      '/api/me.json': { data: { name: 'alice' } },
      '/user/alice/saved': { data: { children: [] } },
    });
    const result = await saved('', 25);
    expect(result.items).toEqual([]);
  });
});
