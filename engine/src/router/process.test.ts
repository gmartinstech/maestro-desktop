// engine/src/router/process.test.ts -- ENG-6 gate: TS vitest port of
// backend/apps/nine_router/tests/test_process.py + backend/tests/test_router_watchdog.py's
// assertions, confirming identical pass/fail behavior for identical scenarios against the ported
// process.ts. One test from the Python original (`test_detection_revival_gated_on_evidence`) is
// deliberately NOT ported: it exercises `configure_provider_env.router_available`, an
// agents-manager function with no engine-side port yet (AGT phase, not ENG-6's scope) -- only the
// process.ts-internal assertions are in scope here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import * as proc from './process';

function resetRouterState(): void {
  proc.routerState.process = null;
  proc.routerState.isRunningLastOk = -Infinity;
  proc.routerState.isRunningLastChecked = -Infinity;
  proc.routerState.isRunningLastResult = false;
  proc.routerState.watchdogAbort = null;
  proc.routerState.watchdogRunning = false;
  proc.routerState.deathWatcherRunning = false;
  proc.routerState.deathWatcherAbort = null;
  proc.routerState.recentDeathMonos.length = 0;
}

beforeEach(() => {
  resetRouterState();
});

// -- test_process.py: is_running() negative-result caching --------------------------------------

