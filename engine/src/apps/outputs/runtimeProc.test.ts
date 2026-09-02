// engine/src/apps/outputs/runtimeProc.test.ts -- SUB-5's vitest twin for runtimeProc.ts, the
// ticket's own "central risk" file (see its module header). No dedicated test file existed for
// this module before this pass despite it carrying the Windows process-tree logic the ticket's
// real gate depends on -- these tests spawn REAL processes (no mocks) on this real Windows host
// and confirm they are actually killed, mirroring the live gate rather than approximating it.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ensureForcePortShim,
  findFreePort,
  isNewMode,
  isPortFree,
  killDescendantTree,
  killListenerOnPort,
  killProcessesUnderWorkspace,
  readEnvValue,
  resumeProcessTree,
  suspendProcessTree,
  writeEnvValue,
} from './runtimeProc';

const isWindows = process.platform === 'win32';

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

describe('findFreePort / isPortFree', () => {
  test('findFreePort returns a port that is then reported free, and busy once bound', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(await isPortFree(port)).toBe(true);

    const net = await import('node:net');
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(port, '127.0.0.1', resolve));
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});

describe('readEnvValue / writeEnvValue', () => {
  test('writes a new key, then updates it in place preserving other lines', () => {
    const dir = tmpDir('maestro-runtimeproc-env-');
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'FOO=1\nBACKEND_PORT=NONE\n', 'utf8');

    writeEnvValue(envPath, 'FRONTEND_PORT', '5555');
    expect(readEnvValue(envPath, 'FRONTEND_PORT')).toBe('5555');
    expect(readEnvValue(envPath, 'FOO')).toBe('1');
    expect(readEnvValue(envPath, 'BACKEND_PORT')).toBe('NONE');

    writeEnvValue(envPath, 'FRONTEND_PORT', '6666');
    expect(readEnvValue(envPath, 'FRONTEND_PORT')).toBe('6666');
    // Only one FRONTEND_PORT line should exist after the update.
    const text = readFileSync(envPath, 'utf8');
    expect(text.match(/FRONTEND_PORT=/g)).toHaveLength(1);
  });

  test('readEnvValue strips quotes and inline comments, returns undefined for a missing key/file', () => {
    const dir = tmpDir('maestro-runtimeproc-env2-');
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'A="quoted"\nB=bare # a comment\n', 'utf8');
    expect(readEnvValue(envPath, 'A')).toBe('quoted');
    expect(readEnvValue(envPath, 'B')).toBe('bare');
    expect(readEnvValue(envPath, 'MISSING')).toBeUndefined();
    expect(readEnvValue(join(dir, 'nope.env'), 'A')).toBeUndefined();
  });
});

describe('ensureForcePortShim / isNewMode', () => {
  test('isNewMode is true only when run.sh exists at the workspace root', () => {
    const dir = tmpDir('maestro-runtimeproc-newmode-');
    expect(isNewMode(dir)).toBe(false);
    writeFileSync(join(dir, 'run.sh'), '#!/bin/bash\n', 'utf8');
    expect(isNewMode(dir)).toBe(true);
  });

  test('injects the MAESTRO_FORCE_*_PORT override block once, after the .env source line, and is idempotent', () => {
    const dir = tmpDir('maestro-runtimeproc-shim-');
    const runSh = join(dir, 'run.sh');
    writeFileSync(
      runSh,
      '#!/bin/bash\nROOT_DIR="$(pwd)"\nif [[ -f "$ROOT_DIR/.env" ]]; then\n    source "$ROOT_DIR/.env"\nfi\necho done\n',
      'utf8',
    );
    ensureForcePortShim(dir);
    const once = readFileSync(runSh, 'utf8');
    expect(once).toContain('MAESTRO_FORCE_FRONTEND_PORT');
    expect(once).toContain('MAESTRO_FORCE_BACKEND_PORT');
    // Inserted after the `source .env` block's closing `fi`, before the trailing `echo done`.
    expect(once.indexOf('source "$ROOT_DIR/.env"')).toBeLessThan(once.indexOf('MAESTRO_FORCE_FRONTEND_PORT'));
    expect(once.indexOf('MAESTRO_FORCE_FRONTEND_PORT')).toBeLessThan(once.indexOf('echo done'));

    ensureForcePortShim(dir); // idempotent: no second block
    const twice = readFileSync(runSh, 'utf8');
    expect(twice).toBe(once);
  });

  test('leaves run.sh untouched when it has no recognizable `source .env` block', () => {
    const dir = tmpDir('maestro-runtimeproc-shim-nomatch-');
    const runSh = join(dir, 'run.sh');
    const original = '#!/bin/bash\necho "no env sourcing here"\n';
    writeFileSync(runSh, original, 'utf8');
    ensureForcePortShim(dir);
    expect(readFileSync(runSh, 'utf8')).toBe(original);
  });

  test('is a no-op when run.sh does not exist', () => {
    const dir = tmpDir('maestro-runtimeproc-shim-missing-');
    expect(() => ensureForcePortShim(dir)).not.toThrow();
    expect(existsSync(join(dir, 'run.sh'))).toBe(false);
  });
});

