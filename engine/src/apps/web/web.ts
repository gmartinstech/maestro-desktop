// engine/src/apps/web/web.ts -- SUB-8's native HTTP handler for backend/apps/web/web.py
// (~643 LOC), the search/fetch cascade the in-process MCP server (backend/apps/agents/
// web_mcp_server.py, read-only, unaffected -- still a plain HTTP client of whatever port it's
// pointed at) proxies WebSearch/WebFetch tool calls to. Full route parity: POST /search,
// POST /fetch.
//
// THE ELECTRON-MAIN-BRIDGE REPLACEMENT (this ticket's actual point): the Python original's
// browser tier (`p_browser_bridge`) drives Electron's offscreen BrowserWindow over the
// `/ws/electron-main` WebSocket bridge (ws_manager.send_main_command), because Python has no
// browser of its own. This port has one -- BRW-5's `browser/fetch.ts` (fetchPageContent/
// searchWeb), a real CDP-controlled Chromium launched in-process. So this tier below is a direct,
// in-process function call, not a WebSocket round-trip to a hidden window in a different process:
// no `/ws/electron-main` connection is opened, attempted, or needed anywhere in this file. It's
// gated on `MAESTRO_BROWSER_ENGINE=cdp` (default `electron`), same convention as every other BRW-5/
// BRW-6 caller in the engine -- when unset, this tier is simply unavailable (the cascade falls
// through to the next tier), which is exactly correct under Tauri/the engine: there IS no Electron
// main process here for a bridge to reach even in principle. `/ws/electron-main` itself (contract/
// ws/electron-main.ts, backend/main.py:457, electron/main.js's connectMainBridge()) is untouched --
// still real, still serving Python's OWN copy of this cascade whenever 'web' stays 'proxy' (the
// default) -- and stays that way until CUT deletes backend/**/electron/** wholesale; this ticket
// only proves the engine-native path never needs it.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { fetchPageContent, searchWeb, type EngineFetchResult, type EngineSearchResult } from '../../browser/fetch';
import { DDGRateLimited, searchDdg } from './ddg';
import {
  formatGroundedAsFetch,
  formatGroundedAsSearchResults,
  geminiGroundedCall,
  geminiGroundedVia9Router,
  openaiUrlfetch,
  openaiWebsearch,
  openaiWebsearchVia9Router,
  resolveGeminiApiKey,
  resolveOpenaiApiKey,
  type GroundedResult,
} from './grounded';
import { localFetchText } from './localFetch';
import { refresh9rConnected } from './nineRouter';
import { assertSafeUrl, SSRFBlocked } from './ssrfGuard';

// Per-attempt timeouts for the search/fetch cascade -- same values and same rationale as web.py's
// own module-level constants: DDG/local lead (near-instant on the happy path), the CDP browser
// tier is a real-but-slower rendering fallback, and the LLM-grounded tiers are a hang safety-net
// set just above each path's own per-call timeout so a normally-slow call still completes.
const P_DDG_ATTEMPT_TIMEOUT_MS = 6_000;
const P_GROUNDED_ATTEMPT_TIMEOUT_MS = 48_000;
const P_LOCAL_FETCH_TIMEOUT_MS = 32_000;
const P_BROWSER_TIER_TIMEOUT_MS = 46_000;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class CascadeTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CascadeTimeoutError(`timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

interface CascadeStep<T> {
  name: string;
  timeoutMs: number;
  run: () => Promise<T | null>;
}

/** Runs each step in order, stopping at the first non-null result. Mirrors web.py's own cascade
 * loop (`for name, fn, timeout in cascade: ...`) -- a timeout or thrown error is recorded and the
 * cascade moves on, never aborted early. One acknowledged divergence from asyncio.wait_for: a
 * step that times out keeps running in the background (JS has no cheap "cancel this promise"),
 * its eventual result is just discarded -- never surfaced to the caller, so this is a latency/
 * resource-cleanup difference only, not a correctness one. */
async function runCascade<T>(steps: Array<CascadeStep<T>>): Promise<{ result: T | null; errors: string[] }> {
  const errors: string[] = [];
  for (const step of steps) {
    try {
      const res = await withTimeout(step.run(), step.timeoutMs);
      if (res !== null) return { result: res, errors };
    } catch (err) {
      if (err instanceof CascadeTimeoutError) errors.push(`${step.name}: ${err.message}`);
      else errors.push(`${step.name}: ${errMsg(err).slice(0, 150)}`);
    }
  }
  return { result: null, errors };
}

function browserFallbackNudge(query: string): string {
  return (
    "Don't stop here: fall back to the in-product browser, which renders real pages and " +
    "isn't subject to this rate limit. Call CreateBrowserAgent with a task like: " +
    `"Search the web for: ${query}. Report the top results with their titles and URLs, ` +
    'plus a direct answer if you find one."'
  );
}

