// engine/src/settings/tokenStatus.test.ts -- ENG-5 gate: TS vitest port of
// backend/tests/test_maestro_token_status.py's assertions against the ported tokenStatus()/
// needsLogin(). Every token here is synthesized locally with an unsigned header and a payload we
// choose; nothing is minted, nothing is sent anywhere, and no real bearer appears.

import { describe, expect, it } from 'vitest';
import { defaultAppSettings, type AppSettings } from './models';
import {
  EXPIRY_WARNING_MINUTES,
  maestroTokenStatus,
  needsLogin,
  provedorIaToken,
  tokenLooksLikeJwt,
  tokenStatus,
  unverifiedJwtExp,
} from './tokenStatus';

const P_NOW_MS = 1_800_000_000_000; // matches backend's P_NOW (seconds) * 1000

function b64(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function jwtToken(claims: Record<string, unknown>): string {
  return `${b64('{"alg":"RS256","typ":"JWT"}')}.${b64(JSON.stringify(claims))}.not-a-signature`;
}

describe('tokenStatus: detection', () => {
  it.each([undefined, null, '', '   ', '\n\t '])('no token reads missing (%p)', (token) => {
    const status = tokenStatus(token as never, P_NOW_MS);
    expect(status.state).toBe('missing');
    expect(status.expires_at).toBeNull();
    expect(status.expires_in_minutes).toBeNull();
    expect(needsLogin(status)).toBe(true);
  });

  it('expired token reads expired', () => {
    const exp = Math.trunc(P_NOW_MS / 1000) - 60;
    const status = tokenStatus(jwtToken({ exp }), P_NOW_MS);
    expect(status.state).toBe('expired');
    expect(status.expires_at).toBe(exp);
    expect(status.expires_in_minutes).toBe(0);
    expect(needsLogin(status)).toBe(true);
  });

  it('exactly at expiry reads expired -- the boundary belongs to expired', () => {
    const exp = Math.trunc(P_NOW_MS / 1000);
    expect(tokenStatus(jwtToken({ exp }), P_NOW_MS).state).toBe('expired');
  });

  it('fresh token reads valid with its runway (~10h)', () => {
    const exp = Math.trunc(P_NOW_MS / 1000) + 10 * 3600;
    const status = tokenStatus(jwtToken({ exp }), P_NOW_MS);
    expect(status.state).toBe('valid');
    expect(status.expires_in_minutes).toBe(600);
    expect(needsLogin(status)).toBe(false);
  });

  it('token inside the warning window reads expiring, not blocked', () => {
    const exp = Math.trunc(P_NOW_MS / 1000) + 10 * 60;
    const status = tokenStatus(jwtToken({ exp }), P_NOW_MS);
    expect(status.state).toBe('expiring');
    expect(status.expires_in_minutes).toBe(10);
    expect(needsLogin(status)).toBe(false);
  });

  it('the warning-window boundary is the documented one', () => {
    const below = tokenStatus(jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + EXPIRY_WARNING_MINUTES * 60 - 60 }), P_NOW_MS);
    const at = tokenStatus(jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + EXPIRY_WARNING_MINUTES * 60 }), P_NOW_MS);
    expect(below.state).toBe('expiring');
    expect(at.state).toBe('valid');
  });

  it.each([
    'mtok_a_static_api_key', // a legitimate non-JWT provedor-ia credential
    'only.two', // too few segments
    'a.b.c.d', // too many segments
    'aaa.!!!not-base64!!!.sig', // payload isn't valid base64url content
    `aaa.${b64('not json at all')}.sig`, // payload isn't JSON
    `aaa.${b64('[1,2,3]')}.sig`, // payload is JSON but not an object
    `aaa.${b64('{}')}.sig`, // object with no exp claim
    `aaa.${b64('{"exp":"soon"}')}.sig`, // exp is a string
    `aaa.${b64('{"exp":true}')}.sig`, // exp is a bool
  ])('undecodable tokens read opaque and are never treated as dead (%s)', (token) => {
    const status = tokenStatus(token, P_NOW_MS);
    expect(status.state).toBe('opaque');
    expect(needsLogin(status)).toBe(false);
  });

  it('a float exp is truncated, never rounded up into a dead token', () => {
    const exp = P_NOW_MS / 1000 + 3600.7;
    const status = tokenStatus(jwtToken({ exp }), P_NOW_MS);
    expect(status.state).toBe('valid');
    expect(status.expires_at).toBe(Math.trunc(exp));
  });
});

