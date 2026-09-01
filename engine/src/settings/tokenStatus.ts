// engine/src/settings/tokenStatus.ts -- ENG-5, a faithful TypeScript port of
// backend/apps/settings/maestro_token_status.py: answer one question locally -- should the app ask
// the user to sign in to Maestro again?
//
// A Maestro access token is a Keycloak access token with a ~12h lifetime. As long as the Keycloak
// Authorization Code + PKCE flow (keycloakAuth.ts) has run once and the resulting refresh token
// (credentialStore.ts, ENG-4) is still within its ~30 day idle timeout, a background refresh keeps
// the access token alive silently well before it expires, so this state machine should read
// valid/expiring almost always. It only reads missing/expired when there is no usable refresh
// token either, at which point the app must trigger a fresh browser sign-in.
//
// The `exp` claim is read WITHOUT signature verification, on purpose. This is a UI decision, never
// an authorization one: only the gateway may decide whether a token is good. A credential that is
// not a JWT (a static API key, `mtok_...`) reads as `opaque` and is NEVER treated as dead, because
// blocking on an undecodable string would lock out a valid setup -- this distinction is load-
// bearing: earlier migration phases' e2e fixtures depend on `opaque` existing as its own state,
// never folded into `missing`/`expired`. No part of the token is ever returned, logged, or put in
// an error message.
//
// Field names on MaestroTokenStatus (`state`/`expires_at`/`expires_in_minutes`) are kept snake_case
// deliberately -- this is a direct value object mirroring the Python pydantic model's own JSON wire
// shape (see backend/apps/settings/settings.py's GET /maestro/token-status, and the already-existing
// frontend consumer at frontend/src/shared/state/maestroSlice.ts's MaestroTokenStatus interface,
// which reads exactly these keys), not an internal TS-only type free to use camelCase.

import type { AppSettings } from './models';

// Under this much runway the UI shows a quiet "your session is ending" notice instead of waiting
// for the turn to die.
export const EXPIRY_WARNING_MINUTES = 30;

export type MaestroTokenState = 'missing' | 'expired' | 'expiring' | 'valid' | 'opaque';

// The two states that mean "cannot work"; `opaque` is deliberately absent -- see module doc.
export const DEAD_STATES: readonly MaestroTokenState[] = ['missing', 'expired'];

export interface MaestroTokenStatus {
  state: MaestroTokenState;
  expires_at: number | null;
  expires_in_minutes: number | null;
}

// backend/apps/settings/maestro.py's env-var constant, inlined -- same "leaf module, no upward
// dependency" discipline models.ts already documents for itself.
const PROVEDOR_IA_TOKEN_ENV = 'PROVEDOR_IA_TOKEN';

/** The `exp` claim of an unverified JWT payload, truncated to an int exactly like Python's
 * `int(exp)` (mirrors p_unverified_jwt_exp's own return value, not left as a float for the caller
 * to truncate later) -- null when `token` is not a JWT. */
export function unverifiedJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let claims: unknown;
  try {
    // JWT is base64url with the padding stripped; Buffer.from(..., 'base64url') already tolerates
    // missing padding (unlike 'base64'), so no manual pad-restoration is needed the way Python's
    // urlsafe_b64decode requires it back.
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
  const exp = (claims as Record<string, unknown>).exp;
  // typeof true !== 'number' in JS (unlike Python, where bool is an int subclass and needs an
  // explicit exclusion -- see maestro_token_status.py's own comment on that footgun), so a bool
  // `exp` claim is already excluded here with no separate check needed.
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return Math.trunc(exp);
}

/** True when `token` decodes as a JWT (whether or not it's still live).
 *
 * Used to tell a hand-pasted Keycloak access token, the credential type this whole flow replaced,
 * apart from a static opaque key (`mtok_...`), which is a distinct, still-supported credential and
 * must never be treated as one of these. */
export function tokenLooksLikeJwt(token: string): boolean {
  return unverifiedJwtExp(token) !== null;
}

/** Classify a raw token string. `now` (ms epoch, injectable) defaults to Date.now() so callers
 * never depend on the wall clock in tests. */
export function tokenStatus(token: string | null | undefined, now: number = Date.now()): MaestroTokenStatus {
  const cleaned = (token ?? '').trim();
  if (!cleaned) return { state: 'missing', expires_at: null, expires_in_minutes: null };
  const exp = unverifiedJwtExp(cleaned);
  if (exp === null) return { state: 'opaque', expires_at: null, expires_in_minutes: null };
  const secondsLeft = exp - now / 1000;
  if (secondsLeft <= 0) return { state: 'expired', expires_at: exp, expires_in_minutes: 0 };
  const minutesLeft = Math.floor(secondsLeft / 60);
  const state: MaestroTokenState = minutesLeft < EXPIRY_WARNING_MINUTES ? 'expiring' : 'valid';
  return { state, expires_at: exp, expires_in_minutes: minutesLeft };
}

/** The Maestro bearer the app would actually send: the settings field first, then
 * PROVEDOR_IA_TOKEN -- mirrors apply_maestro_defaults.provedor_ia_token exactly, including its
 * refusal to treat an env-sourced JWT as usable. A JWT arriving via the settings field is handled
 * by a one-time upgrade migration elsewhere that clears it outright; the env var can't be migrated
 * the same way (it isn't ours to edit), so a JWT read from it here is refused on every call: it is
 * the old vendor-installer contract, a hand-minted, non-refreshable Keycloak access token, and
 * honoring it would silently resurrect the exact broken 10h-then-dead session this flow replaced. A
 * static opaque key (`mtok_...`) from either source is a distinct credential and passes through
 * unchanged. */
export function provedorIaToken(settings: AppSettings, env: NodeJS.ProcessEnv = process.env): string | null {
  const stored = (settings.provedor_ia_token ?? '').trim();
  if (stored) return stored;
  const envValue = (env[PROVEDOR_IA_TOKEN_ENV] ?? '').trim();
  if (!envValue) return null;
  if (tokenLooksLikeJwt(envValue)) return null;
  return envValue;
}

/** Status of the token the app would actually send: the settings field, else PROVEDOR_IA_TOKEN. */
export function maestroTokenStatus(settings: AppSettings, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): MaestroTokenStatus {
  return tokenStatus(provedorIaToken(settings, env), now);
}

/** True when there is nothing usable to send, so the sign-in prompt must block the first turn. */
export function needsLogin(status: MaestroTokenStatus): boolean {
  return DEAD_STATES.includes(status.state);
}