function cdpBrowserEnabled(): boolean {
  return process.env.MAESTRO_BROWSER_ENGINE === 'cdp';
}

// ---------------------------------------------------------------------------------------------
// /search
// ---------------------------------------------------------------------------------------------

export interface SearchBody {
  query: string;
  num_results?: number;
  primary?: string | null;
  browser_ok?: boolean;
}

export interface SearchResult {
  query: string;
  results: string;
  backend: string;
  cascade_errors?: string[];
}

export interface WebSearchDeps {
  resolveGeminiApiKey: typeof resolveGeminiApiKey;
  resolveOpenaiApiKey: typeof resolveOpenaiApiKey;
  geminiGroundedCall: typeof geminiGroundedCall;
  geminiGroundedVia9Router: typeof geminiGroundedVia9Router;
  openaiWebsearch: typeof openaiWebsearch;
  openaiWebsearchVia9Router: typeof openaiWebsearchVia9Router;
  searchDdg: typeof searchDdg;
  searchWeb: (query: string, numResults?: number) => Promise<EngineSearchResult>;
  refresh9rConnected: typeof refresh9rConnected;
  isCdpBrowserEnabled: () => boolean;
}

export const defaultWebSearchDeps: WebSearchDeps = {
  resolveGeminiApiKey,
  resolveOpenaiApiKey,
  geminiGroundedCall,
  geminiGroundedVia9Router,
  openaiWebsearch,
  openaiWebsearchVia9Router,
  searchDdg,
  searchWeb,
  refresh9rConnected,
  isCdpBrowserEnabled: cdpBrowserEnabled,
};

