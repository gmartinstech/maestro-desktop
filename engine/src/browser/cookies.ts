// engine/src/browser/cookies.ts -- BRW-6: interactive login / cookie capture, the named
// escalation point in docs/plans/2026-08-31-txm-tauri-typescript-migration.md's Phase BRW.
//
// D3's own text (that plan doc, "Cost, stated honestly" paragraph) is explicit about this one
// flow: "for user-driven login, show the external Chromium window itself (non-headless,
// positioned over the card) rather than the screencast; cookies come from the CDP
// Network.getCookies on that browser's profile instead of an Electron partition." That is what
// this file does -- it deliberately does NOT reuse screencastServer.ts's registry (BRW-4), which
// always launches HEADLESS (see launcher.ts's LaunchOptions doc: a real headed window can go
// invisible to Page.startScreencast). This module always launches the browser real and visible
// (launchBrowser()'s `headless` option defaults to false -- see launcher.ts), because a human
// needs to actually see and type into the window to complete a real login (password, 2FA).
//
// The hard part named by the ticket: there is no single universal "login finished" signal. This
// implements the two reasonable, configurable-per-connector approaches the ticket names:
//   (1) poll for a specific cookie name to appear (config.successCookieNames, any-of) -- the
//       primary mechanism, since a real auth session cookie is the actual thing every consumer
//       (the social MCP shims) needs anyway;
//   (2) poll for the page's URL to match a known post-login redirect pattern
//       (config.successUrlPattern) -- an additional/alternate signal for connectors whose auth
//       cookie name is unknown or unstable.
// Both are timeout-bounded (config.timeoutMs, generous by default -- a real login with 2FA takes
// minutes, not seconds) and polled at config.pollIntervalMs. Whichever fires first wins; a
// timeout with neither firing is reported as an error, not a silent empty success.
//
// Per-domain success-cookie names are duplicated from backend/main.py's P_SESSION_COOKIE_DOMAINS /
// P_SESSION_AUTH_COOKIES (backend/** is frozen for this ticket, so it can't be imported) -- kept in
// sync by convention, the same posture as this migration's other frontend/engine wire-shape
// duplications (e.g. screencastServer.ts's CDP_SCREEN_WIDTH/HEIGHT mirroring BrowserCanvasCdp.tsx).
//
// Scope note: this file (plus the HTTP wiring at its bottom, wired into server.ts) replaces
// Electron's readPartitionCookies (electron/main.js:2974) for the ONE MAESTRO_BROWSER_ENGINE=cdp
// path. It does NOT touch backend/apps/social_shims/session_source.py's BRIDGE_URL consumer (the
// MCP shims still call Python's /api/browser-session/cookies) -- under cdp mode, Python's own
// browser_session_cookies handler still runs unmodified, but its WS bridge to Electron
// (ws_manager.send_main_command/send_browser_command) has nothing to answer it under a headless
// engine or Tauri shell anyway, so this ticket's engine-native HTTP handler intercepts the SAME
// /api/browser-session/* paths ahead of the proxy (see server.ts), only when the switch is on.
// Making the Python-side MCP shim itself engine-aware end-to-end is SUB-9's job (it already
// depends on this ticket per the plan doc), not this one's.

import { launchBrowser, type LaunchedBrowser, type ResolveDeps } from './launcher';
import { connectCdpSession, findPageTargetWsUrl, type CdpSession } from './screencast';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface CapturedCookie {
  name: string;
  value: string;
}

export interface CookieCaptureResult {
  cookies: CapturedCookie[];
  userAgent: string;
  error?: string;
}

