import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { handleToolCall } from './handlers';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('handleToolCall (x)', () => {
  test('a bridge failure (BrowserActionError) becomes a plain-text MCP error', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await handleToolCall('x_whoami', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Browser bridge unreachable');
  });

  test('a successful read returns mcpOk\'d JSON', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [{ text: JSON.stringify({ handle: 'bob', logged_in: true }) }] }), { status: 200 }));
    const result = await handleToolCall('x_whoami', {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ handle: 'bob', logged_in: true });
  });

  test('x_delete_tweet surfaces the "not automatable" error as an MCP error, not a crash', async () => {
    const result = await handleToolCall('x_delete_tweet', { target: 'https://x.com/bob/status/1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('delete it there');
  });

  test('an unknown tool name returns an MCP error', async () => {
    const result = await handleToolCall('x_nonsense', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
