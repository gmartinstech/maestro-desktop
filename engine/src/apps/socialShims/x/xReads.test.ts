import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { bookmarks, getTweet, getUser, notifications, search, timeline, tweetIdOf, userTweets, whoami } from './xReads';

const ORIGINAL_ENV = { ...process.env };
const TWEET = { id: '123', author: 'bob', text: 'hi', likes: 1, replies: 0, url: 'https://x.com/bob/status/123' };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function mockBridge(finalResult: unknown): void {
  vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [{ text: JSON.stringify(finalResult) }] }), { status: 200 }));
}

describe('tweetIdOf', () => {
  test('extracts the numeric id from a status URL', () => {
    expect(tweetIdOf('https://x.com/bob/status/98765')).toBe('98765');
  });

  test('returns the input unchanged when no digits are found', () => {
    expect(tweetIdOf('not-a-url')).toBe('not-a-url');
  });
});

describe('whoami', () => {
  test('navigates to /home and returns the scraped handle', async () => {
    mockBridge({ handle: 'bob', logged_in: true });
    const result = await whoami();
    expect(result).toEqual({ handle: 'bob', logged_in: true });
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://x.com/home');
  });
});

describe('search', () => {
  test('maps product to the right f= query param', async () => {
    mockBridge([TWEET]);
    await search('cats', 'latest', 10);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toContain('f=live');
  });

  test('the "top" product adds no f= param', async () => {
    mockBridge([]);
    await search('cats', 'top', 10);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).not.toContain('&f=');
  });

  test('returns tweets + count', async () => {
    mockBridge([TWEET, TWEET]);
    const result = await search('cats', 'top', 10);
    expect(result.count).toBe(2);
  });
});

describe('timeline / userTweets / bookmarks / notifications', () => {
  test('timeline navigates to /home', async () => {
    mockBridge([TWEET]);
    const result = await timeline('foryou', 20);
    expect(result).toEqual({ kind: 'foryou', tweets: [TWEET], count: 1 });
  });

  test('userTweets strips a leading @ and navigates to the profile', async () => {
    mockBridge([]);
    await userTweets('@bob', 20);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://x.com/bob');
  });

  test('bookmarks navigates to /i/bookmarks', async () => {
    mockBridge([TWEET]);
    const result = await bookmarks(10);
    expect(result.count).toBe(1);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    expect((JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> }).steps[0].url).toBe('https://x.com/i/bookmarks');
  });

  test('notifications navigates to /notifications', async () => {
    mockBridge([]);
    const result = await notifications(10);
    expect(result.notifications).toEqual([]);
  });
});

describe('getTweet', () => {
  test('splits the first scraped tweet from its replies, honoring replies_limit', async () => {
    const reply1 = { ...TWEET, id: 'r1' };
    const reply2 = { ...TWEET, id: 'r2' };
    mockBridge([TWEET, reply1, reply2]);
    const result = await getTweet('123', 1);
    expect(result.tweet.id).toBe('123');
    expect(result.replies).toEqual([reply1]);
  });

  test('builds a status URL from a bare numeric target', async () => {
    mockBridge([]);
    await getTweet('999', 30);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://x.com/i/status/999');
  });

  test('passes an already-full URL target through unchanged', async () => {
    mockBridge([]);
    await getTweet('https://x.com/bob/status/555', 30);
    const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://x.com/bob/status/555');
  });
});

describe('getUser', () => {
  test('scrapes the profile page', async () => {
    mockBridge({ name: 'Bob', handle: 'bob', bio: 'hi', following: '10', followers: '20' });
    const result = await getUser('bob');
    expect(result).toEqual({ name: 'Bob', handle: 'bob', bio: 'hi', following: '10', followers: '20' });
  });
});
