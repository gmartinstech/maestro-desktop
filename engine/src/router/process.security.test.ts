// engine/src/router/process.security.test.ts -- ENG-6 gate: TS vitest port of
// backend/tests/test_router_data_dir_permissions.py's assertions against the ported
// secureDataDir()/hardenWindowsAcl()/currentUserPrincipal()/windowsAclCommand()/windowsAclIsUsable().
//
// node:fs and node:child_process are mocked at the module level (vi.mock, with the mocked
// exports defaulting to a real passthrough via vi.fn(actual.fn)) rather than via vi.spyOn
// directly on the imported namespace: Node's builtin module exports have non-configurable
// property descriptors under Vitest's transform, so `vi.spyOn(nodeFs, 'chmodSync')` throws
// "Cannot redefine property" -- vi.mock substitutes the whole module at resolution time instead,
// which every importer (process.ts included, via the SAME `import * as nodeFs from 'node:fs'`
// specifier) resolves to, mirroring Python's `patch.object(proc.os, "makedirs", spy)` /
// `patch.object(proc.subprocess, "run", fake_run)`.
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Vitest hoists vi.mock() calls above every import in this file, so the plain, static imports
// below (node:fs, node:child_process, and process.ts itself) all resolve to these mocked modules.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, mkdirSync: vi.fn(actual.mkdirSync), chmodSync: vi.fn(actual.chmodSync) };
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

import * as nodeFs from 'node:fs';
import * as nodeChildProcess from 'node:child_process';
import * as proc from './process';

