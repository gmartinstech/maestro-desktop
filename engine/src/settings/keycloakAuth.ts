// engine/src/settings/keycloakAuth.ts -- ENG-5, a faithful TypeScript port of
// backend/apps/settings/maestro_keycloak_auth.py: the Keycloak Authorization Code + PKCE flow that
// replaces the hand-pasted-JWT login.
//
// Three calls make up the whole flow: buildAuthorizeUrl() mints the PKCE pair and the URL the
// system browser opens; exchangeCodeForTokens() trades the callback's `code` for an access +
// refresh token pair; refreshTokens() rotates that pair again once the access token nears expiry.
// All three talk to the SAME public client (MAESTRO_KEYCLOAK_CLIENT_ID, no secret: PKCE
// authenticates the request instead), so nothing here can leak a client credential because there
// isn't one.
//
// Every response is read for its JSON shape only. Neither an access nor a refresh token, nor the
// authorization `code`, is ever logged or folded into an exception message: a non-200 reaches
// MaestroKeycloakAuthError with the HTTP status and the response's own `error` field only, never
// the raw body (which, on a slow/misconfigured proxy, could echo the request back).
//
// pendingMaestroLogins below is this engine's own (narrow, maestro-only) correlation store for a
// login attempt's (state -> codeVerifier) pair -- the TS-side equivalent of the "provider": "maestro"
// entries backend/apps/oauth_state.py's shared pending_oauth dict carries, and of what
// backend/apps/settings/settings.py's post_maestro_login_start registers there today. This engine
// has no single shared oauth_state.ts of its own yet (ENG-6's router/oauth.ts ported its own
// in-memory pending map for the OTHER, 9Router-mediated providers, but explicitly left the Maestro
// loopback's long-term ownership to this ticket -- see that file's own header), so this module
// keeps a map scoped to exactly the one provider it owns rather than inventing a cross-cutting
// store for the single caller (loopback.ts) that needs it today.
//
// refreshMaestroAccessTokenIfNeeded at the bottom is this file's port of
// backend/apps/settings/maestro_scheduler.py's own refresh_maestro_access_token_if_needed -- the
// decision of WHETHER to refresh (belongs here: it composes refreshTokens() above with
// tokenStatus.ts's classification and credentialStore.ts's persistence) as opposed to the
// standalone background-loop scheduling shell around it (maestro_refresh_loop, which polls this
// decision function every 30 minutes forever) -- porting an engine-side interval loop is a
// separate wiring concern for whichever ticket owns the engine's long-running background tasks,
// not this one; this module only needs to give that future caller the same tested decision logic
// Python's loop calls on each tick.

import { createHash, randomBytes } from 'node:crypto';
import { engineFetch } from '../net/http';
import { loadRefreshToken, storeRefreshToken } from './credentialStore';
import type { AppSettings } from './models';
import { loadSettings, saveSettings } from './store';
import { maestroTokenStatus } from './tokenStatus';

