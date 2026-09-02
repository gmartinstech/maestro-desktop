// engine/src/apps/terminal/ptySession.test.ts -- spawns REAL pseudo-terminals via node-pty, no
// mocking. This is the unit layer under ws.test.ts's full WS-shape gate: proves the underlying
// PtySession mechanism (spawn, subscribe/replay, write, resize, exit) works in isolation before
// asserting the wire contract on top of it. Every session spawned here is stop()'d (afterEach),
// per this ticket's "kill every PTY you spawn" requirement.
//
// Two real things discovered writing this file, both worth recording:
//
// 1. A real, spawned pwsh.exe inherits the actual developer's PowerShell profile/PSReadLine
//    config -- exactly the production behavior we want for a real terminal card, but a real side
//    effect for a TEST to trigger: PSReadLine persists every command typed to
//    `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt` regardless of who
//    (a human or this suite) is doing the typing. `beforeAll`/`afterAll` below sandbox
//    APPDATA/USERPROFILE/HOME to a throwaway temp dir for the duration of this file's real-shell
//    tests -- confirmed empirically (a probe run with this override left no history file behind in
//    the sandbox and, more importantly, never touched the real path). The first version of this
//    file did NOT do this and measurably polluted this machine's real PSReadLine history with
//    literal test marker strings before the sandboxing was added -- cleaned up by hand afterward.
//    This is a test-only env override (mutating this process's own env before calling production
//    code); production's resolveShell()/buildTerminalEnv() are unchanged and still inherit the
//    real profile, matching backend/apps/terminal's own behavior exactly.
//
// 2. PSReadLine's live syntax-highlighted keystroke echo means whatever marker string you WRITE to
//    the pty also comes back near-instantly as an ECHO of what you typed, before the shell has
//    actually executed anything -- a naive "wait for output containing X" resolves on that echo,
//    not on the command's real result. `probe()` below sidesteps this: it asks the shell to PRINT a
//    marker it never received as a contiguous substring (string concatenation), so the only way
//    that exact substring can appear in the output stream is if PowerShell actually executed the
//    command and printed the real result.

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { PtySession } from './ptySession';

const REAL_CWD = process.cwd();
const TEST_TIMEOUT_MS = 20000;

let sandboxDir: string;
let savedAppData: string | undefined;
let savedUserProfile: string | undefined;
let savedHome: string | undefined;

beforeAll(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), 'maestro-terminal-pty-test-'));
  savedAppData = process.env.APPDATA;
  savedUserProfile = process.env.USERPROFILE;
  savedHome = process.env.HOME;
  process.env.APPDATA = sandboxDir;
  process.env.USERPROFILE = sandboxDir;
  process.env.HOME = sandboxDir;
});

