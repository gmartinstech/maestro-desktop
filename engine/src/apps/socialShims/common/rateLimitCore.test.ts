import { describe, expect, test } from 'vitest';
import { RateLimiter, type RateLimiterDeps } from './rateLimitCore';

function fakeDeps(startAt = 0): RateLimiterDeps & { advance: (s: number) => void; sleeps: number[] } {
  let clock = startAt;
  const sleeps: number[] = [];
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms / 1000; // a fake sleep also advances the fake clock, so acquire() converges
    },
    random: () => 0, // no jitter, deterministic
    advance: (s: number) => {
      clock += s;
    },
    sleeps,
  };
}

describe('RateLimiter', () => {
  test('bucketFor falls back to "read" for an unknown action', () => {
    const rl = new RateLimiter({ read: [10, 1] });
    expect(rl.bucketFor('read')).toBe('read');
    expect(rl.bucketFor('nonsense')).toBe('read');
  });

  test('acquire resolves immediately when a full bucket + no min-gap elapsed', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ read: [5, 1] }, 0, 0, deps);
    await rl.acquire('read');
    expect(deps.sleeps.length).toBe(0);
  });

  test('acquire enforces the min-gap between two calls of the same bucket', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ read: [5, 1] }, 0.8, 0, deps);
    await rl.acquire('read');
    await rl.acquire('read');
    expect(deps.sleeps.length).toBeGreaterThan(0);
  });

  test('acquire drains the bucket then waits for refill once tokens run out', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ write: [2, 3] }, 0, 0, deps);
    await rl.acquire('write');
    await rl.acquire('write');
    // third call: bucket empty, must wait ~3s (one token's refill time) before granting.
    await rl.acquire('write');
    expect(deps.sleeps.some((ms) => ms >= 1000)).toBe(true);
  });

  test('noteResponse(429) sets a backoff that a subsequent acquire respects (each sleep capped at 5s, so it takes two)', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ read: [5, 1] }, 0, 0, deps);
    rl.noteResponse(429, { 'retry-after': '10' });
    await rl.acquire('read');
    const total = deps.sleeps.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(9000);
    expect(deps.sleeps.every((ms) => ms <= 5000)).toBe(true);
  });

  test('noteResponse honors x-ratelimit-remaining<=1 + x-ratelimit-reset even without a 429', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ read: [5, 1] }, 0, 0, deps);
    rl.noteResponse(200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4' });
    await rl.acquire('read');
    expect(deps.sleeps.some((ms) => ms >= 3000)).toBe(true);
  });

  test('noteResponse(200) with healthy headers sets no backoff', async () => {
    const deps = fakeDeps();
    const rl = new RateLimiter({ read: [5, 1] }, 0, 0, deps);
    rl.noteResponse(200, { 'x-ratelimit-remaining': '50' });
    await rl.acquire('read');
    expect(deps.sleeps.length).toBe(0);
  });

  test('defaultRateLimiterDeps grants a fresh limiter\'s very first acquire immediately (real clock/sleep, no fake timers)', async () => {
    const rl = new RateLimiter({ read: [5, 1] });
    const start = Date.now();
    await rl.acquire('read');
    expect(Date.now() - start).toBeLessThan(200);
  });
});
