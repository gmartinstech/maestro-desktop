// engine/src/apps/terminal/manager.test.ts -- exercises PtySessionManager against REAL spawned
// PTYs (no mocking of node-pty), same empirical standard the rest of this codebase holds itself
// to. Idle/eviction timing uses the injectable `now` clock (manager.ts's constructor param)
// instead of vitest's fake timers -- faking global setTimeout/setImmediate would also stall
// node-pty's own internal readiness bookkeeping (see manager.ts's class doc).
//
// Every test kills every session it spawns via afterEach's stopAll(), per this ticket's own
// "kill every PTY you spawn" requirement.
//
// beforeAll/afterAll sandbox APPDATA/USERPROFILE/HOME to a throwaway temp dir for this file's real
// shells, same as ptySession.test.ts's header explains in detail -- a real spawned pwsh.exe
// otherwise persists every command it sees to the actual developer's PSReadLine history file.

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { PtySessionManager } from './manager';

const REAL_CWD = process.cwd();

let mgr: PtySessionManager;
let fakeNow = 0;
let sandboxDir: string;
let savedAppData: string | undefined;
let savedUserProfile: string | undefined;
let savedHome: string | undefined;

function advance(ms: number): void {
  fakeNow += ms;
}

beforeAll(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), 'maestro-terminal-manager-test-'));
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

afterEach(async () => {
  // Awaited: stopAll() now waits for each real OS process to confirm exit (bounded) -- see
  // ptySession.ts's header on why fire-and-forget can leak a real orphaned pwsh.exe on Windows.
  const killed = await mgr.stopAll();
  // Not an assertion -- just visibility into how many real shells this suite tore down, useful
  // when eyeballing CI output for the "kill every PTY" bar.
  if (killed > 0) console.log(`[test] manager.test.ts afterEach: killed ${killed} shells`);
}, 30000);

describe('PtySessionManager', () => {
  test('attach spawns a real session and get() finds it by (workspaceId, instance)', () => {
    mgr = new PtySessionManager();
    const session = mgr.attach('ws-a', 1, REAL_CWD);
    expect(session.running).toBe(true);
    expect(mgr.get('ws-a', 1)).toBe(session);
  });

  test('a second attach on the same key returns the SAME session, does not respawn', () => {
    mgr = new PtySessionManager();
    const first = mgr.attach('ws-b', 1, REAL_CWD);
    const second = mgr.attach('ws-b', 1, REAL_CWD);
    expect(second).toBe(first);
  });

  test('different instances of the same workspace are independent sessions', () => {
    mgr = new PtySessionManager();
    const one = mgr.attach('ws-c', 1, REAL_CWD);
    const two = mgr.attach('ws-c', 2, REAL_CWD);
    expect(one).not.toBe(two);
  });

  test('detach drops the reference but does NOT stop the session', () => {
    mgr = new PtySessionManager();
    const session = mgr.attach('ws-d', 1, REAL_CWD);
    mgr.detach('ws-d', 1);
    expect(session.running).toBe(true);
    expect(mgr.get('ws-d', 1)).toBe(session);
  });

  test('stopAll kills every live session, waits for real exit confirmation, and returns the count killed', async () => {
    mgr = new PtySessionManager();
    const a = mgr.attach('ws-e', 1, REAL_CWD);
    const b = mgr.attach('ws-f', 1, REAL_CWD);
    const killed = await mgr.stopAll();
    expect(killed).toBe(2);
    expect(a.running).toBe(false);
    expect(b.running).toBe(false);
    expect(mgr.get('ws-e', 1)).toBeUndefined();
  }, 15000);

  test('sweepIdle kills unreferenced sessions past the idle window, leaves referenced ones running', () => {
    fakeNow = 0;
    mgr = new PtySessionManager(() => fakeNow);
    const idle = mgr.attach('ws-idle', 1, REAL_CWD);
    mgr.detach('ws-idle', 1); // refcount -> 0, eligible once stale
    const active = mgr.attach('ws-active', 1, REAL_CWD); // refcount stays 1, never detached

    advance(31 * 60 * 1000); // past the 30-minute idle window
    const swept = mgr.sweepIdle();

    expect(swept).toBe(1);
    expect(idle.running).toBe(false);
    expect(mgr.get('ws-idle', 1)).toBeUndefined();
    expect(active.running).toBe(true);
    expect(mgr.get('ws-active', 1)).toBe(active);
  }, 20000);

  test('sweepIdle leaves an idle session alone before the window elapses', () => {
    fakeNow = 0;
    mgr = new PtySessionManager(() => fakeNow);
    const idle = mgr.attach('ws-too-soon', 1, REAL_CWD);
    mgr.detach('ws-too-soon', 1);

    advance(5 * 60 * 1000); // well under the 30-minute window
    const swept = mgr.sweepIdle();

    expect(swept).toBe(0);
    expect(idle.running).toBe(true);
  }, 10000);

  test('the live-session cap (8) evicts the oldest idle session, never one still referenced', () => {
    fakeNow = 0;
    mgr = new PtySessionManager(() => fakeNow);
    const firstEight: ReturnType<PtySessionManager['attach']>[] = [];
    for (let i = 0; i < 8; i++) {
      const session = mgr.attach(`ws-cap-${i}`, 1, REAL_CWD);
      mgr.detach(`ws-cap-${i}`, 1); // idle, refcount 0 -- eviction-eligible
      firstEight.push(session);
      advance(1000); // stagger lastUsed so there is one unambiguous oldest
    }

    // The 9th attach must evict ws-cap-0 (oldest idle) to stay under the cap.
    const ninth = mgr.attach('ws-cap-8', 1, REAL_CWD);

    expect(firstEight[0].running).toBe(false);
    expect(mgr.get('ws-cap-0', 1)).toBeUndefined();
    expect(ninth.running).toBe(true);
    // The rest of the original eight are untouched -- only the single oldest was evicted.
    expect(firstEight[1].running).toBe(true);
  }, 30000);

  test('the cap never kills a session that is still actively referenced', () => {
    fakeNow = 0;
    mgr = new PtySessionManager(() => fakeNow);
    // All 8 stay referenced (never detached) -- the manager must exceed the cap rather than kill
    // a shell someone is typing in.
    const referenced: ReturnType<PtySessionManager['attach']>[] = [];
    for (let i = 0; i < 8; i++) {
      referenced.push(mgr.attach(`ws-ref-${i}`, 1, REAL_CWD));
      advance(1000);
    }
    const ninth = mgr.attach('ws-ref-8', 1, REAL_CWD);
    expect(referenced.every((s) => s.running)).toBe(true);
    expect(ninth.running).toBe(true);
  }, 30000);
});
