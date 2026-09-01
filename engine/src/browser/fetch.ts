// engine/src/browser/fetch.ts -- BRW-5, the CDP-based replacement for Electron's offscreen-
// BrowserWindow fetch/search helpers (electron/hiddenBrowser.js's hiddenFetch/hiddenSearch,
// read-only reference -- this file replicates their FUNCTIONALITY, not their code).
//
// Built entirely on BRW-1's launcher (./launcher.ts: resolves + spawns a real, CDP-controllable
// Edge/Chrome/Playwright-Chromium) and BRW-2's CDP client (./cdp.ts: CdpBrowserPage, the
// navigate/get_text/evaluate command set), same as BRW-3's screencast reused BRW-1. One browser
// process, one tab, per call: launch -> navigate -> settle -> read -> close everything, mirroring
// hiddenBrowser.js's own per-call window lifecycle (makeWindow/withWindow) so the two tiers behave
// the same way operationally (no shared/idle browser instance held between calls).
//
// Backend wiring (what this ticket does NOT do, and why): the ticket's own instructions say
// backend/apps/web/web.py is READ-ONLY for this ticket -- the new engine-backed tier belongs
// entirely in this file. Exposing it as an actual `engine/src/server.ts` HTTP route was evaluated:
// `split.ts` (the ENG phase's route-ownership table) exists, but `server.ts`'s 'native' branch is
// still ENG-1's bare 501 placeholder with no per-name handler dispatch mechanism at all -- there is
// no existing "register a native handler" seam to hook into yet, only a table that says proxy-vs-
// not. Building that dispatch mechanism from scratch is Phase ENG's skeleton work, not this
// browser-fetch ticket's, and `engine/` is explicitly the concurrent ENG phase's territory to
// avoid restructuring per this ticket's own constraints. So: this module exports plain, directly
// callable functions (fetchPageContent / searchWeb) with a stable signature; wiring a real
// `/api/<name>` route onto them is follow-up work once Phase ENG's skeleton grows a native-handler
// registry (or a dedicated BRW-5b/route ticket adds one route by hand). Every call site (backend
// tier alongside the /ws/electron-main bridge, or a future engine route) can import these directly
// in the meantime.
//
// Safety switch: nothing in this file spawns unconditionally at import time or touches the
// existing Electron browser path -- it has no consumer wired in yet, same posture BRW-1/2/3 left
// their own modules in. Whoever wires this into a caller (a future ticket, or the engine-backed
// web tier once web.py is no longer read-only) is the one that must gate the call behind
// `MAESTRO_BROWSER_ENGINE=cdp` (default `electron`), per this phase's global safety-switch rule.

import { launchBrowser, type LaunchedBrowser, type ResolveDeps } from './launcher';
import { CdpBrowserPage } from './cdp';

// ---------------------------------------------------------------------------------------------
// fetchPageContent -- replaces hiddenBrowser.js's hiddenFetch
// ---------------------------------------------------------------------------------------------

export interface EngineFetchResult {
  url: string;
  title: string;
  text: string;
  error?: string;
}

export interface EngineFetchOptions {
  /** How long to wait for the initial navigation before giving up. */
  navigateTimeoutMs?: number;
  /** Extra settle time after navigation completes, for client-rendered (SPA) content to paint --
   * mirrors hiddenBrowser.js's SETTLE_MS. */
  settleMs?: number;
  /** Hard cap on returned text length -- mirrors hiddenBrowser.js's MAX_FETCH_CHARS. */
  maxChars?: number;
}

const P_DEFAULT_SETTLE_MS = 1500;
const P_MAX_FETCH_CHARS = 200000;