describe('isRunning negative-result caching', () => {
  it('caches a negative result briefly', async () => {
    const tcpPortOpen = vi.fn().mockResolvedValue(false);
    const fetchModels = vi.fn();
    const first = await proc.isRunning({ tcpPortOpen, fetchModels });
    const second = await proc.isRunning({ tcpPortOpen, fetchModels });
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(tcpPortOpen).toHaveBeenCalledTimes(1);
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it('expires the negative cache after its TTL', async () => {
    proc.routerState.isRunningLastChecked = performance.now() - proc.IS_RUNNING_NEGATIVE_TTL_MS - 100;
    proc.routerState.isRunningLastResult = false;
    const tcpPortOpen = vi.fn().mockResolvedValue(false);
    const result = await proc.isRunning({ tcpPortOpen, fetchModels: vi.fn() });
    expect(result).toBe(false);
    expect(tcpPortOpen).toHaveBeenCalledTimes(1);
  });
});

// -- test_router_watchdog.py: watchdog_loop / death_watch / stop ---------------------------------

describe('watchdogLoop', () => {
  it('revives after two confirmations, then backs off after 3 straight failures', async () => {
    const sleeps: number[] = [];
    const ensures: number[] = [];
    const sleep = vi.fn(async (ms: number, signal: AbortSignal) => {
      if (signal.aborted) throw new proc.AbortSleepError();
      sleeps.push(ms);
    });
    const isRunningFake = vi.fn(async () => false);
    const ensureRunning = vi.fn(async () => {
      ensures.push(1);
    });
    const controller = new AbortController();
    const loopDone = proc.watchdogLoop(controller.signal, { sleep, isRunning: isRunningFake, ensureRunning });
    while (sleeps.length < 9) await Promise.resolve();
    controller.abort();
    await loopDone;
    expect(ensures.length).toBeGreaterThanOrEqual(2);
    expect(sleeps[0]).toBe(proc.WATCHDOG_INTERVAL_MS);
    expect(sleeps[1]).toBe(2000); // two-strike: a single failed probe must be re-confirmed before reviving
    expect(sleeps).toContain(proc.WATCHDOG_BACKOFF_MS); // 3 straight failures must back off
  });

  it('never revives on a single false-negative probe (busy-router flake)', async () => {
    const ensures: number[] = [];
    let probes = 0;
    const sleep = vi.fn(async (_ms: number, signal: AbortSignal) => {
      if (signal.aborted) throw new proc.AbortSleepError();
    });
    const isRunningFake = vi.fn(async () => {
      // First probe of each pulse fails (busy-router false negative); the confirm succeeds.
      probes += 1;
      return probes % 2 === 0;
    });
    const ensureRunning = vi.fn(async () => {
      ensures.push(1);
    });
    const controller = new AbortController();
    const loopDone = proc.watchdogLoop(controller.signal, { sleep, isRunning: isRunningFake, ensureRunning });
    while (probes < 8) await Promise.resolve();
    controller.abort();
    await loopDone;
    expect(ensures).toHaveLength(0);
  });

  it('never spawns while the router is healthy', async () => {
    const sleeps: number[] = [];
    const ensures: number[] = [];
    const sleep = vi.fn(async (ms: number, signal: AbortSignal) => {
      if (signal.aborted) throw new proc.AbortSleepError();
      sleeps.push(ms);
    });
    const isRunningFake = vi.fn(async () => true);
    const ensureRunning = vi.fn(async () => {
      ensures.push(1);
    });
    const controller = new AbortController();
    const loopDone = proc.watchdogLoop(controller.signal, { sleep, isRunning: isRunningFake, ensureRunning });
    while (sleeps.length < 4) await Promise.resolve();
    controller.abort();
    await loopDone;
    expect(ensures).toHaveLength(0);
    expect(sleeps.every((d) => d === proc.WATCHDOG_INTERVAL_MS)).toBe(true);
  });
});

class FakeChildProcess {
  exitCode: number | null = null;
  signalCode: string | null = null;
  private listeners = new Map<string, (() => void)[]>();
  once(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }
  removeListener(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((l) => l !== cb),
    );
  }
  die(): void {
    this.exitCode = 1;
    for (const cb of this.listeners.get('exit') ?? []) cb();
  }
}

describe('deathWatch', () => {
  it('does not revive while the process lives, revives instantly on death, then guards a crash loop', async () => {
    const ensures: number[] = [];
    const ensureRunning = vi.fn(async () => {
      ensures.push(1);
    });
    const fp = new FakeChildProcess();
    proc.routerState.process = fp as unknown as ChildProcess;
    const watchPromise = proc.deathWatch(fp as unknown as ChildProcess, { ensureRunning, now: () => performance.now() });
    await Promise.resolve();
    expect(ensures).toHaveLength(0); // no revive while the process lives
    fp.die();
    await watchPromise;
    expect(ensures.length).toBeGreaterThan(0); // process death must trigger an instant revive

    // Crash-loop guard: a 3rd death inside 60s defers to the watchdog.
    ensures.length = 0;
    const now = performance.now();
    proc.routerState.recentDeathMonos.splice(0, proc.routerState.recentDeathMonos.length, now - 5000, now - 3000);
    const fp2 = new FakeChildProcess();
    fp2.die();
    proc.routerState.process = fp2 as unknown as ChildProcess;
    await proc.deathWatch(fp2 as unknown as ChildProcess, { ensureRunning, now: () => performance.now() });
    expect(ensures).toHaveLength(0); // 3 deaths in 60s must defer to the backed-off watchdog

    // A superseded/stopped handle never revives.
    ensures.length = 0;
    proc.routerState.recentDeathMonos.length = 0;
    const fp3 = new FakeChildProcess();
    fp3.die();
    proc.routerState.process = null;
    await proc.deathWatch(fp3 as unknown as ChildProcess, { ensureRunning, now: () => performance.now() });
    expect(ensures).toHaveLength(0); // a deliberately stopped router must stay down
  });

  it('invalidates the FULL is_running cache, not just the positive slot', async () => {
    // Simulate a probe that succeeded moments ago (well inside both the positive AND the short
    // outcome-cache TTL), the realistic state right before a sudden crash.
    const now = performance.now();
    proc.routerState.isRunningLastOk = now;
    proc.routerState.isRunningLastChecked = now;
    proc.routerState.isRunningLastResult = true;
    const fp = new FakeChildProcess();
    proc.routerState.process = fp as unknown as ChildProcess;
    const watchPromise = proc.deathWatch(fp as unknown as ChildProcess, { ensureRunning: async () => undefined, now: () => performance.now() });
    fp.die();
    await watchPromise;
    // The crash must wipe the WHOLE outcome cache, not just isRunningLastOk, or a caller inside
    // the negative-cache window right after deathWatch reads back the stale True.
    const tcpPortOpen = vi.fn().mockResolvedValue(false);
    const result = await proc.isRunning({ tcpPortOpen, fetchModels: vi.fn() });
    expect(result).toBe(false); // a cached pre-crash True must never survive an instant revive
    expect(tcpPortOpen).toHaveBeenCalledTimes(1); // the cache wipe must force a real re-probe
  });
});

describe('stop()', () => {
  it('cancels the watchdog', async () => {
    proc.routerState.watchdogAbort = new AbortController();
    proc.routerState.watchdogRunning = true;
    await proc.stop();
    expect(proc.routerState.watchdogAbort).toBeNull();
  });

  it('aborts an in-flight deathWatch() before killing the process, so it never revives what stop() just tore down', async () => {
    // Regression test for a real race found via the live integration check (gate b): deathWatch()
    // and stop() both listen on the same child's 'exit' event; without an explicit abort, whichever
    // continuation's `routerState.process !== child` guard happened to run first was unspecified,
    // and stop() could lose that race -- observed as a stray revive logged AFTER stop() had
    // already returned.
    const ensures: number[] = [];
    const fp = new FakeChildProcess();
    proc.routerState.process = fp as unknown as ChildProcess;
    proc.routerState.deathWatcherAbort = new AbortController();
    const watchPromise = proc.deathWatch(fp as unknown as ChildProcess, { ensureRunning: async () => { ensures.push(1); }, now: () => performance.now() }, proc.routerState.deathWatcherAbort.signal);
    await proc.stop(); // aborts deathWatch, then kills fp (fp.kill is a no-op stub, so simulate the exit ourselves below)
    fp.die();
    await watchPromise;
    expect(ensures).toHaveLength(0); // an aborted death-watch must never revive
  });
});

describe('hasPersistedConnections', () => {
  let tmpDir: string;
  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    tmpDir = mkdtempSync(join(tmpdir(), 'maestro-9router-test-'));
    vi.stubEnv('DATA_DIR', tmpDir);
  });
  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('is false with no db, false with only inactive connections, true with an active one, and false on corrupt JSON', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(proc.hasPersistedConnections()).toBe(false);
    writeFileSync(join(tmpDir, 'db.json'), JSON.stringify({ providerConnections: [{ provider: 'claude', isActive: false }] }));
    expect(proc.hasPersistedConnections()).toBe(false);
    writeFileSync(join(tmpDir, 'db.json'), JSON.stringify({ providerConnections: [{ provider: 'claude', isActive: true }] }));
    expect(proc.hasPersistedConnections()).toBe(true);
    writeFileSync(join(tmpDir, 'db.json'), '{corrupt');
    expect(proc.hasPersistedConnections()).toBe(false);
  });
});