export const MAESTRO_KEYCLOAK_ISSUER = 'https://martinstech.net/auth/realms/MartinsTech';
export const MAESTRO_KEYCLOAK_AUTHORIZE_URL = `${MAESTRO_KEYCLOAK_ISSUER}/protocol/openid-connect/auth`;
export const MAESTRO_KEYCLOAK_TOKEN_URL = `${MAESTRO_KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
// Fixed infrastructure, not a display name -- see maestro_keycloak_auth.py's identical comment:
// never renamed alongside the Maestro display-identity rename.
export const MAESTRO_KEYCLOAK_CLIENT_ID = 'provedor-ia-web';
// 127.0.0.1 (9Router's bundled Node subprocess already proxies any hit on this port's /callback to
// /api/subscriptions/callback when it's running -- see backend/apps/agents/9router_gpt5_patch.js;
// loopback.ts in this same directory owns the port directly, one-shot, when 9Router is not
// running). Electron's callback watcher (main.js) matches by port + path only, so a localhost vs
// 127.0.0.1 resolver quirk in the user's browser is already covered without a second constant here.
export const MAESTRO_KEYCLOAK_REDIRECT_URI = 'http://127.0.0.1:20128/callback';
export const MAESTRO_KEYCLOAK_SCOPE = 'openid offline_access';

/** A Keycloak token-endpoint call failed. Carries the HTTP status and the endpoint's own `error`
 * code only, never the response body, which on this endpoint can contain an echoed authorization
 * code or (for a slow-to-fail proxy) a token. */
export class MaestroKeycloakAuthError extends Error {
  constructor(public readonly statusCode: number, public readonly error: string) {
    super(`Keycloak token request failed: ${statusCode} ${error}`);
    this.name = 'MaestroKeycloakAuthError';
  }
}

/** A PKCE code_verifier per RFC 7636: url-safe, 43-128 chars. 64 random bytes, base64url-encoded,
 * lands at 86 -- the same length Python's secrets.token_urlsafe(64) produces. */
export function codeVerifier(): string {
  return randomBytes(64).toString('base64url');
}

/** S256 code_challenge: base64url(sha256(verifier)), unpadded (Node's 'base64url' digest encoding
 * never pads, matching Python's explicit rstrip("=")). */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export interface AuthorizeUrlResult {
  authorizeUrl: string;
  state: string;
  codeVerifier: string;
}

/** A fresh (authorizeUrl, state, codeVerifier) triple for one login attempt. Pure -- registers
 * nothing on its own; startMaestroLogin() below additionally remembers the pending entry so a
 * later callback can complete the exchange. */
export function buildAuthorizeUrl(): AuthorizeUrlResult {
  const state = randomBytes(24).toString('base64url');
  const verifier = codeVerifier();
  const challenge = codeChallenge(verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: MAESTRO_KEYCLOAK_CLIENT_ID,
    redirect_uri: MAESTRO_KEYCLOAK_REDIRECT_URI,
    scope: MAESTRO_KEYCLOAK_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { authorizeUrl: `${MAESTRO_KEYCLOAK_AUTHORIZE_URL}?${params.toString()}`, state, codeVerifier: verifier };
}

export interface MaestroTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  [key: string]: unknown;
}

/** The endpoint's own `error` code, never the raw body (which can carry secrets). */
function tokenErrorFrom(body: unknown): string {
  if (typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string') {
    return (body as Record<string, unknown>).error as string;
  }
  return 'unknown_error';
}

// Injectable HTTP dependency for the token endpoint, mirroring router/sync.ts's own
// `RouterHttpDeps.fetch: typeof fetch` seam (see net/http.ts's doc on why that pattern is the
// idiomatic TS equivalent of Python's `monkeypatch.setattr(mod.httpx, "AsyncClient", ...)`) --
// exposed so keycloakAuth.test.ts can assert the EXACT request body/URL/error handling the way
// backend/tests/test_maestro_keycloak_auth.py does against a fake httpx client, with zero real
// network I/O. Defaults to the real, allowlist-checked engineFetch for every production call site.
export interface KeycloakHttpDeps {
  fetch: typeof engineFetch;
}
const defaultKeycloakHttpDeps: KeycloakHttpDeps = { fetch: engineFetch };

async function postTokenEndpoint(data: Record<string, string>, deps: KeycloakHttpDeps): Promise<MaestroTokenResponse> {
  let response: Response;
  try {
    response = await deps.fetch(MAESTRO_KEYCLOAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    });
  } catch (e) {
    // Never let the underlying error (which can quote the request body/URL) escape as-is.
    console.warn(`[engine] Maestro Keycloak token request failed: ${e instanceof Error ? e.name : 'unknown_error'}`);
    throw new MaestroKeycloakAuthError(0, 'network_error');
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON error body -- tokenErrorFrom's null-body branch handles this below
    }
    const error = tokenErrorFrom(body);
    console.warn(`[engine] Maestro Keycloak token endpoint rejected the request: ${response.status} ${error}`);
    throw new MaestroKeycloakAuthError(response.status, error);
  }
  try {
    return (await response.json()) as MaestroTokenResponse;
  } catch {
    throw new MaestroKeycloakAuthError(response.status, 'invalid_response');
  }
}

/** Trade an authorization `code` for {access_token, refresh_token, expires_in, ...}.
 *
 * No client_secret: this is a public client, PKCE (`codeVerifier`) is what authenticates the
 * request instead. */
export async function exchangeCodeForTokens(code: string, verifier: string, redirectUri: string, deps: KeycloakHttpDeps = defaultKeycloakHttpDeps): Promise<MaestroTokenResponse> {
  return postTokenEndpoint({
    grant_type: 'authorization_code',
    client_id: MAESTRO_KEYCLOAK_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }, deps);
}

/** Trade a refresh_token for a fresh token pair.
 *
 * Keycloak may rotate the refresh token on every use: the caller MUST persist whatever
 * `refresh_token` comes back in the response, not just the access token, or the next refresh will
 * replay a stale one and fail. */
export async function refreshTokens(refreshToken: string, deps: KeycloakHttpDeps = defaultKeycloakHttpDeps): Promise<MaestroTokenResponse> {
  return postTokenEndpoint({
    grant_type: 'refresh_token',
    client_id: MAESTRO_KEYCLOAK_CLIENT_ID,
    refresh_token: refreshToken,
  }, deps);
}

// --- Pending-login correlation (this module's own narrow port of the "maestro" slice of
// backend/apps/oauth_state.py's pending_oauth) ---

export interface PendingMaestroLogin {
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const pendingMaestroLogins = new Map<string, PendingMaestroLogin>();

/** Mint a fresh authorize URL AND remember its (state -> codeVerifier) pending entry, so a later
 * callback (loopback.ts's own listener, when 9Router is down) can complete the exchange. Mirrors
 * backend/apps/settings/settings.py's post_maestro_login_start, minus the HTTP route itself (no
 * engine-side port of that route yet -- a later ticket's job). `redirectUri` defaults to the one
 * registered with Keycloak; a caller only overrides it in a test. */
export function startMaestroLogin(redirectUri: string = MAESTRO_KEYCLOAK_REDIRECT_URI): { authorizeUrl: string; state: string } {
  const { authorizeUrl, state, codeVerifier: verifier } = buildAuthorizeUrl();
  pendingMaestroLogins.set(state, { codeVerifier: verifier, redirectUri, createdAt: Date.now() });
  return { authorizeUrl, state };
}

/** Pop (consume) a pending login by state. undefined for an unknown/already-consumed state -- a
 * stale callback, a duplicate hit, or a login this process never started (e.g. it was started
 * against 9Router's own /api/subscriptions/callback path instead, whose pending state lives in the
 * Python backend's separate in-memory map, not here). */
export function takePendingMaestroLogin(state: string): PendingMaestroLogin | undefined {
  const pending = pendingMaestroLogins.get(state);
  if (pending) pendingMaestroLogins.delete(state);
  return pending;
}

/** Test-only: clears every pending login so tests never leak state across runs. Not used by any
 * runtime path. */
export function resetPendingMaestroLoginsForTests(): void {
  pendingMaestroLogins.clear();
}

export type MaestroCallbackOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'error' | 'unknown_state' | 'exchange_failed' | 'no_access_token'; detail?: string };

export interface CompleteCallbackDeps {
  exchangeCodeForTokens: (code: string, verifier: string, redirectUri: string) => Promise<MaestroTokenResponse>;
  storeRefreshToken: (token: string) => void;
  /** Mirrors backend/main.py's subscriptions_callback maestro branch: on a successful exchange,
   * the ACCESS token is also written into settings (provedor_ia_token) -- via a targeted
   * single-field patch, exactly like Python's own `apply_settings_patch({PROVEDOR_IA_TOKEN_FIELD:
   * access_token})` -- not just the refresh token into the credential store. Without this, a
   * freshly-signed-in session would have a refresh token stored but nothing usable to actually send
   * on the very next request, until some later background refresh happens to run. docs/MAESTRO.md's
   * claim that "the access token is not persisted" does NOT match this real behavior -- see this
   * ticket's own notes on that doc/code disagreement. Deliberately does NOT replicate Python's
   * refresh_catalog() call alongside it: that's maestro_catalog.py's job, a separate module outside
   * this ticket's three-file scope. */
  persistAccessToken: (accessToken: string) => void;
}
function defaultPersistAccessToken(accessToken: string): void {
  const { settings } = loadSettings();
  settings.provedor_ia_token = accessToken;
  saveSettings(settings);
}
const defaultCompleteCallbackDeps: CompleteCallbackDeps = {
  exchangeCodeForTokens,
  storeRefreshToken,
  persistAccessToken: defaultPersistAccessToken,
};

/** The callback handler's actual decision logic, shared by loopback.ts's local listener: look up
 * the pending state, exchange the code, persist both the refresh token (ENG-4's credential store)
 * and the access token (settings.provedor_ia_token), and report the outcome. Never throws -- every
 * failure mode maps to a MaestroCallbackOutcome so the HTTP layer serving loopback.ts's listener
 * can always render a response instead of crashing on an unhandled rejection. */
export async function completeMaestroLoginCallback(
  params: { code?: string; state?: string; error?: string },
  deps: CompleteCallbackDeps = defaultCompleteCallbackDeps,
): Promise<MaestroCallbackOutcome> {
  if (params.error) {
    return { ok: false, reason: 'error', detail: params.error };
  }
  const state = params.state ?? '';
  const pending = state ? takePendingMaestroLogin(state) : undefined;
  if (!pending) {
    return { ok: false, reason: 'unknown_state' };
  }
  let tokens: MaestroTokenResponse;
  try {
    tokens = await deps.exchangeCodeForTokens(params.code ?? '', pending.codeVerifier, pending.redirectUri);
  } catch (e) {
    const detail = e instanceof MaestroKeycloakAuthError ? e.error : 'unknown_error';
    return { ok: false, reason: 'exchange_failed', detail };
  }
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    return { ok: false, reason: 'no_access_token' };
  }
  // Keycloak may rotate the refresh token on every use; persisting only the access token would
  // silently strand the rotated one and break the NEXT refresh (see refreshTokens's own doc).
  if (typeof tokens.refresh_token === 'string' && tokens.refresh_token) {
    deps.storeRefreshToken(tokens.refresh_token);
  }
  deps.persistAccessToken(accessToken);
  return { ok: true, accessToken };
}

// --- Background refresh decision (port of maestro_scheduler.py's own decision function) ---

// Frequent enough that a token nearing its ~12h death is always caught well before it dies;
// cheap enough (one HTTP round-trip, only when there's a stored refresh token) to run in the
// background forever -- see this constant's Python twin in maestro_scheduler.py for the full
// cadence reasoning. Exported for whichever ticket wires an actual setInterval/background loop
// around this decision function; not used by this module itself.
export const MAESTRO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const MAESTRO_REFRESH_STATES: ReadonlySet<string> = new Set(['missing', 'expired', 'expiring']);

export interface MaestroRefreshDeps {
  loadRefreshToken: () => string | null;
  storeRefreshToken: (token: string) => void;
  refreshTokens: (refreshToken: string) => Promise<MaestroTokenResponse>;
}
const defaultMaestroRefreshDeps: MaestroRefreshDeps = { loadRefreshToken, storeRefreshToken, refreshTokens };

/** Mutates `settings.provedor_ia_token` in place with a fresh access token when one is needed and
 * available. Returns true when it changed anything (caller must persist), else false. Never
 * throws: every failure mode (no refresh token, Keycloak rejected it, network down) leaves
 * `settings` untouched -- mirrors backend/apps/settings/maestro_scheduler.py's
 * refresh_maestro_access_token_if_needed exactly, including that a `valid` token (plenty of
 * runway) is left alone without even loading the stored refresh token. */
export async function refreshMaestroAccessTokenIfNeeded(
  settings: AppSettings,
  now: number = Date.now(),
  deps: MaestroRefreshDeps = defaultMaestroRefreshDeps,
): Promise<boolean> {
  const status = maestroTokenStatus(settings, process.env, now);
  if (!MAESTRO_REFRESH_STATES.has(status.state)) return false;
  const refreshToken = deps.loadRefreshToken();
  if (!refreshToken) return false;
  let tokens: MaestroTokenResponse;
  try {
    tokens = await deps.refreshTokens(refreshToken);
  } catch {
    return false;
  }
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string' || !accessToken) return false;
  // Keycloak may rotate the refresh token on every use; persisting only the access token would
  // silently strand the rotated one and break the NEXT refresh.
  if (typeof tokens.refresh_token === 'string' && tokens.refresh_token) {
    deps.storeRefreshToken(tokens.refresh_token);
  }
  settings.provedor_ia_token = accessToken;
  return true;
}