/** Web search, primary-aware. Full port of web.py's `search()`. */
export async function performSearch(body: SearchBody, deps: WebSearchDeps = defaultWebSearchDeps): Promise<SearchResult> {
  const numResults = body.num_results ?? 5;
  const primary = (body.primary ?? '').toLowerCase();
  const geminiKey = deps.resolveGeminiApiKey();
  const openaiKey = deps.resolveOpenaiApiKey();

  const searchPrompt = `Search the web for: ${body.query}\n\nReturn a concise summary of what you found. Cite sources.`;

  async function tryGemini(): Promise<SearchResult | null> {
    if (!geminiKey) return null;
    const grounded = await deps.geminiGroundedCall(geminiKey, searchPrompt, false);
    return { query: body.query, results: formatGroundedAsSearchResults(grounded, body.query), backend: 'gemini_native' };
  }
  async function tryOpenai(): Promise<SearchResult | null> {
    if (!openaiKey) return null;
    const grounded = await deps.openaiWebsearch(openaiKey, body.query);
    return { query: body.query, results: formatGroundedAsSearchResults(grounded, body.query), backend: 'openai_native' };
  }
  async function tryGeminiSubscription(): Promise<SearchResult | null> {
    const grounded = await deps.geminiGroundedVia9Router(searchPrompt, false);
    if (!grounded.text) return null;
    return { query: body.query, results: formatGroundedAsSearchResults(grounded, body.query), backend: 'gemini_subscription' };
  }
  async function tryOpenaiSubscription(): Promise<SearchResult | null> {
    const grounded = await deps.openaiWebsearchVia9Router(body.query);
    if (!grounded.text) return null;
    return { query: body.query, results: formatGroundedAsSearchResults(grounded, body.query), backend: 'openai_subscription' };
  }
  async function tryDdg(): Promise<SearchResult | null> {
    let text: string;
    try {
      text = await deps.searchDdg(body.query, numResults);
    } catch (err) {
      if (err instanceof DDGRateLimited) throw new Error('DuckDuckGo rate-limited (HTTP 202)');
      throw err;
    }
    if (!text) return null;
    return { query: body.query, results: text, backend: 'ddg' };
  }
  async function tryBrowserSearch(): Promise<SearchResult | null> {
    // Packaged-app tier: a real Chromium's fingerprint isn't subject to the httpx DDG 202
    // throttle, and it can scrape Google/Bing directly. Skipped (null) unless the CDP browser
    // engine is switched on -- see this file's own module doc for why that's correct under the
    // engine (no Electron main-bridge equivalent to fall back to when it's off).
    if (!deps.isCdpBrowserEnabled()) return null;
    const res = await deps.searchWeb(body.query, numResults);
    if (!res || !res.results) return null;
    return { query: body.query, results: res.results, backend: `browser_${res.engine || 'search'}` };
  }

  let grounded: Array<{ name: string; run: () => Promise<SearchResult | null> }> = [
    { name: 'gemini_native', run: tryGemini },
    { name: 'gemini_subscription', run: tryGeminiSubscription },
    { name: 'openai_native', run: tryOpenai },
    { name: 'openai_subscription', run: tryOpenaiSubscription },
  ];
  if (primary === 'openai') grounded = [...grounded.slice(2), ...grounded.slice(0, 2)];

  const cascade: Array<CascadeStep<SearchResult>> = [
    { name: 'ddg', timeoutMs: P_DDG_ATTEMPT_TIMEOUT_MS, run: tryDdg },
    { name: 'browser_search', timeoutMs: P_BROWSER_TIER_TIMEOUT_MS, run: tryBrowserSearch },
    ...grounded.map((g) => ({ name: g.name, timeoutMs: P_GROUNDED_ATTEMPT_TIMEOUT_MS, run: g.run })),
  ];

  const { result, errors } = await runCascade(cascade);
  if (result) {
    if (errors.length > 0) result.cascade_errors = errors;
    return result;
  }

  // Everything failed. Be honest about why instead of an empty "no results".
  const connected = await deps.refresh9rConnected();
  const hasSubscription = ['codex', 'antigravity', 'gemini-cli'].some((p) => connected.has(p));
  const tail = !(geminiKey || openaiKey || hasSubscription)
    ? 'No search backend is configured and DuckDuckGo is rate-limiting this network. Connect ' +
      'Codex / Antigravity / Gemini CLI in Settings, or add an OpenAI / Gemini API key, for ' +
      'reliable search.'
    : 'DuckDuckGo is rate-limiting this network and every configured provider errored (see ' +
      'details below).';
  const nudge = body.browser_ok ? browserFallbackNudge(body.query) : '';
  const resultsText = `No results for: ${body.query}\n\n${tail}${nudge ? `\n\n${nudge}` : ''}`;
  return { query: body.query, results: resultsText, backend: 'none', cascade_errors: errors };
}

// ---------------------------------------------------------------------------------------------
// /fetch
// ---------------------------------------------------------------------------------------------

export interface FetchBody {
  url: string;
  prompt?: string | null;
  primary?: string | null;
}

export interface FetchResult {
  url: string;
  content: string;
  backend: string;
  cascade_errors?: string[];
}

export type FetchOutcome = { ok: true; body: FetchResult } | { ok: false; status: number; detail: string };

export interface WebFetchDeps {
  resolveGeminiApiKey: typeof resolveGeminiApiKey;
  resolveOpenaiApiKey: typeof resolveOpenaiApiKey;
  geminiGroundedCall: typeof geminiGroundedCall;
  geminiGroundedVia9Router: typeof geminiGroundedVia9Router;
  openaiUrlfetch: typeof openaiUrlfetch;
  openaiWebsearchVia9Router: typeof openaiWebsearchVia9Router;
  localFetchText: typeof localFetchText;
  fetchPageContent: (url: string) => Promise<EngineFetchResult>;
  assertSafeUrl: typeof assertSafeUrl;
  isCdpBrowserEnabled: () => boolean;
}

