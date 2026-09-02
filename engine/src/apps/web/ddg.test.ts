// engine/src/apps/web/ddg.test.ts -- SUB-8's vitest twin of the parsing logic in
// backend/apps/agents/tools/{search_ddg,search_ddg_lite}.py. Parser functions are pure and tested
// against small HTML fixtures, no real DuckDuckGo network call; searchDdg/searchDdgLite are
// exercised via a mocked engineFetch (net/http.ts is the one module allowed to reach the network,
// so it's the seam to mock, same convention router/sync.test.ts and agents/proxy/*.test.ts use).

import { describe, expect, test, vi } from 'vitest';
import * as httpModule from '../../net/http';
import { DDGRateLimited, parseDdgHtmlResults, parseLiteResults, searchDdg, searchDdgLite, stripHtml } from './ddg';

describe('stripHtml', () => {
  test('strips tags, script/style blocks, and unescapes entities', () => {
    const html = '<div>Hello &amp; welcome<script>evil()</script><style>.x{}</style> <b>world</b></div>';
    expect(stripHtml(html)).toBe('Hello & welcome world');
  });

  test('collapses runs of blank lines', () => {
    expect(stripHtml('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('parseDdgHtmlResults', () => {
  test('extracts title/url/snippet and unwraps the uddg redirect', () => {
    const body =
      '<div class="result results_links results_links_deep web-result">' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=1">Example Title</a>' +
      '<a class="result__snippet">A short snippet.</a>' +
      '</div>';
    const entries = parseDdgHtmlResults(body, 5);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('[1] Example Title');
    expect(entries[0]).toContain('https://example.com/page');
    expect(entries[0]).toContain('A short snippet.');
  });

  test('drops sponsored y.js rows', () => {
    const body =
      '<div class="result">' +
      '<a class="result__a" href="//duckduckgo.com/y.js?ad_provider=x&ad_domain=y">Sponsored</a>' +
      '</div>' +
      '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.example.com">Real Result</a></div>';
    const entries = parseDdgHtmlResults(body, 5);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('Real Result');
  });

  test('respects numResults', () => {
    const block = (n: number) =>
      `<div class="result"><a class="result__a" href="https://example.com/${n}">Title ${n}</a></div>`;
    const body = [1, 2, 3, 4].map(block).join('');
    expect(parseDdgHtmlResults(body, 2)).toHaveLength(2);
  });

  test('handles the href-before-class attribute order', () => {
    const body = '<div class="result"><a href="https://example.com/x" class="result__a">Alt Order</a></div>';
    const entries = parseDdgHtmlResults(body, 5);
    expect(entries[0]).toContain('Alt Order');
    expect(entries[0]).toContain('https://example.com/x');
  });
});

describe('parseLiteResults', () => {
  test('pairs links and snippets positionally', () => {
    const body =
      "<a href=\"https://a.example.com\" class='result-link'>A Title</a>" +
      "<td class='result-snippet'>A snippet</td>" +
      "<a href=\"https://b.example.com\" class='result-link'>B Title</a>" +
      "<td class='result-snippet'>B snippet</td>";
    const out = parseLiteResults(body, 5);
    expect(out).toContain('[1] A Title');
    expect(out).toContain('https://a.example.com');
    expect(out).toContain('A snippet');
    expect(out).toContain('[2] B Title');
  });

  test('an empty body yields an empty string, not a throw', () => {
    expect(parseLiteResults('<html></html>', 5)).toBe('');
  });
});

describe('searchDdg / searchDdgLite (network mocked via engineFetch)', () => {
  test('a 202 from html falls through to lite', async () => {
    const spy = vi
      .spyOn(httpModule, 'engineFetch')
      .mockResolvedValueOnce(new Response('throttle page', { status: 202 }))
      .mockResolvedValueOnce(
        new Response("<a href=\"https://x.example.com\" class='result-link'>X</a>", { status: 200 }),
      );
    const result = await searchDdg('cats', 5);
    expect(result).toContain('https://x.example.com');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test('both endpoints throttling raises DDGRateLimited', async () => {
    const spy = vi
      .spyOn(httpModule, 'engineFetch')
      .mockResolvedValueOnce(new Response('throttle', { status: 202 }))
      .mockResolvedValueOnce(new Response('throttle', { status: 202 }));
    await expect(searchDdg('cats', 5)).rejects.toThrow(DDGRateLimited);
    spy.mockRestore();
  });

  test('a 200 with zero parsed entries falls through to lite (markup-drift safety net)', async () => {
    const spy = vi
      .spyOn(httpModule, 'engineFetch')
      .mockResolvedValueOnce(new Response('<div>no results div class markup here</div>', { status: 200 }))
      .mockResolvedValueOnce(
        new Response("<a href=\"https://lite.example.com\" class='result-link'>Lite Hit</a>", { status: 200 }),
      );
    const result = await searchDdg('cats', 5);
    expect(result).toContain('https://lite.example.com');
    spy.mockRestore();
  });

  test('searchDdgLite returns null on a 202', async () => {
    const spy = vi.spyOn(httpModule, 'engineFetch').mockResolvedValueOnce(new Response('throttle', { status: 202 }));
    await expect(searchDdgLite('cats', 5)).resolves.toBeNull();
    spy.mockRestore();
  });
});
