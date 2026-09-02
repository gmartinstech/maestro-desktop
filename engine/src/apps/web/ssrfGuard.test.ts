// engine/src/apps/web/ssrfGuard.test.ts -- SUB-8's vitest twin of backend/tests' SSRF-guard
// coverage for backend/apps/agents/tools/ssrf_guard.py.

import { describe, expect, test, vi } from 'vitest';
import { assertSafeUrl, isForbiddenIp, safeFetch, SSRFBlocked } from './ssrfGuard';

describe('isForbiddenIp', () => {
  test.each([
    '10.0.0.1',
    '172.16.5.5',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '0.0.0.1',
    '198.18.0.1', // benchmarking
  ])('blocks private/link-local IPv4 %s', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  test.each(['8.8.8.8', '1.1.1.1', '93.184.216.34'])('allows public IPv4 %s', (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });

  test('allows IPv4 loopback', () => {
    expect(isForbiddenIp('127.0.0.1')).toBe(false);
    expect(isForbiddenIp('127.5.5.5')).toBe(false);
  });

  test('allows IPv6 loopback', () => {
    expect(isForbiddenIp('::1')).toBe(false);
  });

  test.each(['fe80::1', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1'])('blocks IPv6 %s', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  test('allows a public IPv6 address', () => {
    expect(isForbiddenIp('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
  });

  test('judges an IPv4-mapped IPv6 address by its embedded v4 (private)', () => {
    expect(isForbiddenIp('::ffff:169.254.169.254')).toBe(true);
  });

  test('judges an IPv4-mapped IPv6 address by its embedded v4 (public)', () => {
    expect(isForbiddenIp('::ffff:8.8.8.8')).toBe(false);
  });

  test('unparseable input is blocked, fail closed', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  test('rejects a non-http(s) scheme', async () => {
    await expect(assertSafeUrl('ftp://example.com')).rejects.toThrow(SSRFBlocked);
  });

  test('rejects a URL with no hostname', async () => {
    await expect(assertSafeUrl('http://')).rejects.toThrow(SSRFBlocked);
  });

  test('a literal private IP is rejected without a DNS lookup', async () => {
    const lookup = vi.fn();
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data', { lookup })).rejects.toThrow(SSRFBlocked);
    expect(lookup).not.toHaveBeenCalled();
  });

  test('a literal public IP passes without a DNS lookup', async () => {
    const lookup = vi.fn();
    await expect(assertSafeUrl('http://8.8.8.8/', { lookup })).resolves.toBe('http://8.8.8.8/');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('a hostname resolving to a public IP passes', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeUrl('https://example.com/page', { lookup })).resolves.toBe('https://example.com/page');
  });

  test('a hostname resolving to ANY private IP is rejected, even with a public record too', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(assertSafeUrl('https://rebind.example.com/', { lookup })).rejects.toThrow(SSRFBlocked);
  });

  test('a DNS failure is surfaced as SSRFBlocked, not a raw error', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeUrl('https://nowhere.invalid/', { lookup })).rejects.toThrow(SSRFBlocked);
  });
});

describe('safeFetch', () => {
  test('re-validates each redirect hop and refuses one that points at a private IP', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/secret' } }));
    const assertSafeUrlImpl = vi.fn(async (u: string) => {
      if (u.includes('169.254.169.254')) throw new SSRFBlocked(`blocked: ${u}`);
      return u;
    });
    await expect(
      safeFetch('https://example.com/redirector', { fetchImpl: fetchImpl as never, assertSafeUrlImpl }),
    ).rejects.toThrow(SSRFBlocked);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('follows a safe redirect chain and returns the final response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }))
      .mockResolvedValueOnce(new Response('done', { status: 200 }));
    const assertSafeUrlImpl = vi.fn(async (u: string) => u);
    const resp = await safeFetch('https://example.com/start', { fetchImpl: fetchImpl as never, assertSafeUrlImpl });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('done');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('gives up after too many redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://example.com/next' } }));
    const assertSafeUrlImpl = vi.fn(async (u: string) => u);
    await expect(
      safeFetch('https://example.com/loop', { fetchImpl: fetchImpl as never, assertSafeUrlImpl, maxRedirects: 2 }),
    ).rejects.toThrow(SSRFBlocked);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('passes allowArbitraryHost so the target need not be on the always-allowed list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const assertSafeUrlImpl = vi.fn(async (u: string) => u);
    await safeFetch('https://not-on-any-allowlist.example.org/', { fetchImpl: fetchImpl as never, assertSafeUrlImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://not-on-any-allowlist.example.org/',
      expect.objectContaining({ method: 'GET' }),
      { allowArbitraryHost: true },
    );
  });
});