export const defaultWebFetchDeps: WebFetchDeps = {
  resolveGeminiApiKey,
  resolveOpenaiApiKey,
  geminiGroundedCall,
  geminiGroundedVia9Router,
  openaiUrlfetch,
  openaiWebsearchVia9Router,
  localFetchText,
  fetchPageContent,
  assertSafeUrl,
  isCdpBrowserEnabled: cdpBrowserEnabled,
};

/** Fetch a URL, primary-aware. Full port of web.py's `fetch()`. */
export async function performFetch(body: FetchBody, deps: WebFetchDeps = defaultWebFetchDeps): Promise<FetchOutcome> {
  // Belt-and-suspenders: even though the grounded fetchers are remote services that can't reach
  // private IPs themselves, validating the URL here means a private/metadata URL gets a 4xx
  // instead of being silently forwarded to any of them.
  try {
    await deps.assertSafeUrl(body.url);
  } catch (err) {
    if (err instanceof SSRFBlocked) return { ok: false, status: 400, detail: `Refused: ${err.message}` };
    throw err;
  }

  const geminiKey = deps.resolveGeminiApiKey();
  const openaiKey = deps.resolveOpenaiApiKey();
  const prompt = body.prompt ?? null;

  async function groundedFetchPrompt(): Promise<string> {
    const bits = [`Fetch and summarize this URL: ${body.url}`];
    if (prompt) bits.push(`Focus on: ${prompt}`);
    return bits.join('\n');
  }

  async function tryGemini(): Promise<FetchResult | null> {
    if (!geminiKey) return null;
    const grounded = await deps.geminiGroundedCall(geminiKey, await groundedFetchPrompt(), true);
    return { url: body.url, content: formatGroundedAsFetch(grounded, body.url), backend: 'gemini_native' };
  }
  async function tryOpenai(): Promise<FetchResult | null> {
    if (!openaiKey) return null;
    const grounded = await deps.openaiUrlfetch(openaiKey, body.url, prompt);
    return { url: body.url, content: formatGroundedAsFetch(grounded, body.url), backend: 'openai_native' };
  }
  async function tryGeminiSubscription(): Promise<FetchResult | null> {
    const grounded = await deps.geminiGroundedVia9Router(await groundedFetchPrompt(), true);
    if (!grounded.text) return null;
    return { url: body.url, content: formatGroundedAsFetch(grounded, body.url), backend: 'gemini_subscription' };
  }
  async function tryOpenaiSubscription(): Promise<FetchResult | null> {
    // Codex's web_search is general; URL fetch via search query works adequately for our use.
    let p = `Fetch this URL and summarize: ${body.url}`;
    if (prompt) p += `\nFocus on: ${prompt}`;
    const grounded: GroundedResult = await deps.openaiWebsearchVia9Router(p);
    if (!grounded.text) return null;
    return { url: body.url, content: formatGroundedAsFetch(grounded, body.url), backend: 'openai_subscription' };
  }

  // Remembered so a thin/errored local read is still returned as the last resort if every
  // grounded fetcher also fails (never worse than before).
  let localText: string | null = null;
  async function tryLocal(): Promise<FetchResult | null> {
    const text = await deps.localFetchText(body.url, prompt);
    localText = text;
    if (text.startsWith('HTTP error') || text.startsWith('Error fetching') || text.startsWith('Refused to fetch')) return null;
    const bodyText = text.includes('\n\n') ? text.slice(text.indexOf('\n\n') + 2) : text;
    if (bodyText.trim().length < 200) return null;
    return { url: body.url, content: text, backend: 'local' };
  }
  async function tryBrowserFetch(): Promise<FetchResult | null> {
    // Packaged-app tier: renders the page in a real CDP-controlled browser and returns its
    // visible text, so JS-only / SPA / soft-paywall pages that give httpx nothing actually
    // resolve. Skipped (null) unless the CDP browser engine is switched on -- see this file's own
    // module doc for why that's the engine-native replacement for Electron's offscreen-window
    // bridge, not a call over `/ws/electron-main`.
    if (!deps.isCdpBrowserEnabled()) return null;
    const res = await deps.fetchPageContent(body.url);
    if (!res || res.error || !res.text) return null;
    return { url: body.url, content: `Contents of ${body.url}:\n\n${res.text}`, backend: 'browser' };
  }

  let grounded: Array<{ name: string; run: () => Promise<FetchResult | null> }> = [
    { name: 'gemini_native', run: tryGemini },
    { name: 'gemini_subscription', run: tryGeminiSubscription },
    { name: 'openai_native', run: tryOpenai },
    { name: 'openai_subscription', run: tryOpenaiSubscription },
  ];
  if ((body.primary ?? '').toLowerCase() === 'openai') grounded = [...grounded.slice(2), ...grounded.slice(0, 2)];

  const cascade: Array<CascadeStep<FetchResult>> = [
    { name: 'local', timeoutMs: P_LOCAL_FETCH_TIMEOUT_MS, run: tryLocal },
    { name: 'browser', timeoutMs: P_BROWSER_TIER_TIMEOUT_MS, run: tryBrowserFetch },
    ...grounded.map((g) => ({ name: g.name, timeoutMs: P_GROUNDED_ATTEMPT_TIMEOUT_MS, run: g.run })),
  ];

  const { result, errors } = await runCascade(cascade);
  if (result) {
    if (errors.length > 0) result.cascade_errors = errors;
    return { ok: true, body: result };
  }

  // Grounded all failed; hand back whatever the local read got (even an error string is useful
  // signal) rather than nothing.
  if (localText !== null) {
    const fallback: FetchResult = { url: body.url, content: localText, backend: 'local' };
    if (errors.length > 0) fallback.cascade_errors = errors;
    return { ok: true, body: fallback };
  }
  return { ok: false, status: 502, detail: `Fetch failed for ${body.url}: ${errors.join('; ').slice(0, 400)}` };
}

