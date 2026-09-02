import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { signedQuery } from './tiktokSign';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
  resetSessionCacheForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('signedQuery', () => {
  test('includes the device params + the caller-supplied params', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ cookies: [{ name: 'sessionid', value: 's1' }] }), { status: 200 }));
    const qs = await signedQuery({ count: 20 });
    const params = new URLSearchParams(qs);
    expect(params.get('aid')).toBe('1988');
    expect(params.get('app_name')).toBe('tiktok_web');
    expect(params.get('count')).toBe('20');
  });

  test('attaches a borrowed msToken cookie when present', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(
      new Response(JSON.stringify({ cookies: [{ name: 'msToken', value: 'tok-xyz' }] }), { status: 200 }),
    );
    const qs = await signedQuery({});
    expect(new URLSearchParams(qs).get('msToken')).toBe('tok-xyz');
  });

  test('omits msToken entirely when the session has none (no crash, no empty param)', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ cookies: [{ name: 'sessionid', value: 's1' }] }), { status: 200 }));
    const qs = await signedQuery({});
    expect(new URLSearchParams(qs).has('msToken')).toBe(false);
  });

  test('never emits X-Bogus or X-Gnarly (deliberately not reproduced)', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ cookies: [{ name: 'sessionid', value: 's1' }] }), { status: 200 }));
    const qs = await signedQuery({});
    expect(qs).not.toMatch(/x[-_]bogus|x[-_]gnarly/i);
  });
});