const posixOnly = process.platform === 'win32' ? it.skip : it;

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'maestro-9router-acl-test-'));
  proc.routerState.windowsAclHardened = false;
});
afterEach(() => {
  vi.mocked(nodeFs.mkdirSync).mockRestore();
  vi.mocked(nodeFs.chmodSync).mockRestore();
  vi.mocked(nodeChildProcess.spawnSync).mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

posixOnly('creates a fresh data dir owner-only (0700)', () => {
  const target = join(tmpDir, '9router');
  proc.secureDataDir(target, 'linux');
  expect(statSync(target).mode & 0o777).toBe(0o700);
});

posixOnly('tightens an existing loose data dir and its credential files', () => {
  const target = join(tmpDir, '9router');
  nodeFs.mkdirSync(target, { mode: 0o755 });
  nodeFs.chmodSync(target, 0o755);
  writeFileSync(join(target, 'db.json'), '{"providerConnections": []}');
  nodeFs.chmodSync(join(target, 'db.json'), 0o644);
  nodeFs.mkdirSync(join(target, 'auth'));
  writeFileSync(join(target, 'auth', 'cli-secret'), 'deadbeef');
  nodeFs.chmodSync(join(target, 'auth', 'cli-secret'), 0o644);
  proc.secureDataDir(target, 'linux');
  expect(statSync(target).mode & 0o777).toBe(0o700);
  expect(statSync(join(target, 'db.json')).mode & 0o777).toBe(0o600);
  expect(statSync(join(target, 'auth', 'cli-secret')).mode & 0o777).toBe(0o600);
});

posixOnly('creates the dir at 0700 directly (never chmod-after-create)', () => {
  const target = join(tmpDir, '9router');
  const modes: (number | undefined)[] = [];
  const real = nodeFs.mkdirSync;
  vi.mocked(nodeFs.mkdirSync).mockImplementation(((p: unknown, opts: unknown) => {
    const mode = typeof opts === 'object' && opts ? (opts as { mode?: number }).mode : undefined;
    modes.push(mode);
    return real(p as string, opts as never);
  }) as never);
  proc.secureDataDir(target, 'linux');
  expect(modes).toEqual([0o700]);
  expect(existsSync(target)).toBe(true);
});

it('records the POSIX-branch intent (mkdir/chmod modes) even when run on a non-POSIX host', () => {
  const target = join(tmpDir, '9router');
  nodeFs.mkdirSync(target);
  writeFileSync(join(target, 'db.json'), '{"providerConnections": []}');
  nodeFs.mkdirSync(join(target, 'auth'));
  writeFileSync(join(target, 'auth', 'cli-secret'), 'deadbeef');
  const chmods: [string, number][] = [];
  vi.mocked(nodeFs.chmodSync).mockImplementation(((p: unknown, mode: unknown) => {
    chmods.push([String(p).split(/[\\/]/).pop() ?? '', mode as number]);
  }) as never);
  proc.secureDataDir(target, 'linux');
  expect(chmods).toContainEqual(['9router', 0o700]);
  expect(chmods).toContainEqual(['db.json', 0o600]);
  expect(chmods).toContainEqual(['cli-secret', 0o600]);
});

it('degrades to a warning, never throws, when a file blocks the dir path', () => {
  const blocker = join(tmpDir, '9router');
  writeFileSync(blocker, 'not a dir');
  expect(proc.secureDataDir(blocker, 'linux')).toBe(blocker);
});

it('windowsAclCommand drops inherited access and grants by SID', () => {
  vi.mocked(nodeChildProcess.spawnSync).mockReturnValue({ status: 0, stdout: '"WILEY\\\\x","S-1-5-21-99-1"\n', stderr: '', pid: 0, output: [], signal: null } as never);
  const argv = proc.windowsAclCommand('C:\\Users\\x\\AppData\\Roaming\\9router');
  expect(argv[0]).toBe('icacls');
  expect(argv).toContain('/inheritance:r');
  expect(argv.some((a) => a.startsWith('*S-1-5-18:'))).toBe(true); // SYSTEM must be granted by SID, not name
  expect(argv.some((a) => a.startsWith('*S-1-5-32-544:'))).toBe(true); // Administrators by SID, not name
  expect(argv).toContain('/T'); // existing children (db.json) must be covered too
});

it('hardenWindowsAcl runs the ACL edit exactly once per process and never calls chmod', () => {
  const target = join(tmpDir, '9router');
  nodeFs.mkdirSync(target);
  writeFileSync(join(target, 'db.json'), '{}');
  const calls: string[][] = [];
  vi.mocked(nodeChildProcess.spawnSync).mockImplementation(((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    // Probe calls (icacls <path>, no /inheritance flag) report a real ACE so nothing rolls back.
    const stdout = args.some((a) => a.startsWith('/inheritance')) ? '' : `${args[0]} WILEY\\x:(OI)(CI)(F)\n`;
    return { status: 0, stdout, stderr: '', pid: 0, output: [], signal: null };
  }) as never);
  vi.mocked(nodeFs.chmodSync).mockImplementation(() => {
    throw new Error('chmod must not run on Windows');
  });
  proc.secureDataDir(target, 'win32');
  proc.secureDataDir(target, 'win32');
  const hardens = calls.filter((c) => c.includes('/inheritance:r'));
  expect(hardens).toHaveLength(1); // ACL hardening must run once per process
  expect(calls.every((c) => c[0] === 'icacls' || c[0] === 'whoami')).toBe(true);
});

it('rolls back a partial icacls apply that left an empty DACL, instead of leaving it bricked', () => {
  const target = join(tmpDir, '9router');
  nodeFs.mkdirSync(target, { recursive: true });
  const calls: string[][] = [];
  vi.mocked(nodeChildProcess.spawnSync).mockImplementation(((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    // First call is the hardening; the probe then reports an empty DACL (path line only).
    const out = args.includes('/inheritance:r') ? '' : args.length === 1 && cmd === 'icacls' ? `${target} \n` : '';
    return { status: 0, stdout: out, stderr: '', pid: 0, output: [], signal: null };
  }) as never);
  proc.hardenWindowsAcl(target);
  expect(calls.some((c) => c.includes('/inheritance:e'))).toBe(true); // no rollback attempted otherwise
});

it('a bricked credential file under a healthy dir is rolled back too', () => {
  const target = join(tmpDir, '9router');
  nodeFs.mkdirSync(target, { recursive: true });
  const dbPath = join(target, 'db.json');
  writeFileSync(dbPath, '{}');
  const calls: string[][] = [];
  vi.mocked(nodeChildProcess.spawnSync).mockImplementation(((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args.includes('/inheritance:r') || args.includes('/inheritance:e')) {
      return { status: 0, stdout: '', stderr: '', pid: 0, output: [], signal: null };
    }
    const probed = args[0];
    // The dir reports a real ACE, db.json reports the path line only (empty DACL).
    const out = probed === dbPath ? `${probed} \n` : `${probed} WILEY\\x:(OI)(CI)(F)\n`;
    return { status: 0, stdout: out, stderr: '', pid: 0, output: [], signal: null };
  }) as never);
  proc.hardenWindowsAcl(target);
  expect(calls.some((c) => c.includes(dbPath))).toBe(true); // db.json was never verified otherwise
  expect(calls.some((c) => c.includes('/inheritance:e'))).toBe(true); // no rollback for the bricked file
});

it('prefers the resolved SID, falling back to DOMAIN\\user when whoami is unavailable', () => {
  vi.mocked(nodeChildProcess.spawnSync).mockReturnValueOnce({
    status: 0,
    stdout: '"WILEY\\\\gmartinssi","S-1-5-21-99-1001"\n',
    stderr: '',
    pid: 0,
    output: [],
    signal: null,
  } as never);
  expect(proc.currentUserPrincipal()).toBe('*S-1-5-21-99-1001');

  vi.mocked(nodeChildProcess.spawnSync).mockImplementationOnce(() => {
    throw new Error('whoami missing');
  });
  vi.stubEnv('USERDOMAIN', 'WILEY');
  vi.stubEnv('USERNAME', 'gmartinssi');
  expect(proc.currentUserPrincipal()).toBe('WILEY\\gmartinssi'); // must qualify with the domain, not pass a bare name
  vi.unstubAllEnvs();
});