export interface LoginCaptureConfig {
  domain: string;
  loginUrl: string;
  /** Any of these cookie names appearing (with a non-empty value) counts as "logged in". */
  successCookieNames: readonly string[];
  /** Optional alternate/additional success signal: the live page's URL matching this pattern. */
  successUrlPattern?: RegExp;
  /** Real logins (2FA included) take minutes -- default is generous on purpose. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface CookieCaptureDeps {
  launchBrowser: (deps?: ResolveDeps) => Promise<LaunchedBrowser>;
  findPageTargetWsUrl: (cdpPort: number) => Promise<string>;
  connectCdpSession: (wsUrl: string) => Promise<CdpSession>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_MS = 1000;

// Tracks every browser this module has launched and not yet closed, so a graceful engine shutdown
// (main.ts's SIGINT/SIGTERM handler) can force-close whatever is still mid-login -- same hygiene
// concern as screencastServer.ts's closeAll(), which launcher.ts's own integration-check gate
// checks for (an orphaned msedge.exe/chrome.exe after close()).
const activeCaptureBrowsers = new Set<LaunchedBrowser>();

/** Force-closes every browser this module currently has open (an in-progress login capture).
 * Wired into main.ts's shutdown, mirroring getSharedBrowserScreencastRegistry().closeAll(). */
export async function closeAllLoginCaptures(): Promise<void> {
  await Promise.all([...activeCaptureBrowsers].map((b) => b.close().catch(() => { /* best-effort */ })));
}

// Real, VISIBLE (non-headless) by default -- launcher.ts's LaunchOptions.headless defaults to
// false, and this is the one BRW consumer that must never flip it, per this file's header.
export function defaultCookieCaptureDeps(): CookieCaptureDeps {
  return {
    launchBrowser: (deps) => launchBrowser(deps),
    findPageTargetWsUrl,
    connectCdpSession,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

function normalizeDomain(raw: string): string {
  return raw.toLowerCase().trim().replace(/^\./, '').replace(/^www\./, '');
}

interface RawCdpCookie {
  name: string;
  value: string;
  domain?: string;
}

async function readCookies(cdp: CdpSession): Promise<RawCdpCookie[]> {
  const result = (await cdp.send('Network.getCookies')) as { cookies?: RawCdpCookie[] };
  return result.cookies ?? [];
}

async function evalString(cdp: CdpSession, expression: string): Promise<string> {
  const result = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })) as {
    result?: { value?: string };
  };
  return result.result?.value ?? '';
}

function cookiesIndicateSuccess(cookies: readonly RawCdpCookie[], names: readonly string[]): boolean {
  return names.some((n) => cookies.some((c) => c.name === n && c.value));
}

