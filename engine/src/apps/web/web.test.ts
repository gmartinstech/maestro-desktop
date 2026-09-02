// engine/src/apps/web/web.test.ts -- SUB-8's vitest twin of backend/apps/web/web.py's
// search()/fetch() cascade logic, plus a real-Fastify dispatch-layer smoke test (same pattern
// apps/skills/http.test.ts established: a real listening server, exercised with plain fetch(),
// not a mocked request/reply pair).
//
// Every cascade tier is exercised via full dependency injection (WebSearchDeps/WebFetchDeps) --
// no real network call happens in this file. The one thing worth calling out explicitly, since
// it's this ticket's whole point: the browser tier's dependency is a plain
// `searchWeb`/`fetchPageContent` function reference, called directly and synchronously in-process
// -- never a WebSocket frame, never `/ws/electron-main`. A fake that returns a resolved Promise is
// enough to prove the cascade wires it in correctly; no separate "did this open a socket" test is
// needed because there is no socket in this code path at all.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DDGRateLimited } from './ddg';
import { SSRFBlocked } from './ssrfGuard';
import {
  handleWebHttpRequest,
  performFetch,
  performSearch,
  type SearchBody,
  type WebFetchDeps,
  type WebSearchDeps,
} from './web';

function searchDeps(overrides: Partial<WebSearchDeps> = {}): WebSearchDeps {
  return {
    resolveGeminiApiKey: () => null,
    resolveOpenaiApiKey: () => null,
    geminiGroundedCall: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    geminiGroundedVia9Router: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    openaiWebsearch: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    openaiWebsearchVia9Router: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    searchDdg: vi.fn().mockResolvedValue(''),
    searchWeb: vi.fn().mockResolvedValue({ engine: 'none', results: '', items: [], count: 0 }),
    refresh9rConnected: vi.fn().mockResolvedValue(new Set()),
    isCdpBrowserEnabled: () => false,
    ...overrides,
  };
}

const baseSearchBody: SearchBody = { query: 'cats', num_results: 5 };

describe('performSearch', () => {
  test('DDG success wins and needs no other tier', async () => {
    const deps = searchDeps({ searchDdg: vi.fn().mockResolvedValue('[1] Cats\n    https://cats.example.com') });
    const result = await performSearch(baseSearchBody, deps);
    expect(result.backend).toBe('ddg');
    expect(result.results).toContain('cats.example.com');
    expect(result.cascade_errors).toBeUndefined();
    expect(deps.geminiGroundedCall).not.toHaveBeenCalled();
  });

  test('DDG empty falls through to the CDP browser tier when enabled', async () => {
    const deps = searchDeps({
      searchDdg: vi.fn().mockResolvedValue(''),
      isCdpBrowserEnabled: () => true,
      searchWeb: vi.fn().mockResolvedValue({ engine: 'google', results: '[1] X\n    https://x.example.com', items: [], count: 1 }),
    });
    const result = await performSearch(baseSearchBody, deps);
    expect(result.backend).toBe('browser_google');
  });

  test('the CDP browser tier is skipped entirely when the switch is off (no Electron bridge to fall back to)', async () => {
    const searchWeb = vi.fn().mockResolvedValue({ engine: 'google', results: 'should never be used', items: [], count: 1 });
    const deps = searchDeps({ searchDdg: vi.fn().mockResolvedValue(''), isCdpBrowserEnabled: () => false, searchWeb });
    await performSearch(baseSearchBody, deps);
    expect(searchWeb).not.toHaveBeenCalled();
  });

  test('falls through to gemini_native when a key is configured and DDG/browser both miss', async () => {
    const deps = searchDeps({
      searchDdg: vi.fn().mockResolvedValue(''),
      resolveGeminiApiKey: () => 'gk',
      geminiGroundedCall: vi.fn().mockResolvedValue({ text: 'grounded', chunks: [] }),
    });
    const result = await performSearch(baseSearchBody, deps);
    expect(result.backend).toBe('gemini_native');
  });

  test('primary=openai reorders the grounded tiers ahead of gemini', async () => {
    const order: string[] = [];
    const deps = searchDeps({
      searchDdg: vi.fn().mockResolvedValue(''),
      resolveGeminiApiKey: () => 'gk',
      resolveOpenaiApiKey: () => 'ok',
      geminiGroundedCall: vi.fn(async () => {
        order.push('gemini');
        return { text: '', chunks: [] };
      }),
      openaiWebsearch: vi.fn(async () => {
        order.push('openai');
        return { text: 'answer', chunks: [] };
      }),
    });
    await performSearch({ ...baseSearchBody, primary: 'openai' }, deps);
    expect(order[0]).toBe('openai');
  });

  test('a DDG rate-limit is recorded as a cascade error, not a thrown exception', async () => {
    const deps = searchDeps({
      searchDdg: vi.fn().mockRejectedValue(new DDGRateLimited('cats')),
      resolveGeminiApiKey: () => 'gk',
      geminiGroundedCall: vi.fn().mockResolvedValue({ text: 'grounded', chunks: [] }),
    });
    const result = await performSearch(baseSearchBody, deps);
    expect(result.backend).toBe('gemini_native');
    expect(result.cascade_errors?.[0]).toContain('DuckDuckGo rate-limited');
  });

  test('everything failing with no key/subscription reports the "connect a provider" tail', async () => {
    const deps = searchDeps();
    const result = await performSearch(baseSearchBody, deps);
    expect(result.backend).toBe('none');
    expect(result.results).toContain('No search backend is configured');
  });

  test('everything failing WITH a subscription connected reports the "every provider errored" tail', async () => {
    const deps = searchDeps({ refresh9rConnected: vi.fn().mockResolvedValue(new Set(['codex'])) });
    const result = await performSearch(baseSearchBody, deps);
    expect(result.results).toContain('every configured provider errored');
  });

  test('browser_ok appends the CreateBrowserAgent nudge only when everything failed', async () => {
    const deps = searchDeps();
    const result = await performSearch({ ...baseSearchBody, browser_ok: true }, deps);
    expect(result.results).toContain('CreateBrowserAgent');
  });
});

