// Unit tests for BRW-6's cookie-capture LOGIC (captureLoginCookies) and its HTTP wiring, per the
// same DI spirit as launcher.test.ts/screencast.test.ts: a fake CdpSession + a fake LaunchedBrowser,
// no real browser process, no real network. The real end-to-end path (a real visible browser, real
// CDP, a real site setting a real cookie) is covered by the ticket's separate manual integration
// gate (cookies.integration-check.ts), run for real, not here.
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchedBrowser } from './launcher';
import type { CdpSession } from './screencast';
import {
  captureLoginCookies,
  handleBrowserLoginHttpRequest,
  resetLoginSessionsForTest,
  type CookieCaptureDeps,
  type LoginCaptureConfig,
} from './cookies';

interface FakeCdpHandle {
  cdp: CdpSession;
  sent: Array<{ method: string; params?: Record<string, unknown> }>;
  setCookies: (cookies: Array<{ name: string; value: string; domain?: string }>) => void;
  setUrl: (url: string) => void;
}

function makeFakeCdp(): FakeCdpHandle {
  let cookies: Array<{ name: string; value: string; domain?: string }> = [];
  let url = 'about:blank';
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const cdp: CdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      if (method === 'Page.navigate') return {};
      if (method === 'Network.getCookies') return { cookies };
      if (method === 'Runtime.evaluate') {
        const expr = params?.expression as string;
        if (expr === 'location.href') return { result: { value: url } };
        if (expr === 'navigator.userAgent') return { result: { value: 'FakeUA/1.0' } };
      }
      return {};
    }),
    onEvent: vi.fn(() => () => {}),
    close: vi.fn(),
  };
  return {
    cdp,
    sent,
    setCookies: (c) => { cookies = c; },
    setUrl: (u) => { url = u; },
  };
}

function makeFakeBrowser(): { browser: LaunchedBrowser; closed: () => boolean } {
  let closed = false;
  const browser: LaunchedBrowser = {
    cdpPort: 12345,
    source: 'edge',
    executablePath: 'C:/fake/msedge.exe',
    pid: 4242,
    close: vi.fn(async () => { closed = true; }),
  };
  return { browser, closed: () => closed };
}

function makeDeps(overrides: Partial<CookieCaptureDeps> & { fakeCdp: FakeCdpHandle; fakeBrowser: ReturnType<typeof makeFakeBrowser> }): CookieCaptureDeps {
  const { fakeCdp, fakeBrowser, ...rest } = overrides;
  let clock = 0;
  return {
    launchBrowser: vi.fn(async () => fakeBrowser.browser),
    findPageTargetWsUrl: vi.fn(async () => 'ws://fake/target'),
    connectCdpSession: vi.fn(async () => fakeCdp.cdp),
    sleep: vi.fn(async () => { clock += 1000; }),
    now: () => clock,
    ...rest,
  };
}

