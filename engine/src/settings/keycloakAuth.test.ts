// engine/src/settings/keycloakAuth.test.ts -- ENG-5 gate: TS vitest port of
// backend/tests/test_maestro_keycloak_auth.py's assertions (PKCE shape, exact exchange/refresh
// request bodies, error redaction) plus backend/tests/test_maestro_scheduler.py's assertions
// against refreshMaestroAccessTokenIfNeeded. No live Keycloak call is ever made here: every
// KeycloakHttpDeps.fetch is a fake. This tests the CONTRACT, never the network -- the real network
// path is proven separately by loopback.integration-check.ts (this ticket's GATE (b)).

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type AppSettings } from './models';
import {
  MAESTRO_KEYCLOAK_CLIENT_ID,
  MAESTRO_KEYCLOAK_REDIRECT_URI,
  MAESTRO_KEYCLOAK_SCOPE,
  MAESTRO_KEYCLOAK_TOKEN_URL,
  MaestroKeycloakAuthError,
  buildAuthorizeUrl,
  completeMaestroLoginCallback,
  exchangeCodeForTokens,
  refreshMaestroAccessTokenIfNeeded,
  refreshTokens,
  resetPendingMaestroLoginsForTests,
  startMaestroLogin,
  takePendingMaestroLogin,
  type KeycloakHttpDeps,
  type MaestroTokenResponse,
} from './keycloakAuth';

beforeEach(() => {
  resetPendingMaestroLoginsForTests();
});
afterEach(() => {
  resetPendingMaestroLoginsForTests();
});

// --------------------------------------------------------------------------- buildAuthorizeUrl

describe('buildAuthorizeUrl', () => {
  it('carries the exact verified params', () => {
    const { authorizeUrl } = buildAuthorizeUrl();
    const qs = new URL(authorizeUrl).searchParams;
    expect(qs.get('response_type')).toBe('code');
    expect(qs.get('client_id')).toBe(MAESTRO_KEYCLOAK_CLIENT_ID);
    expect(MAESTRO_KEYCLOAK_CLIENT_ID).toBe('provedor-ia-web');
    expect(qs.get('redirect_uri')).toBe(MAESTRO_KEYCLOAK_REDIRECT_URI);
    expect(MAESTRO_KEYCLOAK_REDIRECT_URI).toBe('http://127.0.0.1:20128/callback');
    expect(qs.get('scope')).toBe(MAESTRO_KEYCLOAK_SCOPE);
    expect(MAESTRO_KEYCLOAK_SCOPE).toBe('openid offline_access');
    expect(qs.get('code_challenge_method')).toBe('S256');
    expect(qs.has('client_secret')).toBe(false);
  });

  it('the code_challenge matches S256 of the verifier', () => {
    const { authorizeUrl, codeVerifier } = buildAuthorizeUrl();
    const qs = new URL(authorizeUrl).searchParams;
    const expected = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
    expect(qs.get('code_challenge')).toBe(expected);
  });

  it('the code_verifier is RFC 7636 shaped: 43-128 chars, url-safe', () => {
    for (let i = 0; i < 5; i++) {
      const { codeVerifier } = buildAuthorizeUrl();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
      expect(/^[A-Za-z0-9_-]+$/.test(codeVerifier)).toBe(true);
    }
  });

  it('every call mints a fresh state and verifier', () => {
    const a = buildAuthorizeUrl();
    const b = buildAuthorizeUrl();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

// --------------------------------------------------------------------------- fake HTTP deps

class FakeResponse {
  constructor(public status: number, private payload: Record<string, unknown> = {}) {}
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  async json(): Promise<unknown> {
    return this.payload;
  }
}

function fakeDeps(response: FakeResponse): { deps: KeycloakHttpDeps; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response as unknown as Response;
  }) as KeycloakHttpDeps['fetch'];
  return { deps: { fetch: fetchFn }, calls };
}

function bodyOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(init.body as string));
}

// --------------------------------------------------------------------------- exchangeCodeForTokens