function fetchDeps(overrides: Partial<WebFetchDeps> = {}): WebFetchDeps {
  return {
    resolveGeminiApiKey: () => null,
    resolveOpenaiApiKey: () => null,
    geminiGroundedCall: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    geminiGroundedVia9Router: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    openaiUrlfetch: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    openaiWebsearchVia9Router: vi.fn().mockResolvedValue({ text: '', chunks: [] }),
    localFetchText: vi.fn().mockResolvedValue('Contents of https://x.example.com:\n\nthin'),
    fetchPageContent: vi.fn().mockResolvedValue({ url: 'https://x.example.com', title: '', text: '' }),
    assertSafeUrl: vi.fn().mockImplementation(async (u: string) => u),
    isCdpBrowserEnabled: () => false,
    ...overrides,
  };
}

const longBody = 'y'.repeat(300);

describe('performFetch', () => {
  test('a real local read (long body) wins outright', async () => {
    const deps = fetchDeps({ localFetchText: vi.fn().mockResolvedValue(`Contents of https://x.example.com:\n\n${longBody}`) });
    const outcome = await performFetch({ url: 'https://x.example.com' }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.body.backend).toBe('local');
      expect(outcome.body.content).toContain(longBody);
    }
  });

  test('SSRF-blocked URLs are refused with a 400 before any tier runs', async () => {
    const deps = fetchDeps({ assertSafeUrl: vi.fn().mockRejectedValue(new SSRFBlocked('blocked range')) });
    const outcome = await performFetch({ url: 'http://169.254.169.254/' }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe(400);
      expect(outcome.detail).toContain('blocked range');
    }
    expect(deps.localFetchText).not.toHaveBeenCalled();
  });

  test('a thin local read falls through to the CDP browser tier when enabled', async () => {
    const deps = fetchDeps({
      isCdpBrowserEnabled: () => true,
      fetchPageContent: vi.fn().mockResolvedValue({ url: 'https://x.example.com', title: 't', text: longBody }),
    });
    const outcome = await performFetch({ url: 'https://x.example.com' }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.body.backend).toBe('browser');
  });

  test('the CDP browser tier is skipped entirely when the switch is off', async () => {
    const fetchPageContent = vi.fn();
    const deps = fetchDeps({ isCdpBrowserEnabled: () => false, fetchPageContent });
    await performFetch({ url: 'https://x.example.com' }, deps);
    expect(fetchPageContent).not.toHaveBeenCalled();
  });

  test('every tier failing falls back to the thin local read rather than an empty response', async () => {
    const deps = fetchDeps({ localFetchText: vi.fn().mockResolvedValue('Error fetching https://x.example.com: boom') });
    const outcome = await performFetch({ url: 'https://x.example.com' }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.body.backend).toBe('local');
      expect(outcome.body.content).toContain('boom');
    }
  });

  test('every tier failing with no local text at all answers 502', async () => {
    const deps = fetchDeps({ localFetchText: vi.fn().mockRejectedValue(new Error('never assigned')) });
    const outcome = await performFetch({ url: 'https://x.example.com' }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(502);
  });

  test('a configured gemini key is used for grounded fetch with useUrlContext=true', async () => {
    const geminiGroundedCall = vi.fn().mockResolvedValue({ text: 'grounded fetch', chunks: [] });
    const deps = fetchDeps({ resolveGeminiApiKey: () => 'gk', geminiGroundedCall });
    const outcome = await performFetch({ url: 'https://x.example.com', prompt: 'focus here' }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.body.backend).toBe('gemini_native');
    expect(geminiGroundedCall).toHaveBeenCalledWith('gk', expect.stringContaining('focus here'), true);
  });
});

describe('handleWebHttpRequest (dispatch layer)', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    fastify = Fastify({ logger: false });
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    fastify.all('*', async (request, reply) => {
      const pathname = (request.raw.url ?? '/').split('?')[0];
      const handled = await handleWebHttpRequest(pathname, request, reply);
      if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
    });
    baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('an unrelated path falls through (404), same "not handled" convention as every other SubApp', async () => {
    const res = await fetch(`${baseUrl}/api/web/unknown`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('POST /search 400s without a query', async () => {
    const res = await fetch(`${baseUrl}/api/web/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('POST /search 400s on a non-JSON-object body', async () => {
    const res = await fetch(`${baseUrl}/api/web/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1,2,3]',
    });
    expect(res.status).toBe(400);
  });

  test('POST /fetch 400s without a url', async () => {
    const res = await fetch(`${baseUrl}/api/web/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('POST /fetch 400s an SSRF-blocked url without touching the network', async () => {
    const res = await fetch(`${baseUrl}/api/web/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toContain('Refused');
  });
});