afterAll(async () => {
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  // A just-killed pwsh.exe can hold this directory open for a moment on Windows (node-pty's
  // kill() is not synchronous -- see ws.test.ts's header). fs.rmSync's retry options are
  // unreliable on Windows (confirmed empirically in ws.test.ts); the async fs/promises `rm` is
  // the one that actually retries.
  await rm(sandboxDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}, 30000);

let session: PtySession | null = null;

afterEach(async () => {
  session?.stop();
  // Awaited so this suite never leaves a real orphaned pwsh.exe behind -- see ptySession.ts's
  // header on why stop() returning is not the same moment the real OS process is actually gone.
  await session?.waitForExit();
  session = null;
}, 15000);

/** A PowerShell fragment that PRINTS `marker` without ever containing it as a contiguous substring
 * in the command text itself -- see this file's header, point 2. */
function probeCommand(marker: string): string {
  const mid = Math.floor(marker.length / 2) || 1;
  const left = marker.slice(0, mid);
  const right = marker.slice(mid);
  return `Write-Output ("${left}" + "${right}")`;
}

function waitForOutputContaining(target: PtySession, needle: string, timeoutMs = TEST_TIMEOUT_MS): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let collected = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for output containing ${JSON.stringify(needle)}; got ${JSON.stringify(collected)}`)), timeoutMs);
    const unsubscribe = target.subscribe((chunk) => {
      if (chunk.length === 0) return; // exit sentinel, not real output
      collected += chunk.toString('utf8');
      if (collected.includes(needle)) {
        clearTimeout(timer);
        unsubscribe();
        resolvePromise(collected);
      }
    });
  });
}

function waitForExit(target: PtySession, timeoutMs = TEST_TIMEOUT_MS): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for exit')), timeoutMs);
    const unsubscribe = target.subscribe((chunk) => {
      if (chunk.length === 0) {
        clearTimeout(timer);
        unsubscribe();
        resolvePromise(target.exitCode ?? -1);
      }
    });
  });
}

describe('PtySession (real PTY, no mocks)', () => {
  test('spawns a real shell and a real "echo hello" comes back through the subscribe stream', async () => {
    session = new PtySession('ws-echo', 1, REAL_CWD);
    session.start();
    expect(session.running).toBe(true);
    expect(session.shell.length).toBeGreaterThan(0);

    const marker = 'hello-from-real-pty';
    const output = waitForOutputContaining(session, marker);
    session.write(Buffer.from(`${probeCommand(marker)}\r\n`, 'utf8'));
    const collected = await output;
    expect(collected).toContain(marker);
  }, TEST_TIMEOUT_MS);

  test('resize does not throw and the shell keeps producing real output afterward', async () => {
    session = new PtySession('ws-resize', 1, REAL_CWD);
    session.start();
    const beforeMarker = 'before-resize-marker';
    const initial = waitForOutputContaining(session, beforeMarker);
    session.write(Buffer.from(`${probeCommand(beforeMarker)}\r\n`, 'utf8'));
    await initial;

    expect(() => session?.resize(120, 40)).not.toThrow();

    const afterMarker = 'after-resize-marker';
    const after = waitForOutputContaining(session, afterMarker);
    session.write(Buffer.from(`${probeCommand(afterMarker)}\r\n`, 'utf8'));
    await after;
    expect(session.running).toBe(true);
  }, TEST_TIMEOUT_MS);

  test('the shell exiting flips running to false, sets exitCode, and broadcasts the empty sentinel', async () => {
    session = new PtySession('ws-exit', 1, REAL_CWD);
    session.start();
    const exitCode = await Promise.all([
      waitForExit(session),
      (async () => session?.write(Buffer.from('exit 0\r\n', 'utf8')))(),
    ]).then(([code]) => code);
    expect(session.running).toBe(false);
    expect(exitCode).toBe(0);
    expect(session.exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  test('subscribe() replays the ring buffer synchronously to a late subscriber', async () => {
    session = new PtySession('ws-replay', 1, REAL_CWD);
    session.start();
    const marker = 'replay-only-marker';
    const firstSeen = waitForOutputContaining(session, marker);
    session.write(Buffer.from(`${probeCommand(marker)}\r\n`, 'utf8'));
    await firstSeen;

    // A second, later subscriber must see the same already-happened output on subscribe, not just
    // whatever arrives after it joins -- this is the whole reconnect contract (pty_session.py's
    // module doc: "outliving the sockets that watch it").
    let replayed = '';
    const unsubscribe = session.subscribe((chunk) => {
      replayed += chunk.toString('utf8');
    });
    unsubscribe();
    expect(replayed).toContain(marker);
  }, TEST_TIMEOUT_MS);

  test('the terminal env scrubs provider credentials before the real shell ever sees them', async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'should-never-reach-the-shell';
    try {
      session = new PtySession('ws-env', 1, REAL_CWD);
      session.start();
      const marker = 'envcheck-marker';
      const output = waitForOutputContaining(session, marker);
      session.write(Buffer.from(`Write-Output ("${marker.slice(0, 8)}" + "${marker.slice(8)}" + "=[" + $env:ANTHROPIC_API_KEY + "]")\r\n`, 'utf8'));
      const collected = await output;
      expect(collected).toContain(`${marker}=[]`);
      expect(collected).not.toContain('should-never-reach-the-shell');
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  }, TEST_TIMEOUT_MS);
});