describe('captureLoginCookies', () => {
  it('succeeds once the configured success cookie appears, and closes the browser', async () => {
    const fakeCdp = makeFakeCdp();
    const fakeBrowser = makeFakeBrowser();
    let poll = 0;
    fakeCdp.cdp.send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getCookies') {
        poll += 1;
        if (poll >= 3) return { cookies: [{ name: 'reddit_session', value: 'abc123', domain: '.reddit.com' }] };
        return { cookies: [] };
      }
      if (method === 'Runtime.evaluate' && (params?.expression as string) === 'navigator.userAgent') {
        return { result: { value: 'FakeUA/1.0' } };
      }
      return {};
    });
    const deps = makeDeps({ fakeCdp, fakeBrowser });

    const config: LoginCaptureConfig = {
      domain: 'reddit.com',
      loginUrl: 'https://www.reddit.com/login',
      successCookieNames: ['reddit_session', 'token_v2'],
    };
    const result = await captureLoginCookies(config, deps);

    expect(result.error).toBeUndefined();
    expect(result.cookies).toEqual([{ name: 'reddit_session', value: 'abc123' }]);
    expect(result.userAgent).toBe('FakeUA/1.0');
    expect(fakeBrowser.closed()).toBe(true);
  });

  it('succeeds via a URL-pattern signal when no success cookie is configured/found', async () => {
    const fakeCdp = makeFakeCdp();
    const fakeBrowser = makeFakeBrowser();
    let poll = 0;
    fakeCdp.cdp.send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getCookies') return { cookies: [] };
      if (method === 'Runtime.evaluate') {
        const expr = params?.expression as string;
        if (expr === 'location.href') { poll += 1; return { result: { value: poll >= 2 ? 'https://example.com/cookies' : 'https://example.com/cookies/set/foo/bar' } }; }
        if (expr === 'navigator.userAgent') return { result: { value: 'FakeUA/1.0' } };
      }
      return {};
    });
    const deps = makeDeps({ fakeCdp, fakeBrowser });

    const config: LoginCaptureConfig = {
      domain: 'example.com',
      loginUrl: 'https://example.com/cookies/set/foo/bar',
      successCookieNames: [],
      successUrlPattern: /\/cookies$/,
    };
    // No cookies will ever appear here (mechanism-only URL-pattern check); expect the URL branch to fire.
    const result = await captureLoginCookies(config, deps);
    expect(result.error).toBe('Sign-in appeared to complete but no cookies for example.com were readable.');
    expect(fakeBrowser.closed()).toBe(true);
  });

  it('times out and reports an error when neither signal ever fires', async () => {
    const fakeCdp = makeFakeCdp();
    const fakeBrowser = makeFakeBrowser();
    const deps = makeDeps({ fakeCdp, fakeBrowser });

    const config: LoginCaptureConfig = {
      domain: 'reddit.com',
      loginUrl: 'https://www.reddit.com/login',
      successCookieNames: ['reddit_session'],
      timeoutMs: 3000,
      pollIntervalMs: 1000,
    };
    const result = await captureLoginCookies(config, deps);
    expect(result.cookies).toEqual([]);
    expect(result.error).toMatch(/Timed out after 3s waiting for sign-in to reddit\.com/);
    expect(fakeBrowser.closed()).toBe(true);
  });

  it('reports a navigation error without hanging, and still closes the browser', async () => {
    const fakeCdp = makeFakeCdp();
    const fakeBrowser = makeFakeBrowser();
    fakeCdp.cdp.send = vi.fn(async (method: string) => {
      if (method === 'Page.navigate') return { errorText: 'net::ERR_NAME_NOT_RESOLVED' };
      return {};
    });
    const deps = makeDeps({ fakeCdp, fakeBrowser });

    const result = await captureLoginCookies(
      { domain: 'reddit.com', loginUrl: 'https://bogus.invalid/login', successCookieNames: ['reddit_session'] },
      deps,
    );
    expect(result.error).toMatch(/Navigation to https:\/\/bogus\.invalid\/login failed/);
    expect(fakeBrowser.closed()).toBe(true);
  });

  it('reports an error (not a throw) when the browser fails to launch at all', async () => {
    const deps: CookieCaptureDeps = {
      launchBrowser: vi.fn(async () => { throw new Error('no CDP-capable browser found'); }),
      findPageTargetWsUrl: vi.fn(),
      connectCdpSession: vi.fn(),
      sleep: vi.fn(async () => {}),
      now: () => 0,
    };
    const result = await captureLoginCookies(
      { domain: 'reddit.com', loginUrl: 'https://www.reddit.com/login', successCookieNames: ['reddit_session'] },
      deps,
    );
    expect(result.cookies).toEqual([]);
    expect(result.error).toMatch(/Cookie capture failed: no CDP-capable browser found/);
  });

  it('scopes cookies to the requested domain, matching parent-domain and subdomain cookies', async () => {
    const fakeCdp = makeFakeCdp();
    const fakeBrowser = makeFakeBrowser();
    fakeCdp.cdp.send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getCookies') {
        return {
          cookies: [
            { name: 'reddit_session', value: 'abc', domain: '.reddit.com' },
            { name: 'other', value: 'x', domain: 'old.reddit.com' },
            { name: 'unrelated', value: 'y', domain: 'example.com' },
          ],
        };
      }
      if (method === 'Runtime.evaluate' && (params?.expression as string) === 'navigator.userAgent') return { result: { value: 'UA' } };
      return {};
    });
    const deps = makeDeps({ fakeCdp, fakeBrowser });
    const result = await captureLoginCookies(
      { domain: 'reddit.com', loginUrl: 'https://www.reddit.com/login', successCookieNames: ['reddit_session'] },
      deps,
    );
    expect(result.cookies).toEqual(expect.arrayContaining([{ name: 'reddit_session', value: 'abc' }, { name: 'other', value: 'x' }]));
    expect(result.cookies.find((c) => c.name === 'unrelated')).toBeUndefined();
  });
});