// ---------------------------------------------------------------------------------------------
// HTTP dispatch
// ---------------------------------------------------------------------------------------------

function parseJsonObjectBody(request: FastifyRequest): Record<string, unknown> | null {
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ error: 'bad_request', detail });
  return true;
}

/** Full native, both routes SubApp("web", ...) mounts: POST /search, POST /fetch. Mounted at
 * /api/web (backend/config/Apps.py's SubApp("web", ...) prefix convention). */
export async function handleWebHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const sub = pathname.replace(/^\/api\/web/, '') || '/';
  const method = request.method.toUpperCase();

  if (sub === '/search' && method === 'POST') {
    const parsed = parseJsonObjectBody(request);
    if (parsed === null) return badRequest(reply, 'body must be a JSON object');
    if (typeof parsed.query !== 'string' || !parsed.query) return badRequest(reply, '"query" is required');
    const numResults = typeof parsed.num_results === 'number' ? Math.max(1, Math.min(10, parsed.num_results)) : 5;
    const body: SearchBody = {
      query: parsed.query,
      num_results: numResults,
      primary: typeof parsed.primary === 'string' ? parsed.primary : null,
      browser_ok: parsed.browser_ok === true,
    };
    const result = await performSearch(body);
    reply.code(200).send(result);
    return true;
  }

  if (sub === '/fetch' && method === 'POST') {
    const parsed = parseJsonObjectBody(request);
    if (parsed === null) return badRequest(reply, 'body must be a JSON object');
    if (typeof parsed.url !== 'string' || !parsed.url) return badRequest(reply, '"url" is required');
    const body: FetchBody = {
      url: parsed.url,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : null,
      primary: typeof parsed.primary === 'string' ? parsed.primary : null,
    };
    const outcome = await performFetch(body);
    if (!outcome.ok) {
      reply.code(outcome.status).send({ detail: outcome.detail });
      return true;
    }
    reply.code(200).send(outcome.body);
    return true;
  }

  return false;
}
