// engine/src/auth/middleware.test.ts -- unit coverage for the exemption list, credential
// matching, and origin allowlist, ported from the assertions backend/auth.py's own request-
// matching/exemption helpers imply (there is no dedicated backend/tests/test_auth.py -- auth is
// mocked out in backend's WS integration tests instead, see test_ws_integration.py). The
// end-to-end 401/1006 assertions against a running engine live in server.test.ts's "auth" describe.

import { describe, expect, test } from 'vitest';
import {
  extractBearer,
  isOriginAllowed,
  isPathExempt,
  requestMatchesToken,
  wsRequestAuthOk,
} from './middleware';

const P_TOKEN = 'the-real-token-0123456789abcdef';

describe('isPathExempt', () => {
  test.each([
    '/api/subscriptions/callback',
    '/api/tools/oauth/callback',
    '/api/tools/oauth/cloud-claim',
    '/api/version',
    '/api/tools/google-oauth-token',
    '/api/dev/token',
  ])('%s is exempt (exact match)', (path) => {
    expect(isPathExempt(path)).toBe(true);
  });

  test.each([
    ['/api/health', true],
    ['/api/health/check', true],
    ['/api/openai-passthrough/v1/chat/completions', true],
    ['/docs', true],
    ['/openapi.json', true],
    ['/redoc', true],
    ['/favicon.ico', true],
    ['/api/settings', false],
    ['/api/agents/launch', false],
    ['/api/anthropic-proxy/v1/messages', false],
    ['/ws/agents/abc-123', false],
  ])('%s exempt=%s (prefix match)', (path, expected) => {
    expect(isPathExempt(path)).toBe(expected);
  });
});

describe('extractBearer', () => {
  test('pulls the token out of "Bearer <token>"', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
  });

  test('accepts a lowercase "bearer" scheme too', () => {
    expect(extractBearer('bearer abc123')).toBe('abc123');
  });

  test('returns empty for a missing or malformed header', () => {
    expect(extractBearer(undefined)).toBe('');
    expect(extractBearer(null)).toBe('');
    expect(extractBearer('Basic abc123')).toBe('');
    expect(extractBearer('')).toBe('');
  });
});

describe('requestMatchesToken', () => {
  test('accepts Authorization: Bearer <token>', () => {
    expect(requestMatchesToken({ headers: { authorization: `Bearer ${P_TOKEN}` } }, P_TOKEN)).toBe(true);
  });

  test('accepts x-maestro-token', () => {
    expect(requestMatchesToken({ headers: { 'x-maestro-token': P_TOKEN } }, P_TOKEN)).toBe(true);
  });

  test('accepts x-api-key (the bundled CLI path)', () => {
    expect(requestMatchesToken({ headers: { 'x-api-key': P_TOKEN } }, P_TOKEN)).toBe(true);
  });

  test('accepts ?token= query param (the App Builder iframe path)', () => {
    expect(requestMatchesToken({ headers: {}, query: { token: P_TOKEN } }, P_TOKEN)).toBe(true);
  });

  test('rejects a wrong token on every candidate source', () => {
    expect(requestMatchesToken({ headers: { authorization: 'Bearer nope' } }, P_TOKEN)).toBe(false);
    expect(requestMatchesToken({ headers: { 'x-maestro-token': 'nope' } }, P_TOKEN)).toBe(false);
    expect(requestMatchesToken({ headers: { 'x-api-key': 'nope' } }, P_TOKEN)).toBe(false);
    expect(requestMatchesToken({ headers: {}, query: { token: 'nope' } }, P_TOKEN)).toBe(false);
  });

  test('rejects when no candidate is present at all', () => {
    expect(requestMatchesToken({ headers: {} }, P_TOKEN)).toBe(false);
  });

  test('fails closed when the server has no token loaded yet (empty string)', () => {
    expect(requestMatchesToken({ headers: { authorization: `Bearer ${P_TOKEN}` } }, '')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  test('no Origin header (native WS client / curl / MCP subprocess) is allowed', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
  });

  test.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'file://', 'null'])('%s is allowed', (origin) => {
    expect(isOriginAllowed(origin)).toBe(true);
  });

  test('a packaged file:// origin with a path is allowed by prefix', () => {
    expect(isOriginAllowed('file:///Applications/Maestro.app/index.html')).toBe(true);
  });

  test.each(['http://localhost:5173', 'http://127.0.0.1:9999'])('%s (any dev port) is allowed', (origin) => {
    expect(isOriginAllowed(origin)).toBe(true);
  });

  test('an arbitrary external origin is rejected', () => {
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
  });
});

describe('wsRequestAuthOk', () => {
  function fakeUpgradeRequest(url: string, headers: Record<string, string> = {}) {
    return { url, headers } as unknown as import('node:http').IncomingMessage;
  }

  test('valid token, no origin header -> ok', () => {
    const req = fakeUpgradeRequest(`/ws/agents/abc?token=${P_TOKEN}`);
    expect(wsRequestAuthOk(req, P_TOKEN)).toBe(true);
  });

  test('valid bearer header, allowed origin -> ok', () => {
    const req = fakeUpgradeRequest('/ws/agents/abc', { authorization: `Bearer ${P_TOKEN}`, origin: 'http://localhost:3000' });
    expect(wsRequestAuthOk(req, P_TOKEN)).toBe(true);
  });

  test('missing token -> rejected', () => {
    const req = fakeUpgradeRequest('/ws/agents/abc');
    expect(wsRequestAuthOk(req, P_TOKEN)).toBe(false);
  });

  test('wrong token -> rejected', () => {
    const req = fakeUpgradeRequest('/ws/agents/abc?token=not-the-real-token');
    expect(wsRequestAuthOk(req, P_TOKEN)).toBe(false);
  });

  test('valid token but disallowed origin -> rejected', () => {
    const req = fakeUpgradeRequest(`/ws/agents/abc?token=${P_TOKEN}`, { origin: 'https://evil.example.com' });
    expect(wsRequestAuthOk(req, P_TOKEN)).toBe(false);
  });
});
