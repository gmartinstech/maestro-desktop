import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../net/http';
import { count as spoolCount } from './spool';
import { spoolPath, sync, telemetryConfigured } from './telemetryClient';

let dataRoot: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-service-telemetry-'));
  env = { ...process.env, MAESTRO_DATA_ROOT: dataRoot };
  delete env.MAESTRO_TELEMETRY_URL;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('telemetryConfigured', () => {
  test('false with no MAESTRO_TELEMETRY_URL -- the off-by-default posture', () => {
    expect(telemetryConfigured(env)).toBe(false);
  });

  test('true once MAESTRO_TELEMETRY_URL is set', () => {
    expect(telemetryConfigured({ ...env, MAESTRO_TELEMETRY_URL: 'https://llm.martinstech.net' })).toBe(true);
  });
});

describe('sync', () => {
  test('is a total no-op with no MAESTRO_TELEMETRY_URL configured -- never touches the network or the spool', () => {
    const spy = vi.spyOn(http, 'engineFetch');
    sync({ hello: 'world' }, env);
    expect(spy).not.toHaveBeenCalled();
    expect(spoolCount(spoolPath(env))).toBe(0);
  });

  test('a host that fails the provider-egress allowlist spools rather than throwing into the caller', async () => {
    const withTelemetry = { ...env, MAESTRO_TELEMETRY_URL: 'https://evil.example.com' };
    expect(() => sync({ hello: 'world' }, withTelemetry)).not.toThrow();
    // sync() fires the delivery async (void deliverOrSpool); give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 50));
    expect(spoolCount(spoolPath(withTelemetry))).toBe(1);
  });

  test('an allowlisted host that is unreachable also spools, not throws -- covers ordinary network failure, not just allowlist rejection', async () => {
    // Mocked, not a real network call: proves sync()'s retry/spool path also fires on a plain
    // connection failure through the allowlisted gateway, without this test depending on a real
    // endpoint's live response (which is exactly the kind of network-dependent, nondeterministic
    // unit test this repo's own conventions avoid).
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED (simulated)'));
    const withTelemetry = { ...env, MAESTRO_TELEMETRY_URL: 'https://llm.martinstech.net' };
    sync({ hello: 'world' }, withTelemetry);
    await new Promise((r) => setTimeout(r, 50));
    expect(spoolCount(spoolPath(withTelemetry))).toBe(1);
  });
});
