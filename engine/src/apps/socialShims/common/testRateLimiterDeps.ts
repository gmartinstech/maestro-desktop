// engine/src/apps/socialShims/common/testRateLimiterDeps.ts -- SUB-9 test-only helper. Every
// social shim's own rateLimit.ts module keeps ONE process-wide RateLimiter singleton (matching the
// Python originals' own module-level `p_limiter`, real per-process pacing state) -- fine in
// production (one shim subprocess, one limiter, real human-pacing delays are the whole point), but
// a real limiter's real setTimeout-based waits would make the HTTP-layer unit tests pay real
// wall-clock seconds for rate-limiting behavior those tests aren't even testing. This gives each
// platform's own `resetXRateLimiterForTest()` a fake, self-consistent RateLimiterDeps: `now()` is a
// local fake clock, and `sleep()` advances that SAME clock instead of actually waiting, so acquire()
// converges in real time close to zero while every token-bucket/backoff CALCULATION still runs for
// real (this is not a stub of RateLimiter itself, only of wall-clock time).

import type { RateLimiterDeps } from './rateLimitCore';

export function fakeInstantRateLimiterDeps(startAt = 1_700_000_000): RateLimiterDeps {
  let clock = startAt;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms / 1000;
    },
    random: () => 0,
  };
}
