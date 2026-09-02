// engine/src/apps/socialShims/tiktok/rateLimit.ts -- SUB-9, a full port of
// backend/apps/tiktok_mcp_shim/rate_limit.py: TikTok's per-action pacing config on top of the
// shared RateLimiter. Reads are generous; likes/favorites moderate, comments/follows slow, so the
// account never bursts like a bot.

import { RateLimiter, type RateBuckets, type RateLimiterDeps } from '../common/rateLimitCore';

export const BUCKETS: RateBuckets = {
  read: [25.0, 1.0],
  like: [15.0, 3.0],
  favorite: [15.0, 3.0],
  comment: [5.0, 15.0],
  follow: [8.0, 8.0],
};

let limiter = new RateLimiter(BUCKETS, 1.2, 0.8);

export function acquire(action: string): Promise<void> {
  return limiter.acquire(action);
}

export function noteResponse(status: number, headers: Record<string, string>): void {
  limiter.noteResponse(status, headers);
}

export function bucketFor(action: string): string {
  return limiter.bucketFor(action);
}

/** Exported for tests only -- see reddit/rateLimit.ts's own resetRateLimiterForTest for why. */
export function resetRateLimiterForTest(deps?: RateLimiterDeps): void {
  limiter = deps ? new RateLimiter(BUCKETS, 1.2, 0.8, deps) : new RateLimiter(BUCKETS, 1.2, 0.8);
}