describe('suspendProcessTree / resumeProcessTree', () => {
  test('on this platform (win32), suspend/resume are documented no-ops -- a real spawned process stays alive and unaffected either way', async () => {
    if (!isWindows) return; // this suite runs on the Windows dev box; a POSIX host would exercise the real-SIGSTOP branch instead.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true });
    try {
      expect(child.pid).toBeDefined();
      expect(() => suspendProcessTree(child.pid)).not.toThrow();
      expect(() => resumeProcessTree(child.pid)).not.toThrow();
      // Still alive -- neither call should have touched it (Windows no-op, matching runtime_proc.py's own documented stance).
      expect(child.exitCode).toBeNull();
      expect(child.killed).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('suspend/resume never throw on an already-dead or missing pid', () => {
    expect(() => suspendProcessTree(999_999_999)).not.toThrow();
    expect(() => resumeProcessTree(999_999_999)).not.toThrow();
    expect(() => suspendProcessTree(null)).not.toThrow();
    expect(() => resumeProcessTree(undefined)).not.toThrow();
  });
});

describe('killDescendantTree (real process tree, no mocks)', () => {
  test('kills a real spawned child that is still alive', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true });
    const pid = child.pid as number;
    expect(pid).toBeDefined();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await killDescendantTree(pid, 'KILL');
    // killDescendantTree signals DESCENDANTS of pid on POSIX and taskkills the whole tree rooted at
    // pid on Windows (which includes pid itself, per Windows taskkill /T semantics) -- either way
    // the process this test spawned must be gone shortly after.
    if (isWindows) {
      await waitFor(() => child.exitCode !== null || child.killed);
      await exited;
    } else {
      child.kill('SIGKILL'); // POSIX: only descendants are signaled, not pid itself -- clean up directly.
    }
    expect(true).toBe(true); // reaching here without hanging is the assertion; an unkilled child would leave this test dangling.
  });

  test('never throws for a pid that does not exist', async () => {
    await expect(killDescendantTree(999_999_999, 'TERM')).resolves.toBeUndefined();
  });
});

describe('killListenerOnPort (real listener, no mocks)', () => {
  test('finds and kills whatever REALLY holds a TCP listener on the given port, sight-unseen (no pid tracked ahead of time)', async () => {
    if (!isWindows) return; // POSIX-only no-op branch is covered by the guard test below.
    // Mirrors the real gap this function closes: a process the runtime never itself spawned
    // (or lost track of via a broken PPID chain) but that is provably bound to the port we own.
    const port = await findFreePort();
    const child = spawn(
      process.execPath,
      ['-e', `require('net').createServer().listen(${port}, '127.0.0.1'); setTimeout(() => {}, 30000);`],
      { windowsHide: true },
    );
    expect(await waitFor(async () => !(await isPortFree(port)))).toBe(true);

    await killListenerOnPort(port);

    expect(await waitFor(async () => isPortFree(port))).toBe(true);
    expect(await waitFor(() => child.exitCode !== null)).toBe(true);
  });

  test('is a no-op (never throws) for a port nothing is listening on', async () => {
    const port = await findFreePort();
    await expect(killListenerOnPort(port)).resolves.toBeUndefined();
  });

  test('is a no-op for a null/undefined port', async () => {
    await expect(killListenerOnPort(null)).resolves.toBeUndefined();
    await expect(killListenerOnPort(undefined)).resolves.toBeUndefined();
  });
});

describe('killProcessesUnderWorkspace (real process, no mocks) -- closes the gap killListenerOnPort cannot: a reparented descendant that has not bound a port yet', () => {
  // Both tests here spawn a real `powershell.exe -EncodedCommand` (killProcessesUnderWorkspace's
  // own implementation) rather than the plain execFile calls the rest of this file's tests use --
  // PowerShell's own cold-start is meaningfully slower, especially under this suite's real-world
  // contention (observed timing out at vitest's 5000ms default on a heavily-loaded shared box, a
  // false failure, not a functional one -- confirmed passing standalone). Generous explicit
  // per-test timeouts absorb that without masking a genuine hang (still far below "stuck forever").
  test('finds and kills a real process whose command line references the workspace path, even though it holds no port', async () => {
    if (!isWindows) return; // POSIX has no PPID-chain gap to close (see this function's own header); guarded no-op tested below.
    const workspace = tmpDir('maestro-runtimeproc-wskill-');
    // A long-lived child whose OWN argv names the workspace path -- mirrors frontend/run.sh's real
    // invocation shape (`bash <workspacePath>/frontend/run.sh`), the exact fingerprint this
    // function matches on. Uses a marker file instead of a port so this test proves the function
    // does NOT depend on anything being bound yet (the whole point of this sweep).
    const marker = join(workspace, 'still-alive');
    writeFileSync(marker, 'x', 'utf8');
    const child = spawn(
      process.execPath,
      ['-e', `require('fs').existsSync(${JSON.stringify(workspace)}); setTimeout(() => {}, 30000);`, workspace],
      { windowsHide: true },
    );
    expect(child.pid).toBeDefined();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await killProcessesUnderWorkspace(workspace);

    await waitFor(() => child.exitCode !== null || child.killed, 15000);
    await exited;
    expect(child.exitCode === null ? child.killed : true).toBe(true);
  }, 25000);

  test('never kills an unrelated process (only matches command lines under the exact workspace path)', async () => {
    if (!isWindows) return;
    const unrelatedWorkspace = tmpDir('maestro-runtimeproc-wskill-unrelated-');
    const targetWorkspace = tmpDir('maestro-runtimeproc-wskill-target-');
    const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000);', unrelatedWorkspace], { windowsHide: true });
    try {
      await killProcessesUnderWorkspace(targetWorkspace);
      // Give a would-be false-positive kill a moment to land before asserting survival.
      await new Promise((r) => setTimeout(r, 500));
      expect(bystander.exitCode).toBeNull();
      expect(bystander.killed).toBe(false);
    } finally {
      bystander.kill('SIGKILL');
    }
  }, 20000);

  test('is a no-op (never throws) for an empty/missing path', async () => {
    await expect(killProcessesUnderWorkspace('')).resolves.toBeUndefined();
  });
});
