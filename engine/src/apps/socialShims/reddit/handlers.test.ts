import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { handleToolCall } from './handlers';
import { resetRateLimiterForTest } from './rateLimit';
import { resetModhashCacheForTest } from './redditHttp';

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

describe('handleToolCall (reddit)', () => {
  test('a SessionUnavailable (no cookies) becomes a plain-text MCP error, not a crash', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ cookies: [] }), { status: 200 }));
    const result = await handleToolCall('reddit_whoami', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not logged in to reddit.com');
  });

  test('a successful read returns mcpOk\'d JSON', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { name: 'alice' } }), { status: 200 });
    });
    const result = await handleToolCall('reddit_whoami', {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ name: 'alice' });
  });

  test('an unknown tool name is reported as a RedditError-shaped MCP error', async () => {
    const result = await handleToolCall('reddit_nonsense', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  test('reddit_browse limit is clamped through the shared lim() helper', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    });
    await handleToolCall('reddit_browse', { subreddit: 'x', limit: 99999 });
    const redditCall = spy.mock.calls.find(([u]) => String(u).startsWith('https://www.reddit.com'));
    const [url] = redditCall as [string];
    expect(url).toContain('limit=100');
  });
});
