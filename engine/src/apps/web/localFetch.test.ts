// engine/src/apps/web/localFetch.test.ts -- SUB-8's vitest twin of the "local" tier in
// backend/apps/agents/tools/web.py's WebFetchTool.execute().

import { describe, expect, test, vi } from 'vitest';
import { SSRFBlocked } from './ssrfGuard';
import { localFetchText } from './localFetch';

describe('localFetchText', () => {
  test('extracts plain text from an HTML page and adds the header', async () => {
    const safeFetchImpl = vi.fn().mockResolvedValue(
      new Response('<html><body><h1>Hi</h1><p>Body text.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const out = await localFetchText('https://example.com/page', null, { safeFetchImpl });
    expect(out).toContain('Contents of https://example.com/page:');
    expect(out).toContain('Hi Body text.');
  });

  test('adds the "Looking for" hint when a prompt is given', async () => {
    const safeFetchImpl = vi.fn().mockResolvedValue(new Response('plain text body', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const out = await localFetchText('https://example.com/x', 'pricing', { safeFetchImpl });
    expect(out).toContain('(Looking for: pricing)');
    expect(out).toContain('plain text body');
  });

  test('non-HTML content passes through verbatim', async () => {
    const safeFetchImpl = vi.fn().mockResolvedValue(new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const out = await localFetchText('https://example.com/api', null, { safeFetchImpl });
    expect(out).toContain('{"a":1}');
  });

  test('an SSRF block is reported as "Refused to fetch"', async () => {
    const safeFetchImpl = vi.fn().mockRejectedValue(new SSRFBlocked('blocked host'));
    const out = await localFetchText('http://169.254.169.254/', null, { safeFetchImpl });
    expect(out).toBe('Refused to fetch http://169.254.169.254/: blocked host');
  });

  test('a non-2xx HTTP status is reported plainly', async () => {
    const safeFetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    const out = await localFetchText('https://example.com/missing', null, { safeFetchImpl });
    expect(out).toBe('HTTP error 404 fetching https://example.com/missing');
  });

  test('a network error is reported as "Error fetching"', async () => {
    const safeFetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const out = await localFetchText('https://example.com/down', null, { safeFetchImpl });
    expect(out).toBe('Error fetching https://example.com/down: ECONNRESET');
  });

  test('output is truncated at ~250 KB', async () => {
    const big = 'x'.repeat(300_000);
    const safeFetchImpl = vi.fn().mockResolvedValue(new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } }));
    const out = await localFetchText('https://example.com/big', null, { safeFetchImpl });
    expect(out).toContain('... (output truncated)');
    expect(out.length).toBeLessThan(big.length);
  });
});
