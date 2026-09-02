// engine/src/apps/web/ssrfGuard.ts -- SUB-8's port of backend/apps/agents/tools/ssrf_guard.py.
//
// Blocks fetches that would target private/internal IPs (RFC1918, link-local incl. cloud
// metadata, CGNAT, multicast, ULA v6, etc). Resolution is async and covers both IPv4 and IPv6.
//
// Loopback (127/8, ::1) is INTENTIONALLY allowed, same rationale as the Python original's own
// module docstring: the desktop app's App Builder previews servers on 127.0.0.1:<random> and the
// agent needs to be able to verify the built app actually runs. The realistic SSRF threat for a
// desktop app is cloud metadata (169.254.169.254) + internal corporate LANs, not localhost.
//
// Same caveat the Python original documents on its own `assert_safe_url`: this does not perfectly
// close DNS-rebinding TOCTOU (the underlying fetch resolves again on connect) -- the threat model
// this guards against is cloud-metadata and internal-LAN targets, not an active rebinding attacker.

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { promisify } from 'node:util';
import { engineFetch } from '../../net/http';

const dnsLookupAll = promisify(dnsLookup);

export class SSRFBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFBlocked';
  }
}

type CidrEntry = readonly [base: string, bits: number];

const P_BLOCKED_V4_NETS: readonly CidrEntry[] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16], // link-local incl. cloud metadata
  ['100.64.0.0', 10], // CGNAT
  ['224.0.0.0', 4], // multicast
  ['0.0.0.0', 8], // "this network"
  ['198.18.0.0', 15], // benchmarking
];

