// engine/src/auth/token.test.ts -- initAuthToken()'s persistence contract: mint once, reuse
// across restarts, and resolve to the SAME path backend/config/paths.py's AUTH_TOKEN_FILE does.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { authTokenFilePath, initAuthToken, resetAuthTokenForTests, resolveDataRoot } from './token';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-token-test-'));
  resetAuthTokenForTests();
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('resolveDataRoot', () => {
  test('MAESTRO_DATA_ROOT override wins outright', () => {
    expect(resolveDataRoot({ MAESTRO_DATA_ROOT: dataRoot })).toBe(dataRoot);
  });

  test('unset env defaults to backend/data (dev fallback), NOT engine/data', () => {
    const resolved = resolveDataRoot({});
    expect(resolved.replace(/\\/g, '/')).toMatch(/\/backend\/data$/);
  });

  test('MAESTRO_PACKAGED=1 on Windows resolves under %APPDATA%/Maestro Studio/data', () => {
    if (process.platform !== 'win32') return;
    const resolved = resolveDataRoot({ MAESTRO_PACKAGED: '1', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' });
    expect(resolved.replace(/\\/g, '/')).toBe('C:/Users/someone/AppData/Roaming/Maestro Studio/data');
  });
});

describe('initAuthToken', () => {
  test('mints a fresh token and persists it to auth.token, 16-512 chars', () => {
    const token = initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token.length).toBeLessThanOrEqual(512);
    const path = authTokenFilePath({ MAESTRO_DATA_ROOT: dataRoot });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8').trim()).toBe(token);
  });

  test('reuses an existing on-disk token rather than minting a new one', () => {
    const first = initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    resetAuthTokenForTests();
    const second = initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    expect(second).toBe(first);
  });

  test('a malformed on-disk token (too short) is discarded and replaced', () => {
    const path = authTokenFilePath({ MAESTRO_DATA_ROOT: dataRoot });
    initAuthToken({ MAESTRO_DATA_ROOT: dataRoot }); // creates the dir
    writeFileSync(path, 'short');
    resetAuthTokenForTests();
    const token = initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    expect(token).not.toBe('short');
    expect(token.length).toBeGreaterThanOrEqual(16);
  });

  test('the token file is written 0600 (owner read/write only)', () => {
    if (process.platform === 'win32') return; // chmod is a documented no-op on Windows
    const path = authTokenFilePath({ MAESTRO_DATA_ROOT: dataRoot });
    initAuthToken({ MAESTRO_DATA_ROOT: dataRoot });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
