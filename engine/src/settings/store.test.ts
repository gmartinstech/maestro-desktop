import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defaultAppSettings } from './models';
import { atomicWriteJson, loadSettings, saveSettings, settingsFilePath } from './store';

let dataRoot: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-settings-test-'));
  env = { ...process.env, MAESTRO_DATA_ROOT: dataRoot };
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('atomicWriteJson', () => {
  // A direct fsyncSync spy (mirroring the Python test's os.fsync monkeypatch) hits
  // "Cannot redefine property" against Node's builtin fs module under this test runner, so this
  // asserts the pattern's OBSERVABLE guarantees instead: the write actually lands (proving the
  // fsync-before-rename path didn't throw), the target directory is created on demand (mkdirSync
  // recursive, same as json_store.py's os.makedirs), and no temp artifact survives a successful
  // write -- store.ts's module doc explains why directory fsync itself can't be asserted to
  // "land" cross-platform (it silently no-ops on this repo's own Windows dev box, same as Python).
  test('creates the parent directory on demand and writes valid JSON', () => {
    const target = join(dataRoot, 'sub', 'x.json');
    atomicWriteJson(target, { k: 'v' });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ k: 'v' });
  });

  test('a write leaves no leftover temp file behind', () => {
    const target = join(dataRoot, 'y.json');
    atomicWriteJson(target, { a: 1 });
    expect(readdirSync(dataRoot)).toEqual(['y.json']);
  });
});

describe('loadSettings / saveSettings round trip', () => {
  test('an absent settings.json yields defaults', () => {
    const { settings, droppedFields } = loadSettings(env);
    expect(settings).toEqual(defaultAppSettings());
    expect(droppedFields).toEqual([]);
  });

  test('save then load round-trips a stored credential unchanged, key name included', () => {
    const settings = { ...defaultAppSettings(), provedor_ia_token: 'mtok_realsecret', theme: 'dark' };
    saveSettings(settings, env);
    const loaded = loadSettings(env);
    expect(loaded.settings.provedor_ia_token).toBe('mtok_realsecret');
    expect(loaded.settings.theme).toBe('dark');
  });

  test('migrates a legacy openswarm_bearer_token on load without a resave', () => {
    mkdirSync(join(dataRoot, 'settings'), { recursive: true });
    writeFileSync(settingsFilePath(env), JSON.stringify({ openswarm_bearer_token: 'legacy-tok' }));
    const loaded = loadSettings(env);
    expect(loaded.settings.maestro_bearer_token).toBe('legacy-tok');
  });

  test('a corrupt settings.json falls back to defaults instead of throwing', () => {
    mkdirSync(join(dataRoot, 'settings'), { recursive: true });
    writeFileSync(settingsFilePath(env), '{not valid json');
    const loaded = loadSettings(env);
    expect(loaded.settings).toEqual(defaultAppSettings());
  });
});