describe('unverifiedJwtExp / tokenLooksLikeJwt', () => {
  it('a static opaque key never looks like a JWT', () => {
    expect(tokenLooksLikeJwt('mtok_abcdef123456')).toBe(false);
    expect(unverifiedJwtExp('mtok_abcdef123456')).toBeNull();
  });

  it('a real JWT (even an expired one) looks like a JWT', () => {
    expect(tokenLooksLikeJwt(jwtToken({ exp: 1 }))).toBe(true);
  });
});

describe('provedorIaToken / maestroTokenStatus', () => {
  function settingsWith(token: string | null): AppSettings {
    return { ...defaultAppSettings(), provedor_ia_token: token };
  }

  it('prefers the settings field over the env var', () => {
    const settings = settingsWith('mtok_from_settings');
    expect(provedorIaToken(settings, { PROVEDOR_IA_TOKEN: 'mtok_from_env' })).toBe('mtok_from_settings');
  });

  it('falls back to the env var when the settings field is empty', () => {
    const settings = settingsWith(null);
    expect(provedorIaToken(settings, { PROVEDOR_IA_TOKEN: 'mtok_from_env' })).toBe('mtok_from_env');
  });

  it('refuses a JWT arriving only via the env var -- the old vendor-installer contract', () => {
    const settings = settingsWith(null);
    const envJwt = jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + 3600 });
    expect(provedorIaToken(settings, { PROVEDOR_IA_TOKEN: envJwt })).toBeNull();
  });

  it('a JWT from the env var is refused, not honored, whether live or already expired -- reads missing, never valid/expired', () => {
    const settings = settingsWith(null);
    const liveJwt = jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + 10 * 3600 });
    expect(maestroTokenStatus(settings, { PROVEDOR_IA_TOKEN: liveJwt }, P_NOW_MS).state).toBe('missing');
    const deadJwt = jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) - 60 });
    expect(maestroTokenStatus(settings, { PROVEDOR_IA_TOKEN: deadJwt }, P_NOW_MS).state).toBe('missing');
  });

  it('falls back to an opaque env var -- a static key is a still-supported credential type', () => {
    const settings = settingsWith(null);
    expect(maestroTokenStatus(settings, { PROVEDOR_IA_TOKEN: 'mtok_a_static_api_key_0000' }, P_NOW_MS).state).toBe('opaque');
  });

  it('returns null when neither source has anything', () => {
    expect(provedorIaToken(settingsWith(null), {})).toBeNull();
  });

  it('status with no token anywhere is missing', () => {
    expect(maestroTokenStatus(settingsWith(null), {}, P_NOW_MS).state).toBe('missing');
  });

  it('maestroTokenStatus reads through to the resolved token', () => {
    const settings = settingsWith(jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + 3600 }));
    const status = maestroTokenStatus(settings, {}, P_NOW_MS);
    expect(status.state).toBe('valid');
  });

  it('the status object carries only state + runway, never any fragment of the token', () => {
    const token = jwtToken({ exp: Math.trunc(P_NOW_MS / 1000) + 3600, sub: 'someone', preferred_username: 'someone' });
    const settings = settingsWith(token);
    const status = maestroTokenStatus(settings, {}, P_NOW_MS);
    expect(Object.keys(status).sort()).toEqual(['expires_at', 'expires_in_minutes', 'state']);
    const dumped = JSON.stringify(status);
    for (const fragment of token.split('.')) {
      expect(dumped).not.toContain(fragment);
    }
  });
});
