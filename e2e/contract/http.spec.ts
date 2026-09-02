// e2e/contract/http.spec.ts — HTTP surface of the contract: every documented GET route is
// wired up and gated the way backend/auth.py's middleware says it should be, plus one sanity
// check on CORS preflight. Points at whatever backend scripts/run-contract-tests.mjs booted
// (Python today; a future TS rewrite later) via CONTRACT_HTTP_URL / CONTRACT_TOKEN.

import { test, expect } from '@playwright/test';
import {
  loadContractConfig,
  httpGet,
  httpOptions,
  contractGetPaths,
  isAuthExemptPath,
  HTTP_SWEEP_EXCLUDED_PATHS,
} from './run';

const cfg = loadContractConfig();
const getPaths = contractGetPaths();
const sweptPaths = getPaths.filter((p) => !HTTP_SWEEP_EXCLUDED_PATHS.has(p));

test.describe('GET routes, no token', () => {
  // One assertion per route rather than a single loop: a failure names exactly which route
  // regressed instead of "the sweep failed somewhere".
  for (const path of sweptPaths) {
    const exempt = isAuthExemptPath(path);
    test(`GET ${path} -> ${exempt ? 'answers (auth-exempt)' : '401 (auth-gated)'}`, async () => {
      const res = await httpGet(cfg, path, { token: null });
      if (exempt) {
        // Not asserting a specific code (some exempt routes 404/422 on a placeholder path
        // segment) — only that the auth middleware did not reject it.
        expect(res.status, `${path} is auth-exempt but got 401`).not.toBe(401);
      } else {
        expect(res.status, `${path} is auth-gated but did not 401 with no token`).toBe(401);
      }
    });
  }
});

test('the sweep covers every documented GET route (minus the documented exclusion)', () => {
  // Guards the sweep itself: a newly-added GET route falling through both buckets above
  // (swept, or excluded-with-reason) would otherwise just not get tested, with no red
  // anywhere. Also pins HTTP_SWEEP_EXCLUDED_PATHS to routes that still exist in the contract.
  expect(getPaths.length).toBeGreaterThan(0);
  for (const excluded of HTTP_SWEEP_EXCLUDED_PATHS) {
    expect(getPaths, `${excluded} is in HTTP_SWEEP_EXCLUDED_PATHS but no longer in the contract`).toContain(excluded);
  }
  expect(sweptPaths.length).toBe(getPaths.length - HTTP_SWEEP_EXCLUDED_PATHS.size);
});

test('OPTIONS preflight on a gated route is CORS-sane', async () => {
  const res = await httpOptions(cfg, '/api/settings', {
    Origin: 'http://localhost:3000',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization',
  });
  // Preflights are exempt from the auth middleware (backend/main.py's p_auth_middleware checks
  // `request.method == "OPTIONS"` first), so this must succeed with no token at all.
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  expect(res.headers.get('access-control-allow-methods') ?? '').toContain('GET');
  // backend/main.py sets max_age=600 on the CORSMiddleware specifically to cut preflight churn.
  expect(res.headers.get('access-control-max-age')).toBe('600');
});

test('OPTIONS preflight from a disallowed origin does not echo it back', async () => {
  const res = await httpOptions(cfg, '/api/settings', {
    Origin: 'https://evil.example.com',
    'Access-Control-Request-Method': 'GET',
  });
  expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example.com');
});
