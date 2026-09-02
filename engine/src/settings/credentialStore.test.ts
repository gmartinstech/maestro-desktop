// engine/src/settings/credentialStore.test.ts -- ENG-4's OS-keyring credential store, unit
// tested the same way backend/tests/test_maestro_credential_store.py tests its Python
// counterpart: the real OS store is NEVER touched here. setKeyringModuleForTests /
// setWinCredReaderForTests inject in-memory fakes (or null/throwing, to simulate "OS store
// unreachable") so this suite runs identically on every CI machine and never leaves a stray
// credential behind on the dev box, and never spawns a real powershell.exe process.
//
// Two separate seams are exercised because production code itself is split that way (see
// credentialStore.ts's own CRITICAL, VERIFIED FINDING): SET/DELETE always go through the fake
// @napi-rs/keyring module (confirmed safe there against the real store); GET on win32 goes through
// the fake win-cred-reader instead (the real @napi-rs/keyring read path was found to destructively
// zero out foreign-written Windows credentials, so production code never calls it for reads on
// win32); GET on non-win32 still goes through the fake keyring module. makeFakeCredentialBackend()
// below wires one shared in-memory store to both seams so tests read back exactly what they wrote,
// regardless of which platform this suite happens to run on.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  MAESTRO_KEYRING_SERVICE,
  MAESTRO_KEYRING_USERNAME,
  clearRefreshToken,
  loadRefreshToken,
  resetKeyringModuleForTests,
  resetWinCredReaderForTests,
  setKeyringModuleForTests,
  setWinCredReaderForTests,
  storeRefreshToken,
} from './credentialStore';

interface FakeCredEntry {
  blob: Buffer;
  userName: string;
}

// One shared Map backs BOTH fakes below, keyed by the exact resolved TargetName string each call
// resolves to (mirrors Python's p_FakeKeyring fixture, which keys by (service, username) since it
// has no Windows target-name quirk to reproduce). Values are stored as UTF-16LE bytes -- the real
// Windows Credential Manager convention this module's own decodeCredentialBlob() expects -- so the
// win-cred-reader fake exercises the exact same decode path production code runs on Windows.
function makeFakeCredentialBackend(seed: Map<string, FakeCredEntry> = new Map()) {
  const store = seed;

  class FakeEntry {
    constructor(private readonly target: string) {}
    getPassword(): string | null {
      const e = store.get(this.target);
      return e ? e.blob.toString('utf16le') : null;
    }
    setPassword(password: string): void {
      store.set(this.target, { blob: Buffer.from(password, 'utf16le'), userName: MAESTRO_KEYRING_USERNAME });
    }
    deletePassword(): boolean {
      return store.delete(this.target);
    }
  }

  const keyringModule = {
    Entry: class {
      static withTarget(target: string, _service: string, _username: string) {
        return new FakeEntry(target);
      }
      constructor(service: string, username: string) {
        return new FakeEntry(`${username}.${service}`) as unknown as InstanceType<typeof FakeEntry>;
      }
    },
  };

  const winCredReader = (target: string) => {
    const e = store.get(target);
    return e ? { blob: e.blob, userName: e.userName } : null;
  };

  return { store, keyringModule, winCredReader };
}

// Installs one fake backend across both seams -- the combination every "OS keyring reachable"
// test below needs, regardless of which platform this suite runs on.
function installFakeBackend(seed?: Map<string, FakeCredEntry>) {
  const backend = makeFakeCredentialBackend(seed);
  setKeyringModuleForTests(backend.keyringModule as never);
  setWinCredReaderForTests(backend.winCredReader);
  return backend;
}

let dataRoot: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-credstore-test-'));
  env = { ...process.env, MAESTRO_DATA_ROOT: dataRoot };
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  resetKeyringModuleForTests();
  resetWinCredReaderForTests();
});

describe('the service/account identifiers are stable, matching the Python original exactly', () => {
  test('names match backend/apps/settings/maestro_credential_store.py lines 26-27', () => {
    expect(MAESTRO_KEYRING_SERVICE).toBe('MaestroStudio');
    expect(MAESTRO_KEYRING_USERNAME).toBe('keycloak-refresh-token');
  });
});

describe('OS keyring reachable (fake native binding + fake win-cred-reader)', () => {
  test('round-trips through the fake OS keyring', () => {
    installFakeBackend();
    expect(loadRefreshToken(env)).toBeNull();
    storeRefreshToken('rt-abc123', env);
    expect(loadRefreshToken(env)).toBe('rt-abc123');
  });

  test('storing again overwrites', () => {
    installFakeBackend();
    storeRefreshToken('rt-first', env);
    storeRefreshToken('rt-second', env);
    expect(loadRefreshToken(env)).toBe('rt-second');
  });

  test('clear removes it, and re-reading is a null (not an error)', () => {
    installFakeBackend();
    storeRefreshToken('rt-abc123', env);
    clearRefreshToken(env);
    expect(loadRefreshToken(env)).toBeNull();
  });

  test('clearing when nothing was ever stored is a no-op, not an error', () => {
    installFakeBackend();
    expect(() => clearRefreshToken(env)).not.toThrow();
    expect(loadRefreshToken(env)).toBeNull();
  });

  test('a reachable keyring answering null is authoritative -- never consults the file fallback', () => {
    installFakeBackend();
    // Plant a stale file-fallback value that must NEVER surface while the keyring is reachable.
    mkdirSync(join(dataRoot, 'credentials'), { recursive: true });
    writeFileSync(
      join(dataRoot, 'credentials', 'keycloak-refresh-token.enc.json'),
      JSON.stringify({ v: 1, salt: 'x', iv: 'x', tag: 'x', ciphertext: 'x' }),
    );
    expect(loadRefreshToken(env)).toBeNull();
  });
});