describe('exchangeCodeForTokens', () => {
  it('posts the documented body with no secret', async () => {
    const { deps, calls } = fakeDeps(new FakeResponse(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 43200 }));
    const result = await exchangeCodeForTokens('auth-code', 'verifier-x', 'http://127.0.0.1:20128/callback', deps);
    expect(result).toEqual({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 43200 });
    expect(calls[0].url).toBe(MAESTRO_KEYCLOAK_TOKEN_URL);
    const body = bodyOf(calls[0].init);
    expect(body).toEqual({
      grant_type: 'authorization_code',
      client_id: MAESTRO_KEYCLOAK_CLIENT_ID,
      code: 'auth-code',
      redirect_uri: 'http://127.0.0.1:20128/callback',
      code_verifier: 'verifier-x',
    });
    expect(body.client_secret).toBeUndefined();
  });

  it('raises a specific error on rejection and never echoes the code', async () => {
    const { deps } = fakeDeps(new FakeResponse(400, { error: 'invalid_grant', error_description: 'auth-code-xyz consumed' }));
    let caught: unknown;
    try {
      await exchangeCodeForTokens('auth-code-xyz', 'verifier', 'http://127.0.0.1:20128/callback', deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MaestroKeycloakAuthError);
    const err = caught as MaestroKeycloakAuthError;
    expect(err.statusCode).toBe(400);
    expect(err.error).toBe('invalid_grant');
    expect(String(err)).not.toContain('auth-code-xyz');
  });

  it('a network failure raises without leaking the underlying message', async () => {
    const deps: KeycloakHttpDeps = {
      fetch: (async () => {
        throw new Error('dial tcp 10.0.0.1:443: super-secret-detail');
      }) as KeycloakHttpDeps['fetch'],
    };
    let caught: unknown;
    try {
      await exchangeCodeForTokens('code', 'verifier', 'http://127.0.0.1:20128/callback', deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MaestroKeycloakAuthError);
    expect((caught as MaestroKeycloakAuthError).error).toBe('network_error');
    expect(String(caught)).not.toContain('super-secret-detail');
  });
});

// --------------------------------------------------------------------------- refreshTokens

describe('refreshTokens', () => {
  it('posts the documented body with no secret', async () => {
    const { deps, calls } = fakeDeps(new FakeResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 43200 }));
    const result = await refreshTokens('rt-1', deps);
    expect(result.access_token).toBe('at-2');
    // Keycloak may rotate the refresh token; the caller must see the NEW one to persist it.
    expect(result.refresh_token).toBe('rt-2');
    const body = bodyOf(calls[0].init);
    expect(body).toEqual({ grant_type: 'refresh_token', client_id: MAESTRO_KEYCLOAK_CLIENT_ID, refresh_token: 'rt-1' });
    expect(body.client_secret).toBeUndefined();
  });

  it('raises on a revoked token', async () => {
    const { deps } = fakeDeps(new FakeResponse(400, { error: 'invalid_grant' }));
    let caught: unknown;
    try {
      await refreshTokens('dead-refresh-token', deps);
    } catch (e) {
      caught = e;
    }
    expect((caught as MaestroKeycloakAuthError).error).toBe('invalid_grant');
    expect(String(caught)).not.toContain('dead-refresh-token');
  });
});

// --------------------------------------------------------------------------- pending-login correlation

describe('startMaestroLogin / takePendingMaestroLogin', () => {
  it('registers a pending entry a later callback can consume exactly once', () => {
    const { state } = startMaestroLogin();
    const first = takePendingMaestroLogin(state);
    expect(first).toBeDefined();
    expect(first?.redirectUri).toBe(MAESTRO_KEYCLOAK_REDIRECT_URI);
    expect(takePendingMaestroLogin(state)).toBeUndefined();
  });

  it('an unknown state returns undefined', () => {
    expect(takePendingMaestroLogin('never-registered')).toBeUndefined();
  });
});

// --------------------------------------------------------------------------- completeMaestroLoginCallback

