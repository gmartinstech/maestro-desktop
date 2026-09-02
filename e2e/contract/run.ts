// e2e/contract/run.ts — implementation-agnostic contract test harness.
//
// http.spec.ts and ws.spec.ts point this at a RUNNING backend (Python today, a future
// TypeScript rewrite later) and assert on the wire behavior only: no import of backend
// source, no Playwright Electron/browser fixtures. The backend itself is booted and torn
// down by scripts/run-contract-tests.mjs (isolated data dirs, MAESTRO_MOCK_AGENT=1, same
// pattern as scripts/gen-contract.mjs / e2e/golden/fixtures.ts), which hands this file's
// config down as CONTRACT_HTTP_URL / CONTRACT_TOKEN env vars.
//
// Auth-exemption lists below mirror backend/auth.py's P_AUTH_EXEMPT_EXACT /
// P_AUTH_EXEMPT_PREFIX by hand (same "frozen contract, update here first" convention as
// contract/ws/*.ts) — if a route's auth gating changes, this drifts from live behavior
// until someone updates it, so http.spec.ts's failure is the signal, not a silent pass.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Playwright's test transform runs this as CommonJS, so __dirname (not import.meta.url) is
// the right way to anchor paths — same as e2e/contract/fixtures.ts and e2e/helpers/launch.ts.
const P_HERE = __dirname;

export interface ContractConfig {
  /** e.g. "http://127.0.0.1:8399" — no trailing slash. */
  baseUrl: string;
  /** The per-install bearer token a real client would send as `Authorization: Bearer <token>`. */
  token: string;
}

/** Reads CONTRACT_HTTP_URL / CONTRACT_TOKEN from the environment (as set by
 * scripts/run-contract-tests.mjs), with `overrides` winning when a caller wants a specific
 * backend/token instead (e.g. a future TS-rewrite harness pointing this at a second port). */
export function loadContractConfig(overrides: Partial<ContractConfig> = {}): ContractConfig {
  const baseUrl = (overrides.baseUrl ?? process.env.CONTRACT_HTTP_URL ?? '').replace(/\/+$/, '');
  const token = overrides.token ?? process.env.CONTRACT_TOKEN ?? '';
  if (!baseUrl) throw new Error('CONTRACT_HTTP_URL is not set (and no baseUrl override was given)');
  if (!token) throw new Error('CONTRACT_TOKEN is not set (and no token override was given)');
  return { baseUrl, token };
}

function httpUrl(cfg: ContractConfig, path: string): string {
  return `${cfg.baseUrl}${path}`;
}

/** Same host:port as the HTTP base, `ws://` scheme, for the `/ws/...` endpoints. */
export function wsUrl(cfg: ContractConfig, path: string): string {
  return `${cfg.baseUrl.replace(/^http/, 'ws')}${path}`;
}

interface TokenOpt {
  /** Omit to use `cfg.token`; pass `null` to send NO token at all; pass a string to send that
   * exact (possibly wrong) token instead. */
  token?: string | null;
}

