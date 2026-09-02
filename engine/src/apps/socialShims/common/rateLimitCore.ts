// engine/src/apps/socialShims/common/rateLimitCore.ts -- SUB-9, a full port of
// backend/apps/social_shims/rate_limit_core.py's RateLimiter: one global minimum gap between any
// two requests (jittered), plus per-action token buckets that cap bursty writes, plus honoring the
// site's X-Ratelimit-* headers and 429 backoff. Per-process, per-instance state; each shim builds
// its own limiter with its own buckets. The whole point is to never look like a bot hammering an
// endpoint.
//
// The Python original is a plain class holding a lock + mutable runtime counters (not a pydantic
// model): a real thread can block inside acquire() while another thread mutates shared state. This
// engine has no threads -- each social shim subprocess is single-threaded Node running one MCP
// tools/call at a time (server.ts/mcpStdioServer.ts processes one stdio line, awaits its handler,
// then reads the next) -- so there is no concurrent-mutation hazard to guard with a lock, and
// acquire() blocks the async event loop via a `setTimeout`-based sleep instead of the Python
// original's blocking `time.sleep` in a real OS thread. Every other behavior (token math, jitter,
// backoff-until, note_response's header-driven back-off) is unchanged.

export type RateBuckets = Readonly<Record<string, readonly [capacity: number, refillSeconds: number]>>;

function toFloat(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateLimiterDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export function defaultRateLimiterDeps(): RateLimiterDeps {
  return { now: () => Date.now() / 1000, sleep, random: () => Math.random() };
}

/** Token-bucket + global-gap + backoff pacer, configured per platform. */
export class RateLimiter {
  private readonly buckets: RateBuckets;
  private readonly minGapS: number;
  private readonly jitterS: number;
  private readonly deps: RateLimiterDeps;
  private tokens: Map<string, [tokens: number, lastRefill: number]> = new Map();
  private lastRequestTs = 0;
  private backoffUntil = 0;

  constructor(buckets: RateBuckets, minGapS = 0.8, jitterS = 0.6, deps: RateLimiterDeps = defaultRateLimiterDeps()) {
    this.buckets = buckets;
    this.minGapS = minGapS;
    this.jitterS = jitterS;
    this.deps = deps;
  }

  bucketFor(action: string): string {
    return action in this.buckets ? action : 'read';
  }

  /** Resolve (asynchronously waiting as needed) once it is polite to make a request of this
   * action class -- direct twin of the Python original's `acquire()`, minus the lock (see this
   * file's header for why one isn't needed here). */
  async acquire(action: string): Promise<void> {
    const bucket = this.bucketFor(action);
    const [cap, refill] = this.buckets[bucket];
    for (;;) {
      const now = this.deps.now();
      const [prevTokens, last] = this.tokens.get(bucket) ?? [cap, now];
      const tokens = Math.min(cap, prevTokens + (now - last) / refill);
      let wait = Math.max(0, this.backoffUntil - now, this.lastRequestTs + this.minGapS - now);
      if (wait <= 0 && tokens >= 1.0) {
        this.tokens.set(bucket, [tokens - 1.0, now]);
        this.lastRequestTs = now;
        return;
      }
      if (tokens < 1.0) wait = Math.max(wait, (1.0 - tokens) * refill);
      this.tokens.set(bucket, [tokens, now]);
      await this.deps.sleep((Math.min(wait, 5.0) + this.deps.random() * this.jitterS) * 1000);
    }
  }

  /** Feed response signals back: a 429 or a drained X-Ratelimit means back off. */
  noteResponse(status: number, headers: Record<string, string>): void {
    let retryAfter = 0;
    if (status === 429) retryAfter = toFloat(headers['retry-after']) ?? 5.0;
    const remaining = toFloat(headers['x-ratelimit-remaining']);
    const reset = toFloat(headers['x-ratelimit-reset']);
    if (remaining !== undefined && remaining <= 1.0 && reset) retryAfter = Math.max(retryAfter, reset);
    if (retryAfter > 0) this.backoffUntil = Math.max(this.backoffUntil, this.deps.now() + retryAfter);
  }
}