// Injected for unit testing, same DI shape as launcher.ts's ResolveDeps and screencast.ts's
// ScreencastDeps -- lets fetch/search logic run against a fake browser+page with no real process.
export interface BrowserPageLike {
  runCommand(action: 'navigate' | 'get_text' | 'evaluate', params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface EngineBrowserDeps {
  launchBrowser: (deps?: ResolveDeps) => Promise<LaunchedBrowser>;
  connectPage: (cdpPort: number) => Promise<BrowserPageLike>;
}

function defaultEngineBrowserDeps(): EngineBrowserDeps {
  return {
    launchBrowser,
    connectPage: (cdpPort: number) => CdpBrowserPage.connect(cdpPort, 'about:blank'),
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs `fn` against a freshly launched browser + connected page, guaranteeing both are torn down
 * (page then browser process) even if `fn` throws -- the same per-call lifecycle guarantee as
 * hiddenBrowser.js's withWindow() ("every path destroys its window in a finally"). */
async function withBrowserPage<T>(
  deps: EngineBrowserDeps,
  fn: (page: BrowserPageLike) => Promise<T>,
): Promise<T> {
  const browser = await deps.launchBrowser();
  let page: BrowserPageLike | null = null;
  try {
    page = await deps.connectPage(browser.cdpPort);
    return await fn(page);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* browser is about to be torn down anyway */
      }
    }
    try {
      await browser.close();
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Loads `url` in a fresh (headless-capable) CDP-controlled browser tab and extracts its rendered
 * visible text -- the CDP-based equivalent of hiddenBrowser.js's hiddenFetch(). Beats a plain
 * httpx GET on JS-only / SPA / soft-paywall pages the same way the Electron tier did: this is a
 * real rendering engine, not a raw HTML parse.
 */
export async function fetchPageContent(
  url: string,
  options: EngineFetchOptions = {},
  deps: EngineBrowserDeps = defaultEngineBrowserDeps(),
): Promise<EngineFetchResult> {
  const settleMs = options.settleMs ?? P_DEFAULT_SETTLE_MS;
  const maxChars = options.maxChars ?? P_MAX_FETCH_CHARS;

  try {
    return await withBrowserPage(deps, async (page) => {
      const nav = await page.runCommand('navigate', { url });
      if (nav.error) return { url, title: '', text: '', error: `Navigation failed: ${String(nav.error)}` };

      // Settle window for client-rendered content, mirroring hiddenBrowser.js's loadAndSettle().
      await new Promise((resolve) => setTimeout(resolve, settleMs));

      const got = await page.runCommand('get_text');
      if (got.error) return { url, title: '', text: '', error: String(got.error) };

      const rawText = typeof got.text === 'string' ? got.text : '';
      const text = rawText.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
      const title = typeof got.title === 'string' ? got.title.slice(0, 300) : '';
      const finalUrl = typeof got.url === 'string' && got.url ? got.url : url;

      if (!text) return { url: finalUrl, title, text: '', error: 'empty page (blocked or no rendered text)' };
      return { url: finalUrl, title, text };
    });
  } catch (err) {
    return { url, title: '', text: '', error: errMsg(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// searchWeb -- replaces hiddenBrowser.js's hiddenSearch
// ---------------------------------------------------------------------------------------------

export interface EngineSearchResultItem {
  title: string;
  url: string;
}

export interface EngineSearchResult {
  engine: string;
  results: string;
  items: EngineSearchResultItem[];
  count: number;
  error?: string;
}

interface SearchEngineDef {
  name: string;
  buildUrl: (query: string) => string;
  // Runs in-page via evaluate(); returns a JSON array of {t,u} pairs.
  scrapeExpression: string;
}

// Same three engines, same priority order and same scrape selectors as hiddenBrowser.js's ENGINES
// table (Google first for direct result URLs, DuckDuckGo second for throttle immunity via a real
// browser fingerprint, Bing last since its results are redirect-wrapped).
const SEARCH_ENGINES: SearchEngineDef[] = [
  {
    name: 'google',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10&hl=en`,
    scrapeExpression:
      "Array.from(document.querySelectorAll('a h3')).map(function(h){var a=h.closest('a');return a&&a.href?{t:h.innerText,u:a.href}:null;}).filter(function(x){return x&&x.u.indexOf('http')===0&&x.u.indexOf('google.')===-1;})",
  },
  {
    name: 'ddg',
    buildUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    scrapeExpression:
      "Array.from(document.querySelectorAll('a.result__a')).map(function(a){var m=a.href.match(/uddg=([^&]+)/);return {t:a.innerText,u:m?decodeURIComponent(m[1]):a.href};})",
  },
  {
    name: 'bing',
    buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    scrapeExpression:
      "Array.from(document.querySelectorAll('li.b_algo h2 a')).map(function(a){return {t:a.innerText,u:a.href};})",
  },
];

function formatSearchResults(items: EngineSearchResultItem[]): string {
  return items.map((r, i) => `[${i + 1}] ${r.title.trim()}\n    ${r.url}`).join('\n\n');
}

/**
 * Runs `query` through a cascade of real-browser search engines (Google -> DuckDuckGo -> Bing),
 * stopping at the first one that yields results -- the CDP-based equivalent of hiddenBrowser.js's
 * hiddenSearch(). A fresh browser+tab is used per engine attempt, same per-call lifecycle as
 * fetchPageContent above.
 */
export async function searchWeb(
  query: string,
  numResults = 5,
  deps: EngineBrowserDeps = defaultEngineBrowserDeps(),
): Promise<EngineSearchResult> {
  const errors: string[] = [];

  for (const engine of SEARCH_ENGINES) {
    try {
      const items = await withBrowserPage(deps, async (page) => {
        const nav = await page.runCommand('navigate', { url: engine.buildUrl(query) });
        if (nav.error) throw new Error(String(nav.error));
        await new Promise((resolve) => setTimeout(resolve, P_DEFAULT_SETTLE_MS));
        const got = await page.runCommand('evaluate', {
          expression: `JSON.stringify((${engine.scrapeExpression}).slice(0, 20))`,
        });
        if (got.error) throw new Error(String(got.error));
        const raw = typeof got.text === 'string' ? got.text : '[]';
        let parsed: Array<{ t?: unknown; u?: unknown }>;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = [];
        }
        return parsed
          .filter((r) => r && typeof r.u === 'string' && typeof r.t === 'string' && r.u && r.t)
          .map((r) => ({ title: String(r.t), url: String(r.u) }));
      });

      const clean = items.slice(0, numResults);
      if (clean.length > 0) {
        return { engine: engine.name, results: formatSearchResults(clean), items: clean, count: clean.length };
      }
      errors.push(`${engine.name}: 0 results`);
    } catch (err) {
      errors.push(`${engine.name}: ${errMsg(err).slice(0, 80)}`);
    }
  }

  return { engine: 'none', results: '', items: [], count: 0, error: `all browser search engines failed: ${errors.join('; ')}` };
}
