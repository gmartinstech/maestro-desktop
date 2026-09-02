// Unit tests for fetch.ts's orchestration logic (navigate -> settle -> read, and the search
// engine cascade) against a fake browser+page -- no real browser, no real network. The real-browser
// path (launch via launcher.ts, connect via cdp.ts, actually fetch a page) is this ticket's
// separate manual gate, run with `npx tsx src/browser/fetch.integration-check.ts`, mirroring
// launcher.integration-check.ts / cdp.integration-check.ts / screencast.integration-check.ts's own
// split between stubbed unit tests and a manual real-integration script.
import { describe, expect, it, vi } from 'vitest';
import { fetchPageContent, searchWeb, type BrowserPageLike, type EngineBrowserDeps } from './fetch';
import type { LaunchedBrowser } from './launcher';

function fakeLaunchedBrowser(closeSpy: () => void): LaunchedBrowser {
  return {
    cdpPort: 9999,
    source: 'edge',
    executablePath: 'C:/fake/msedge.exe',
    pid: 1234,
    close: async () => closeSpy(),
  };
}

function makeDeps(overrides: {
  runCommand: BrowserPageLike['runCommand'];
  closePage?: () => void;
  closeBrowser?: () => void;
}): EngineBrowserDeps {
  return {
    launchBrowser: async () => fakeLaunchedBrowser(overrides.closeBrowser ?? (() => {})),
    connectPage: async () => ({
      runCommand: overrides.runCommand,
      close: async () => overrides.closePage?.(),
    }),
  };
}

describe('fetchPageContent', () => {
  it('navigates, settles, and returns the cleaned rendered text', async () => {
    const calls: Array<{ action: string; params?: Record<string, unknown> }> = [];
    const closePage = vi.fn();
    const closeBrowser = vi.fn();
    const deps = makeDeps({
      runCommand: async (action, params) => {
        calls.push({ action, params });
        if (action === 'navigate') return { text: 'Navigated', url: params?.url };
        if (action === 'get_text') {
          return { text: 'Hello\n\n\n\nworld  ', url: 'https://example.com/', title: 'Example' };
        }
        return {};
      },
      closePage,
      closeBrowser,
    });

    const result = await fetchPageContent('https://example.com', { settleMs: 0 }, deps);

    expect(result.error).toBeUndefined();
    expect(result.text).toBe('Hello\n\nworld');
    expect(result.title).toBe('Example');
    expect(result.url).toBe('https://example.com/');
    expect(calls[0]).toEqual({ action: 'navigate', params: { url: 'https://example.com' } });
    expect(calls[1].action).toBe('get_text');
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('reports a navigation error without touching get_text', async () => {
    const getTextSpy = vi.fn();
    const deps = makeDeps({
      runCommand: async (action) => {
        if (action === 'navigate') return { error: 'net::ERR_NAME_NOT_RESOLVED' };
        getTextSpy();
        return { text: 'should not run' };
      },
    });

    const result = await fetchPageContent('https://nowhere.invalid', { settleMs: 0 }, deps);

    expect(result.error).toContain('Navigation failed');
    expect(result.text).toBe('');
    expect(getTextSpy).not.toHaveBeenCalled();
  });

  it('surfaces an empty-page result as an error, matching hiddenFetch behavior', async () => {
    const deps = makeDeps({
      runCommand: async (action) => {
        if (action === 'navigate') return { text: 'Navigated' };
        if (action === 'get_text') return { text: '   ', url: 'https://blocked.example/', title: '' };
        return {};
      },
    });

    const result = await fetchPageContent('https://blocked.example', { settleMs: 0 }, deps);

    expect(result.error).toBe('empty page (blocked or no rendered text)');
    expect(result.text).toBe('');
  });

  it('still closes the page and browser when the page connection throws', async () => {
    const closeBrowser = vi.fn();
    const deps: EngineBrowserDeps = {
      launchBrowser: async () => fakeLaunchedBrowser(closeBrowser),
      connectPage: async () => {
        throw new Error('CDP connect failed');
      },
    };

    const result = await fetchPageContent('https://example.com', {}, deps);

    expect(result.error).toContain('CDP connect failed');
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('truncates to maxChars, mirroring hiddenBrowser.js MAX_FETCH_CHARS', async () => {
    const longText = 'x'.repeat(500);
    const deps = makeDeps({
      runCommand: async (action) => {
        if (action === 'navigate') return {};
        if (action === 'get_text') return { text: longText, url: 'https://example.com/', title: '' };
        return {};
      },
    });

    const result = await fetchPageContent('https://example.com', { settleMs: 0, maxChars: 100 }, deps);
    expect(result.text).toHaveLength(100);
  });
});

describe('searchWeb', () => {
  it('returns the first engine with results and stops the cascade there', async () => {
    const navigatedUrls: string[] = [];
    const deps = makeDeps({
      runCommand: async (action, params) => {
        if (action === 'navigate') {
          navigatedUrls.push(String(params?.url));
          return {};
        }
        if (action === 'evaluate') {
          const results = [{ t: 'Result One', u: 'https://a.example/' }, { t: 'Result Two', u: 'https://b.example/' }];
          return { text: JSON.stringify(results) };
        }
        return {};
      },
    });

    const result = await searchWeb('maestro studio', 5, deps);

    expect(result.engine).toBe('google');
    expect(result.count).toBe(2);
    expect(result.items[0]).toEqual({ title: 'Result One', url: 'https://a.example/' });
    expect(result.results).toContain('[1] Result One');
    expect(navigatedUrls).toEqual(['https://www.google.com/search?q=maestro%20studio&num=10&hl=en']);
  });

  it('falls through to the next engine when one yields zero results', async () => {
    const navigatedUrls: string[] = [];
    const deps = makeDeps({
      runCommand: async (action, params) => {
        if (action === 'navigate') {
          navigatedUrls.push(String(params?.url));
          return {};
        }
        if (action === 'evaluate') {
          const onGoogle = navigatedUrls[navigatedUrls.length - 1]?.includes('google.com');
          if (onGoogle) return { text: '[]' };
          return { text: JSON.stringify([{ t: 'DDG Result', u: 'https://c.example/' }]) };
        }
        return {};
      },
    });

    const result = await searchWeb('rare query', 5, deps);

    expect(result.engine).toBe('ddg');
    expect(result.items).toEqual([{ title: 'DDG Result', url: 'https://c.example/' }]);
    expect(navigatedUrls[0]).toContain('google.com');
    expect(navigatedUrls[1]).toContain('duckduckgo.com');
  });

  it('reports an aggregated error when every engine fails', async () => {
    const deps = makeDeps({
      runCommand: async (action) => {
        if (action === 'navigate') return { error: 'timeout' };
        return {};
      },
    });

    const result = await searchWeb('anything', 5, deps);

    expect(result.engine).toBe('none');
    expect(result.count).toBe(0);
    expect(result.error).toContain('google: timeout');
    expect(result.error).toContain('ddg: timeout');
    expect(result.error).toContain('bing: timeout');
  });

  it('caps returned items at numResults', async () => {
    const deps = makeDeps({
      runCommand: async (action) => {
        if (action === 'navigate') return {};
        if (action === 'evaluate') {
          const many = Array.from({ length: 10 }, (_, i) => ({ t: `Item ${i}`, u: `https://x.example/${i}` }));
          return { text: JSON.stringify(many) };
        }
        return {};
      },
    });

    const result = await searchWeb('query', 3, deps);
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(3);
  });
});
