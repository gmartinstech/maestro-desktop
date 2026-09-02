import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { BrowserActionError, lastJson, perform } from './browserAction';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('perform', () => {
  test('POSTs domain + steps to the local action bridge with a bearer token', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const steps = [{ op: 'navigate' as const, url: 'https://tiktok.com/@x' }];
    await perform('tiktok.com', steps);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18324/api/browser-session/action');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ domain: 'tiktok.com', steps });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  test('throws BrowserActionError on an HTTP error status, truncated to 200 chars', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('x'.repeat(400), { status: 502 }));
    await expect(perform('tiktok.com', [])).rejects.toThrow(/Browser bridge HTTP 502/);
  });

  test('throws BrowserActionError when the bridge reports an error field', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ error: 'no card open' }), { status: 200 }));
    await expect(perform('tiktok.com', [])).rejects.toThrow('no card open');
  });

  test('throws BrowserActionError with an actionable message when unreachable', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(perform('tiktok.com', [])).rejects.toBeInstanceOf(BrowserActionError);
  });
});

describe('lastJson', () => {
  test('parses the final evaluate step\'s .text as JSON', () => {
    const result = { results: [{ text: 'ignored' }, { text: '{"ok":true,"clicked":"like"}' }] };
    expect(lastJson(result)).toEqual({ ok: true, clicked: 'like' });
  });

  test('falls back to {raw: text} when the final .text is not JSON', () => {
    const result = { results: [{ text: 'not json' }] };
    expect(lastJson(result)).toEqual({ raw: 'not json' });
  });

  test('falls back to the whole result when there are no results with text', () => {
    const result = { results: [] };
    expect(lastJson(result)).toBe(result);
  });
});