// One of the two configurable detection strategies the ticket names, run every pollIntervalMs
// until either fires or the deadline passes. Cookie-presence is checked first every iteration
// (cheaper, and the more reliable signal) before the URL-pattern probe.
async function pollUntilLoggedIn(cdp: CdpSession, config: LoginCaptureConfig, deps: CookieCaptureDeps): Promise<boolean> {
  const deadline = deps.now() + (config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const interval = config.pollIntervalMs ?? DEFAULT_POLL_MS;
  while (deps.now() < deadline) {
    const cookies = await readCookies(cdp).catch(() => [] as RawCdpCookie[]);
    if (cookiesIndicateSuccess(cookies, config.successCookieNames)) return true;
    if (config.successUrlPattern) {
      const url = await evalString(cdp, 'location.href').catch(() => '');
      if (config.successUrlPattern.test(url)) return true;
    }
    await deps.sleep(interval);
  }
  return false;
}

// A CDP cookie's `domain` can carry a leading dot (parent-domain cookie, e.g. ".reddit.com") or be
// a subdomain (e.g. "old.reddit.com") -- match either direction against the requested domain.
function scopedCookies(raw: readonly RawCdpCookie[], domain: string): CapturedCookie[] {
  const wanted = normalizeDomain(domain);
  return raw
    .filter((c) => {
      const cd = normalizeDomain(c.domain ?? '');
      return cd.length > 0 && (cd === wanted || cd.endsWith(`.${wanted}`) || wanted.endsWith(`.${cd}`));
    })
    .map((c) => ({ name: c.name, value: c.value }));
}

/**
 * The BRW-6 mechanism itself: launch a REAL, VISIBLE external Chromium (BRW-1's launcher),
 * navigate it to `config.loginUrl`, wait (poll, timeout-bounded) for a per-connector "logged in"
 * signal, then read cookies via CDP's Network.getCookies() -- no Electron partition involved.
 * The window stays open and on-screen for the whole wait so a real human can complete a real
 * login (password, 2FA) in it; it is closed once success or timeout fires, in `finally`, so a
 * failed/abandoned attempt never leaks a browser process.
 */
export async function captureLoginCookies(
  config: LoginCaptureConfig,
  deps: CookieCaptureDeps = defaultCookieCaptureDeps(),
): Promise<CookieCaptureResult> {
  let browser: LaunchedBrowser | undefined;
  let cdp: CdpSession | undefined;
  try {
    browser = await deps.launchBrowser();
    activeCaptureBrowsers.add(browser);
    const wsUrl = await deps.findPageTargetWsUrl(browser.cdpPort);
    cdp = await deps.connectCdpSession(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    const navResult = (await cdp.send('Page.navigate', { url: config.loginUrl })) as { errorText?: string };
    if (navResult.errorText) {
      return { cookies: [], userAgent: '', error: `Navigation to ${config.loginUrl} failed: ${navResult.errorText}` };
    }

    const success = await pollUntilLoggedIn(cdp, config, deps);
    const rawCookies = await readCookies(cdp).catch(() => [] as RawCdpCookie[]);
    const userAgent = await evalString(cdp, 'navigator.userAgent').catch(() => '');
    const cookies = scopedCookies(rawCookies, config.domain);

    if (!success) {
      const timeoutS = Math.round((config.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
      return {
        cookies: [],
        userAgent,
        error: `Timed out after ${timeoutS}s waiting for sign-in to ${config.domain} (looked for cookie(s): ${config.successCookieNames.join(', ') || '(none configured)'}${config.successUrlPattern ? `, or URL matching ${config.successUrlPattern}` : ''}).`,
      };
    }
    if (cookies.length === 0) {
      return { cookies: [], userAgent, error: `Sign-in appeared to complete but no cookies for ${config.domain} were readable.` };
    }
    return { cookies, userAgent };
  } catch (err) {
    return { cookies: [], userAgent: '', error: `Cookie capture failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    try { cdp?.close(); } catch { /* best-effort */ }
    if (browser) {
      await browser.close().catch(() => { /* best-effort */ });
      activeCaptureBrowsers.delete(browser);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Server wiring: an in-engine registry + native HTTP handler for /api/browser-session/*, used
// only when server.ts's caller has already checked MAESTRO_BROWSER_ENGINE=cdp. Under the default
// 'electron' engine mode these paths are untouched (proxy straight to Python's existing
// readPartitionCookies-backed implementation, backend/main.py:652-707).
// ---------------------------------------------------------------------------------------------

// Duplicated from backend/main.py's P_SESSION_COOKIE_DOMAINS / P_SESSION_AUTH_COOKIES (backend/**
// is frozen for this ticket) -- the map's keys double as the domain allowlist (same trust posture
// as Electron's SESSION_COOKIE_DOMAINS: an unlisted domain can never be captured, even by an
// authenticated localhost caller).
export const KNOWN_LOGIN_SUCCESS_COOKIES: Readonly<Record<string, readonly string[]>> = {
  'reddit.com': ['reddit_session', 'token_v2'],
  'x.com': ['auth_token'],
  'twitter.com': ['auth_token'],
  'tiktok.com': ['sessionid', 'sessionid_ss'],
};

interface LoginSessionState {
  status: 'pending' | 'done';
  result?: CookieCaptureResult;
}

// One process-wide registry (mirrors screencastServer.ts's sharedRegistry pattern) -- a class
// would be overkill here since there's exactly one real instance and tests just clear this Map.
const loginSessions = new Map<string, LoginSessionState>();

/** Exported for tests only -- clears every in-flight/completed session between test cases. */
export function resetLoginSessionsForTest(): void {
  loginSessions.clear();
}

function startCapture(
  rawDomain: string,
  loginUrl: string,
  deps?: CookieCaptureDeps,
): { started: boolean; error?: string } {
  const domain = normalizeDomain(rawDomain);
  const successNames = KNOWN_LOGIN_SUCCESS_COOKIES[domain];
  if (!successNames) return { started: false, error: `domain not allowed: ${domain || '(empty)'}` };
  const existing = loginSessions.get(domain);
  if (existing && existing.status === 'pending') {
    return { started: false, error: 'a sign-in is already in progress for this domain' };
  }
  const state: LoginSessionState = { status: 'pending' };
  loginSessions.set(domain, state);
  const config: LoginCaptureConfig = { domain, loginUrl, successCookieNames: successNames };
  // Fire-and-forget: a real login can take minutes (2FA), far longer than an HTTP response should
  // ever block for. The frontend's own status poll (BrowserLoginConnect.tsx) picks up the result
  // once `state.status` flips to 'done'; nothing else awaits this promise, so its rejection branch
  // (captureLoginCookies never actually throws -- every failure path returns an `error` field
  // instead, see its own try/catch) only exists as a defensive backstop.
  captureLoginCookies(config, deps)
    .then((result) => { state.status = 'done'; state.result = result; })
    .catch((err: unknown) => {
      state.status = 'done';
      state.result = { cookies: [], userAgent: '', error: `Unexpected capture failure: ${err instanceof Error ? err.message : String(err)}` };
    });
  return { started: true };
}

function statusFor(rawDomain: string): { connected: boolean; pending: boolean; domain: string; error?: string } {
  const domain = normalizeDomain(rawDomain);
  if (!KNOWN_LOGIN_SUCCESS_COOKIES[domain]) {
    return { connected: false, pending: false, domain, error: `domain not allowed: ${domain || '(empty)'}` };
  }
  const state = loginSessions.get(domain);
  if (!state) return { connected: false, pending: false, domain };
  if (state.status === 'pending') return { connected: false, pending: true, domain };
  const result = state.result;
  const connected = !!result && result.cookies.length > 0 && !result.error;
  return { connected, pending: false, domain, error: result?.error };
}

function cookiesFor(rawDomain: string): CookieCaptureResult & { domain: string } {
  const domain = normalizeDomain(rawDomain);
  if (!KNOWN_LOGIN_SUCCESS_COOKIES[domain]) {
    return { cookies: [], userAgent: '', error: `domain not allowed: ${domain || '(empty)'}`, domain };
  }
  const state = loginSessions.get(domain);
  if (!state || state.status === 'pending') {
    return { cookies: [], userAgent: '', error: 'not signed in yet', domain };
  }
  return { cookies: state.result?.cookies ?? [], userAgent: state.result?.userAgent ?? '', error: state.result?.error, domain };
}

// Fastify's own body parsers are disabled engine-wide (server.ts, so proxied bodies forward
// byte-for-byte) -- request.body always arrives as a raw Buffer here, same pattern as
// settings/handler.ts's parseJsonObjectBody.
function parseJsonBody(request: FastifyRequest): Record<string, unknown> | null {
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

/**
 * Handles POST /api/browser-session/login (start a capture) and GET .../status, .../cookies --
 * the CDP-engine replacement for Python's Electron-only browser_session_* endpoints
 * (backend/main.py:652-707). Only ever called by server.ts once it has already confirmed
 * MAESTRO_BROWSER_ENGINE=cdp; returns false for any other /api/browser-session/* subpath (e.g.
 * /action, TikTok's write-delegation bridge) so the caller falls through to the normal proxy --
 * same "partial native" convention as settings/handler.ts's handleSettingsHttpRequest.
 */
export async function handleBrowserLoginHttpRequest(
  pathname: string,
  request: FastifyRequest,
  reply: FastifyReply,
  deps?: CookieCaptureDeps,
): Promise<boolean> {
  const method = request.method.toUpperCase();
  const url = new URL(request.raw.url ?? pathname, 'http://internal');

  if (pathname === '/api/browser-session/login' && method === 'POST') {
    const body = parseJsonBody(request);
    if (!body) { reply.code(400).send({ error: 'invalid JSON body' }); return true; }
    const domain = String(body.domain ?? '');
    const loginUrl = String(body.loginUrl ?? '');
    if (!domain || !loginUrl) { reply.code(400).send({ error: 'domain and loginUrl are required' }); return true; }
    const outcome = startCapture(domain, loginUrl, deps);
    reply.code(outcome.started ? 202 : 200).send(outcome);
    return true;
  }

  if (pathname === '/api/browser-session/status' && method === 'GET') {
    reply.send(statusFor(url.searchParams.get('domain') ?? ''));
    return true;
  }

  if (pathname === '/api/browser-session/cookies' && method === 'GET') {
    reply.send(cookiesFor(url.searchParams.get('domain') ?? ''));
    return true;
  }

  return false;
}