describe('handleBrowserLoginHttpRequest', () => {
  let fastify: FastifyInstance;
  let fakeCdp: FakeCdpHandle;
  let fakeBrowser: ReturnType<typeof makeFakeBrowser>;
  let deps: CookieCaptureDeps;

  beforeEach(async () => {
    resetLoginSessionsForTest();
    fakeCdp = makeFakeCdp();
    fakeBrowser = makeFakeBrowser();
    // A real (short) timer-based delay, not an instantly-resolving fake -- the "duplicate start
    // while pending" test below needs a genuine macrotask boundary between the poll loop's first
    // iteration and its next, so the background capture is still demonstrably 'pending' by the
    // time the test's second HTTP call runs (an instantly-resolving mock sleep risks the whole
    // fire-and-forget chain draining via microtasks before that second call ever fires).
    deps = makeDeps({ fakeCdp, fakeBrowser, sleep: () => new Promise((r) => setTimeout(r, 20)), now: () => Date.now() });
    fastify = Fastify({ logger: false });
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    fastify.all('*', async (request, reply) => {
      const pathname = (request.raw.url ?? '/').split('?')[0];
      const handled = await handleBrowserLoginHttpRequest(pathname, request, reply, deps);
      if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
    });
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('rejects a disallowed domain up front, without launching anything', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/browser-session/login', payload: { domain: 'evil.example', loginUrl: 'https://evil.example/login' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ started: false, error: 'domain not allowed: evil.example' });
    expect(deps.launchBrowser).not.toHaveBeenCalled();
  });

  it('requires both domain and loginUrl', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/browser-session/login', payload: { domain: 'reddit.com' } });
    expect(res.statusCode).toBe(400);
  });

  it('starts a capture, reports pending, then connected once the cookie appears', async () => {
    let poll = 0;
    fakeCdp.cdp.send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getCookies') {
        poll += 1;
        return poll >= 2 ? { cookies: [{ name: 'reddit_session', value: 'abc', domain: '.reddit.com' }] } : { cookies: [] };
      }
      if (method === 'Runtime.evaluate' && (params?.expression as string) === 'navigator.userAgent') return { result: { value: 'UA' } };
      return {};
    });

    const start = await fastify.inject({ method: 'POST', url: '/api/browser-session/login', payload: { domain: 'reddit.com', loginUrl: 'https://www.reddit.com/login' } });
    expect(start.statusCode).toBe(202);
    expect(start.json()).toEqual({ started: true });

    // A second start while pending is rejected, not double-launched.
    const again = await fastify.inject({ method: 'POST', url: '/api/browser-session/login', payload: { domain: 'reddit.com', loginUrl: 'https://www.reddit.com/login' } });
    expect(again.json().started).toBe(false);
    expect(deps.launchBrowser).toHaveBeenCalledTimes(1);

    // Let the fire-and-forget capture promise settle (real 20ms-per-poll delay from `deps.sleep`
    // above, so this polls rather than assuming a fixed wait is long enough).
    let status: Awaited<ReturnType<typeof fastify.inject>> | undefined;
    for (let i = 0; i < 50; i += 1) {
      status = await fastify.inject({ method: 'GET', url: '/api/browser-session/status?domain=reddit.com' });
      if (!status.json().pending) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(status?.json()).toEqual({ connected: true, pending: false, domain: 'reddit.com' });

    const cookiesRes = await fastify.inject({ method: 'GET', url: '/api/browser-session/cookies?domain=reddit.com' });
    expect(cookiesRes.json()).toEqual({ cookies: [{ name: 'reddit_session', value: 'abc' }], userAgent: 'UA', domain: 'reddit.com' });
  });

  it('status for a domain with no session yet is neither pending nor connected', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/browser-session/status?domain=reddit.com' });
    expect(res.json()).toEqual({ connected: false, pending: false, domain: 'reddit.com' });
  });

  it('falls through (returns false / 404 in this test harness) for a subpath it does not own', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/browser-session/action', payload: { domain: 'reddit.com', steps: [] } });
    expect(res.statusCode).toBe(404);
  });
});