function authHeaders(cfg: ContractConfig, opt: TokenOpt): Record<string, string> {
  const t = opt.token === undefined ? cfg.token : opt.token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function httpGet(cfg: ContractConfig, path: string, opt: TokenOpt = {}): Promise<Response> {
  return fetch(httpUrl(cfg, path), { headers: authHeaders(cfg, opt) });
}

export async function httpPostJson(cfg: ContractConfig, path: string, body: unknown, opt: TokenOpt = {}): Promise<Response> {
  return fetch(httpUrl(cfg, path), {
    method: 'POST',
    headers: { ...authHeaders(cfg, opt), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function httpOptions(cfg: ContractConfig, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(httpUrl(cfg, path), { method: 'OPTIONS', headers });
}

// ---- auth exemption (mirrors backend/auth.py) ----

export const AUTH_EXEMPT_EXACT: ReadonlySet<string> = new Set([
  '/api/subscriptions/callback',
  '/api/tools/oauth/callback',
  '/api/tools/oauth/cloud-claim',
  '/api/version',
  '/api/tools/google-oauth-token',
  '/api/dev/token',
]);

export const AUTH_EXEMPT_PREFIXES: readonly string[] = [
  '/api/health',
  '/api/openai-passthrough',
  '/docs',
  '/openapi',
  '/redoc',
  '/favicon',
];

export function isAuthExemptPath(path: string): boolean {
  if (AUTH_EXEMPT_EXACT.has(path)) return true;
  return AUTH_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

/** GET routes that are auth-exempt (so a no-token request reaches their real handler) but
 * whose real handler places a live outbound call to a third-party provider — hitting them
 * from an automated sweep would fire a real network request, not just probe routing. Excluded
 * on purpose: `/api/openai-passthrough/v1/{rest}` forwards straight to `api.openai.com`
 * (see backend/apps/agents/core/openai_passthrough.py). `/api/anthropic-proxy/...` needs no
 * such exclusion — it is NOT auth-exempt, so a no-token GET 401s at the middleware and never
 * reaches its handler. */
export const HTTP_SWEEP_EXCLUDED_PATHS: ReadonlySet<string> = new Set(['/api/openai-passthrough/v1/{rest}']);

/** All GET-method paths from the frozen contract/openapi.json (CTR-1's artifact). */
export function contractGetPaths(): string[] {
  const openapiPath = join(P_HERE, '..', '..', 'contract', 'openapi.json');
  const spec = JSON.parse(readFileSync(openapiPath, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  return Object.keys(spec.paths).filter((p) => 'get' in spec.paths[p]);
}

// ---- WS helpers ----

/** Opens `/ws/agents/{sessionId}` and starts recording every frame into `messages` (attached
 * before `open` fires, so nothing sent immediately on connect is ever missed). Pass
 * `token: null` to connect with no token at all (bad-auth test); omit to use `cfg.token`. */
export function openAgentSocket(cfg: ContractConfig, sessionId: string, opt: TokenOpt = {}): { ws: WebSocket; messages: unknown[] } {
  const url = new URL(wsUrl(cfg, `/ws/agents/${encodeURIComponent(sessionId)}`));
  const t = opt.token === undefined ? cfg.token : opt.token;
  if (t) url.searchParams.set('token', t);
  const ws = new WebSocket(url);
  const messages: unknown[] = [];
  ws.addEventListener('message', (ev) => {
    try {
      messages.push(JSON.parse(ev.data as string));
    } catch {
      messages.push(ev.data);
    }
  });
  return { ws, messages };
}

export function sendJson(ws: WebSocket, obj: unknown): void {
  ws.send(JSON.stringify(obj));
}

export function waitForOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === ws.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error(`WS never opened within ${timeoutMs}ms`)), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WS errored before opening')); }, { once: true });
  });
}

export interface WsClose { code: number; reason: string }

export function waitForClose(ws: WebSocket, timeoutMs = 5_000): Promise<WsClose> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS never closed within ${timeoutMs}ms`)), timeoutMs);
    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      resolve({ code: (ev as CloseEvent).code, reason: (ev as CloseEvent).reason });
    }, { once: true });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls `messages` (as populated by openAgentSocket) until one satisfies `predicate`, then
 * returns it. Scans from the start every poll — the message arrays in this suite are always
 * small (single-digit counts per test), so this stays simple rather than tracking a cursor. */
export async function waitForMessage(
  messages: unknown[],
  predicate: (m: any) => boolean,
  timeoutMs = 8_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = messages.find(predicate);
    if (hit !== undefined) return hit;
    await sleep(25);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for a matching WS message; saw ${messages.length}: ${JSON.stringify(messages).slice(0, 4000)}`);
}

/** Polls until some message satisfies `predicate`, then returns every message up to and
 * including it, in order. */
export async function collectUntil(
  messages: unknown[],
  predicate: (m: any) => boolean,
  timeoutMs = 8_000,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = messages.findIndex(predicate);
    if (idx !== -1) return messages.slice(0, idx + 1);
    await sleep(25);
  }
  throw new Error(`timed out after ${timeoutMs}ms collecting WS messages; saw ${messages.length}: ${JSON.stringify(messages).slice(0, 4000)}`);
}

// ---- REST scaffolding used only to set up WS scenarios (not itself under test) ----

/** POST /api/agents/launch with no `initial_message` — creates an idle session and returns
 * its id. Model/mode/provider don't matter under MAESTRO_MOCK_AGENT=1: MockAgent.run_mock_turn
 * ignores them and always answers with a deterministic echo (see backend/apps/agents/manager/MockAgent.py). */
export async function launchAgentSession(cfg: ContractConfig): Promise<string> {
  const res = await httpPostJson(cfg, '/api/agents/launch', { model: 'sonnet', mode: 'agent', provider: 'anthropic' });
  if (!res.ok) throw new Error(`POST /api/agents/launch -> ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { session_id: string };
  return body.session_id;
}