const P_BLOCKED_V6_NETS: readonly CidrEntry[] = [
  ['fe80::', 10], // link-local
  ['fc00::', 7], // ULA
  ['ff00::', 8], // multicast
  ['::', 128], // unspecified
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function ipv4InCidr(value: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (ipv4ToInt(base) & mask);
}

function int32ToDotted(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** Expands a normal (non-embedded-v4) IPv6 literal to its 128-bit numeric value. Good enough for
 * the CIDR checks below -- not a general-purpose IPv6 parser. */
function ipv6ToBigInt(ip: string): bigint {
  let addr = ip.split('%')[0]; // strip a zone index (fe80::1%eth0)
  // A trailing embedded IPv4 (e.g. "::ffff:169.254.169.254") is dotted-decimal, not hex groups --
  // convert it to its two hextets before the normal ":"-group parsing below, or parseInt would
  // misread "169.254.169.254" as truncated hex ("169").
  const v4TailMatch = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (v4TailMatch) {
    const octs = v4TailMatch[1].split('.').map((s) => Number(s));
    const hi = (((octs[0] << 8) | octs[1]) & 0xffff).toString(16);
    const lo = (((octs[2] << 8) | octs[3]) & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - v4TailMatch[1].length) + hi + ':' + lo;
  }
  let head = addr;
  let tail = '';
  const dc = addr.indexOf('::');
  if (dc !== -1) {
    head = addr.slice(0, dc);
    tail = addr.slice(dc + 2);
  }
  const headGroups = head ? head.split(':').filter((g) => g.length > 0) : [];
  const tailGroups = tail ? tail.split(':').filter((g) => g.length > 0) : [];
  const missing = dc !== -1 ? Math.max(8 - headGroups.length - tailGroups.length, 0) : 0;
  const allGroups = dc !== -1
    ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    : headGroups;
  let value = 0n;
  for (const g of allGroups.slice(0, 8)) {
    value = (value << 16n) | BigInt(parseInt(g || '0', 16));
  }
  return value;
}

function ipv6InCidr(value: bigint, base: string, bits: number): boolean {
  if (bits === 0) return true;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (ipv6ToBigInt(base) >> shift);
}

/** Mirrors ipaddress.IPv4Address.ipv4_mapped / .sixtofour: an IPv6 literal can carry an embedded
 * IPv4 target and route to it, so a private host can slip past the v6-only block list unless the
 * embedded address is judged instead. Returns the embedded dotted-quad, or null if there is none. */
function embeddedV4(value: bigint): string | null {
  if ((value >> 32n) === 0xffffn) {
    return int32ToDotted(Number(value & 0xffffffffn)); // ::ffff:a.b.c.d (v4-mapped)
  }
  if ((value >> 112n) === 0x2002n) {
    return int32ToDotted(Number((value >> 80n) & 0xffffffffn)); // 2002:xxxx:xxxx::/16 (6to4)
  }
  return null;
}

/** True iff this IP is in a blocked range. Loopback is allowed (see module doc above). */
export function isForbiddenIp(ipStr: string): boolean {
  const family = isIP(ipStr);
  if (family === 4) {
    const value = ipv4ToInt(ipStr);
    if (ipv4InCidr(value, '127.0.0.0', 8)) return false;
    return P_BLOCKED_V4_NETS.some(([base, bits]) => ipv4InCidr(value, base, bits));
  }
  if (family === 6) {
    const value = ipv6ToBigInt(ipStr);
    const embedded = embeddedV4(value);
    if (embedded !== null) return isForbiddenIp(embedded);
    if (value === 1n) return false; // ::1
    return P_BLOCKED_V6_NETS.some(([base, bits]) => ipv6InCidr(value, base, bits));
  }
  return true; // unparseable -> block, matches the Python original
}

export interface ResolveHostDeps {
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

async function defaultLookup(host: string): Promise<Array<{ address: string; family: number }>> {
  const result = await dnsLookupAll(host, { all: true, verbatim: true });
  return result as unknown as Array<{ address: string; family: number }>;
}

/** Resolve host to all IPs (v4 + v6), multi-A defense against single-record rebinding. */
async function resolveHostAsync(host: string, deps: ResolveHostDeps): Promise<string[]> {
  let infos: Array<{ address: string }>;
  try {
    infos = await deps.lookup(host);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SSRFBlocked(`DNS resolution failed for ${host}: ${msg}`);
  }
  return [...new Set(infos.map((i) => i.address))];
}

/** Raise SSRFBlocked if url targets a forbidden range; otherwise return url. Resolves the host to
 * ALL records and rejects if ANY resolution is private. */
export async function assertSafeUrl(
  url: string,
  deps: ResolveHostDeps = { lookup: defaultLookup },
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFBlocked(`Invalid URL: ${url}`);
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new SSRFBlocked(`Unsupported URL scheme "${scheme}"; only http/https allowed.`);
  }
  const host = parsed.hostname;
  if (!host) throw new SSRFBlocked('URL has no hostname.');

  if (isIP(host)) {
    if (isForbiddenIp(host)) throw new SSRFBlocked(`URL host ${host} is in a blocked range.`);
    return url;
  }

  const resolved = await resolveHostAsync(host, deps);
  if (resolved.length === 0) throw new SSRFBlocked(`No DNS records for ${host}.`);
  for (const ip of resolved) {
    if (isForbiddenIp(ip)) throw new SSRFBlocked(`Host ${host} resolves to forbidden IP ${ip}.`);
  }
  return url;
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  body?: string;
  /** DI seam for tests -- defaults to the real, allowlist-checked engineFetch. */
  fetchImpl?: typeof engineFetch;
  /** DI seam for tests -- defaults to the real assertSafeUrl (real DNS). */
  assertSafeUrlImpl?: (url: string) => Promise<string>;
}

/** Fetch with per-redirect SSRF re-validation. Manually walks the redirect chain so each hop's
 * target host is re-checked, closing the per-redirect SSRF window a plain follow-redirects fetch
 * leaves open -- mirrors the Python original's safe_fetch(). The target is necessarily an
 * arbitrary, agent/user-supplied URL (the whole point of a web-fetch tool), so this is the one
 * caller in this SubApp that reaches engineFetch with `allowArbitraryHost: true` -- the SSRF check
 * above is what makes that safe, exactly the same trust boundary the Python original's own
 * httpx.AsyncClient() (no egress allowlist in Python at all) accepts. */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    method = 'GET',
    headers = {},
    timeoutMs = 30_000,
    maxRedirects = 5,
    body,
    fetchImpl = engineFetch,
    assertSafeUrlImpl = assertSafeUrl,
  } = options;

  let currentUrl = await assertSafeUrlImpl(url);
  for (let i = 0; i <= maxRedirects; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetchImpl(
        currentUrl,
        { method, headers, body, redirect: 'manual', signal: controller.signal },
        { allowArbitraryHost: true },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!(resp.status >= 300 && resp.status < 400)) return resp;
    const location = resp.headers.get('location');
    if (!location) return resp;
    const nextUrl = new URL(location, currentUrl).toString();
    currentUrl = await assertSafeUrlImpl(nextUrl);
  }
  throw new SSRFBlocked(`Too many redirects (> ${maxRedirects}) starting from ${url}.`);
}
