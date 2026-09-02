// engine/src/apps/socialShims/reddit/rateLimit.ts -- SUB-9, a full port of
// backend/apps/reddit_mcp_shim/rate_limit.py: Reddit's per-action pacing config on top of the
// shared RateLimiter. Reads are generous; writes (vote/comment/submit/compose) are deliberately
// slow so the account never looks like a bot.

import { RateLimiter, type RateBuckets, type RateLimiterDeps } from '../common/rateLimitCore';

// action -> (bucket_capacity, seconds_to_refill_one_token). Reads generous; writes deliberately slow.
export const BUCKETS: RateBuckets = {
  read: [30.0, 1.0],
  vote: [10.0, 3.0],
  comment: [5.0, 12.0],
  submit: [3.0, 60.0],
  compose: [3.0, 30.0],
  subscribe: [10.0, 3.0],
  save: [15.0, 2.0],
};

let limiter = new RateLimiter(BUCKETS, 0.8, 0.6);

export function acquire(action: string): Promise<void> {
  return limiter.acquire(action);
}

export function noteResponse(status: number, headers: Record<string, string>): void {
  limiter.noteResponse(status, headers);
}

export function bucketFor(action: string): string {
  return limiter.bucketFor(action);
}

/** Exported for tests only -- replaces the shared limiter with a fresh one, so one test's
 * noteResponse()-driven backoff (or drained buckets) can never bleed real wall-clock delay into
 * the next test via this module-level singleton (matches every other social-shim module's own
 * resetXForTest convention, e.g. sessionSource.ts's resetSessionCacheForTest). Pass `deps` (e.g. a
 * fake clock/sleep, see rateLimitCore.test.ts's own fakeDeps) so a real-HTTP-mocked test doesn't
 * also have to pay real wall-clock time for every acquire() -- production code never passes this. */
export function resetRateLimiterForTest(deps?: RateLimiterDeps): void {
  limiter = deps ? new RateLimiter(BUCKETS, 0.8, 0.6, deps) : new RateLimiter(BUCKETS, 0.8, 0.6);
}
