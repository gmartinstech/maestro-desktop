import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { handleToolCall } from './handlers';
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

describe('handleToolCall (tiktok)', () => {
  test('a SessionUnavailable becomes a plain-text MCP error', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ cookies: [] }), { status: 200 }));
    const result = await handleToolCall('tiktok_feed', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not logged in to tiktok.com');
  });

  test('a signature-gate TikTokError surfaces the browser-agent hint', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 's', value: 'v' }] }), { status: 200 });
      return new Response(JSON.stringify({ statusCode: 10222, statusMsg: 'verify' }), { status: 200 });
    });
    const result = await handleToolCall('tiktok_feed', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('browser agent');
  });

  test('a successful read returns mcpOk\'d JSON', async () => {
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 's', value: 'v' }] }), { status: 200 });
      return new Response(JSON.stringify({ statusCode: 0, itemList: [] }), { status: 200 });
    });
    const result = await handleToolCall('tiktok_feed', {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ videos: [], cursor: undefined, has_more: false });
  });

  test('a BrowserActionError (write path) surfaces its own message', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await handleToolCall('tiktok_like', { video_url: 'https://www.tiktok.com/@x/video/1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Browser bridge unreachable');
  });

  test('an unknown tool name returns an MCP error', async () => {
    const result = await handleToolCall('tiktok_nonsense', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