describe('completeMaestroLoginCallback', () => {
  it('surfaces the provider error verbatim without touching pending state', async () => {
    const outcome = await completeMaestroLoginCallback({ error: 'access_denied' });
    expect(outcome).toEqual({ ok: false, reason: 'error', detail: 'access_denied' });
  });

  it('an unknown/stale state is reported, never crashes', async () => {
    const outcome = await completeMaestroLoginCallback({ code: 'x', state: 'stale' });
    expect(outcome).toEqual({ ok: false, reason: 'unknown_state' });
  });

  it('a successful exchange persists the refresh token AND the access token, and reports the access token', async () => {
    const { state } = startMaestroLogin();
    const stored: string[] = [];
    const persisted: string[] = [];
    const outcome = await completeMaestroLoginCallback(
      { code: 'real-code', state },
      {
        exchangeCodeForTokens: async () => ({ access_token: 'at-1', refresh_token: 'rt-1' } as MaestroTokenResponse),
        storeRefreshToken: (t) => stored.push(t),
        persistAccessToken: (t) => persisted.push(t),
      },
    );
    expect(outcome).toEqual({ ok: true, accessToken: 'at-1' });
    expect(stored).toEqual(['rt-1']);
    expect(persisted).toEqual(['at-1']);
  });

  it('a failed exchange reports exchange_failed and never throws, and never persists anything', async () => {
    const { state } = startMaestroLogin();
    const persistAccessToken = vi.fn();
    const outcome = await completeMaestroLoginCallback(
      { code: 'fake', state },
      {
        exchangeCodeForTokens: async () => {
          throw new MaestroKeycloakAuthError(400, 'invalid_grant');
        },
        storeRefreshToken: vi.fn(),
        persistAccessToken,
      },
    );
    expect(outcome).toEqual({ ok: false, reason: 'exchange_failed', detail: 'invalid_grant' });
    expect(persistAccessToken).not.toHaveBeenCalled();
  });

  it('a response with no access_token reports no_access_token and never persists anything', async () => {
    const { state } = startMaestroLogin();
    const persistAccessToken = vi.fn();
    const outcome = await completeMaestroLoginCallback(
      { code: 'x', state },
      { exchangeCodeForTokens: async () => ({}) as MaestroTokenResponse, storeRefreshToken: vi.fn(), persistAccessToken },
    );
    expect(outcome).toEqual({ ok: false, reason: 'no_access_token' });
    expect(persistAccessToken).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------- refreshMaestroAccessTokenIfNeeded

function jwt(exp: number): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64('{"alg":"RS256","typ":"JWT"}')}.${b64(JSON.stringify({ exp }))}.sig`;
}

function settingsWithToken(token: string | null): AppSettings {
  return { ...defaultAppSettings(), provedor_ia_token: token };
}

describe('refreshMaestroAccessTokenIfNeeded', () => {
  it('a valid token with plenty of runway is left alone', async () => {
    const live = jwt(Math.trunc(Date.now() / 1000) + 10 * 3600);
    const settings = settingsWithToken(live);
    const refreshTokensSpy = vi.fn(async () => {
      throw new Error('refreshTokens must not be called for a valid token');
    });
    const changed = await refreshMaestroAccessTokenIfNeeded(settings, Date.now(), {
      loadRefreshToken: () => 'unused',
      storeRefreshToken: vi.fn(),
      refreshTokens: refreshTokensSpy,
    });
    expect(changed).toBe(false);
    expect(settings.provedor_ia_token).toBe(live);
    expect(refreshTokensSpy).not.toHaveBeenCalled();
  });

  it('an expiring token with a stored refresh token is silently refreshed', async () => {
    const expiring = jwt(Math.trunc(Date.now() / 1000) + 10 * 60);
    const settings = settingsWithToken(expiring);
    const freshAccess = jwt(Math.trunc(Date.now() / 1000) + 12 * 3600);
    const stored: Record<string, string> = {};
    const changed = await refreshMaestroAccessTokenIfNeeded(settings, Date.now(), {
      loadRefreshToken: () => 'rt-old',
      storeRefreshToken: (t) => { stored.rt = t; },
      refreshTokens: async (rt) => {
        expect(rt).toBe('rt-old');
        return { access_token: freshAccess, refresh_token: 'rt-new', expires_in: 43200 };
      },
    });
    expect(changed).toBe(true);
    expect(settings.provedor_ia_token).toBe(freshAccess);
    expect(stored.rt).toBe('rt-new');
  });

  it('no stored refresh token means no refresh attempt', async () => {
    const expired = jwt(Math.trunc(Date.now() / 1000) - 3600);
    const settings = settingsWithToken(expired);
    const refreshTokensSpy = vi.fn(async () => {
      throw new Error('refreshTokens must not be called with no stored refresh token');
    });
    const changed = await refreshMaestroAccessTokenIfNeeded(settings, Date.now(), {
      loadRefreshToken: () => null,
      storeRefreshToken: vi.fn(),
      refreshTokens: refreshTokensSpy,
    });
    expect(changed).toBe(false);
    expect(settings.provedor_ia_token).toBe(expired);
    expect(refreshTokensSpy).not.toHaveBeenCalled();
  });

  it('a revoked refresh token leaves settings untouched so the sign-in prompt fires', async () => {
    const expired = jwt(Math.trunc(Date.now() / 1000) - 3600);
    const settings = settingsWithToken(expired);
    const changed = await refreshMaestroAccessTokenIfNeeded(settings, Date.now(), {
      loadRefreshToken: () => 'rt-dead',
      storeRefreshToken: vi.fn(),
      refreshTokens: async () => {
        throw new MaestroKeycloakAuthError(400, 'invalid_grant');
      },
    });
    expect(changed).toBe(false);
    expect(settings.provedor_ia_token).toBe(expired);
  });

  it('a missing token with a stored refresh token still refreshes', async () => {
    const settings = settingsWithToken(null);
    const freshAccess = jwt(Math.trunc(Date.now() / 1000) + 12 * 3600);
    const changed = await refreshMaestroAccessTokenIfNeeded(settings, Date.now(), {
      loadRefreshToken: () => 'rt-old',
      storeRefreshToken: vi.fn(),
      refreshTokens: async () => ({ access_token: freshAccess, refresh_token: 'rt-new' }),
    });
    expect(changed).toBe(true);
    expect(settings.provedor_ia_token).toBe(freshAccess);
  });
});