describe('Windows TargetName/UserName resolution (only meaningful on win32; skipped elsewhere)', () => {
  test('a value at the compound target is read back when the primary target is absent', () => {
    if (process.platform !== 'win32') return;
    const store = new Map<string, FakeCredEntry>();
    store.set(`${MAESTRO_KEYRING_USERNAME}@${MAESTRO_KEYRING_SERVICE}`, { blob: Buffer.from('rt-from-compound', 'utf16le'), userName: MAESTRO_KEYRING_USERNAME });
    installFakeBackend(store);
    expect(loadRefreshToken(env)).toBe('rt-from-compound');
  });

  test('the primary target wins over the compound target when both exist', () => {
    if (process.platform !== 'win32') return;
    const store = new Map<string, FakeCredEntry>();
    store.set(MAESTRO_KEYRING_SERVICE, { blob: Buffer.from('rt-from-primary', 'utf16le'), userName: MAESTRO_KEYRING_USERNAME });
    store.set(`${MAESTRO_KEYRING_USERNAME}@${MAESTRO_KEYRING_SERVICE}`, { blob: Buffer.from('rt-from-compound', 'utf16le'), userName: MAESTRO_KEYRING_USERNAME });
    installFakeBackend(store);
    expect(loadRefreshToken(env)).toBe('rt-from-primary');
  });

  test('a primary target whose stored username does not match falls through to the compound target', () => {
    // Mirrors WinVaultKeyring._resolve_credential's own username check -- a primary slot holding
    // some OTHER account's credential must not be mistaken for ours.
    if (process.platform !== 'win32') return;
    const store = new Map<string, FakeCredEntry>();
    store.set(MAESTRO_KEYRING_SERVICE, { blob: Buffer.from('someone-elses-value', 'utf16le'), userName: 'a-different-account' });
    store.set(`${MAESTRO_KEYRING_USERNAME}@${MAESTRO_KEYRING_SERVICE}`, { blob: Buffer.from('rt-from-compound', 'utf16le'), userName: MAESTRO_KEYRING_USERNAME });
    installFakeBackend(store);
    expect(loadRefreshToken(env)).toBe('rt-from-compound');
  });

  test('a write lands on the primary (service-only) target, not the plain-constructor default', () => {
    if (process.platform !== 'win32') return;
    const backend = installFakeBackend();
    storeRefreshToken('rt-written', env);
    expect(backend.store.get(MAESTRO_KEYRING_SERVICE)?.blob.toString('utf16le')).toBe('rt-written');
  });
});

describe('OS keyring unreachable (native binding/reader failed) -- encrypted-file fallback', () => {
  beforeEach(() => {
    setKeyringModuleForTests(null);
    setWinCredReaderForTests(() => {
      throw new Error('simulated: OS keyring unreachable');
    });
  });

  test('round-trips through the encrypted file when the OS keyring cannot be reached', () => {
    expect(loadRefreshToken(env)).toBeNull();
    storeRefreshToken('rt-headless-abc', env);
    expect(loadRefreshToken(env)).toBe('rt-headless-abc');
  });

  test('the on-disk file never contains the plaintext token', () => {
    storeRefreshToken('rt-must-not-leak-in-plaintext', env);
    const raw = readFileSync(join(dataRoot, 'credentials', 'keycloak-refresh-token.enc.json'), 'utf8');
    expect(raw).not.toContain('rt-must-not-leak-in-plaintext');
  });

  test('clear removes the file and re-reading is null', () => {
    storeRefreshToken('rt-x', env);
    clearRefreshToken(env);
    expect(loadRefreshToken(env)).toBeNull();
  });

  test('a corrupt fallback file falls back to null instead of throwing', () => {
    mkdirSync(join(dataRoot, 'credentials'), { recursive: true });
    writeFileSync(join(dataRoot, 'credentials', 'keycloak-refresh-token.enc.json'), '{not valid json');
    expect(loadRefreshToken(env)).toBeNull();
  });

  test('a tampered ciphertext (GCM auth-tag mismatch) falls back to null instead of throwing', () => {
    storeRefreshToken('rt-y', env);
    const path = join(dataRoot, 'credentials', 'keycloak-refresh-token.enc.json');
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    payload.ciphertext = Buffer.from('tampered-bytes-here').toString('base64');
    writeFileSync(path, JSON.stringify(payload));
    expect(loadRefreshToken(env)).toBeNull();
  });

  test('a value written by the file fallback is discarded once the OS keyring becomes reachable again and gets a fresh write', () => {
    storeRefreshToken('rt-stale-headless-value', env);
    expect(loadRefreshToken(env)).toBe('rt-stale-headless-value');

    // The OS keyring "comes back" (e.g. the native binding loads on the next run).
    installFakeBackend();
    storeRefreshToken('rt-fresh-keyring-value', env);
    expect(loadRefreshToken(env)).toBe('rt-fresh-keyring-value');

    // The stale file must have been cleared by the successful keyring write, not merely shadowed --
    // confirmed by making the keyring unreachable again and checking the file doesn't resurrect
    // the old value.
    setKeyringModuleForTests(null);
    setWinCredReaderForTests(() => {
      throw new Error('simulated: OS keyring unreachable again');
    });
    expect(loadRefreshToken(env)).toBeNull();
  });
});
