"""Built-in spam/rate guards so the shim paces itself like a human.

Two layers: a global minimum gap between any two requests (with jitter), and
per-action token buckets that cap bursty writes (vote/comment/submit/compose).
It also honors Reddit's X-Ratelimit-* response headers and backs off on 429.
Local, per-process; the whole point is to never look like a bot hammering.
"""

import random
import threading
import time

# action -> (bucket_capacity, seconds_to_refill_one_token). Reads are generous; writes are deliberately slow.
BUCKETS: dict[str, tuple[float, float]] = {
    "read": (30.0, 1.0),
    "vote": (10.0, 3.0),
    "comment": (5.0, 12.0),
    "submit": (3.0, 60.0),
    "compose": (3.0, 30.0),
    "subscribe": (10.0, 3.0),
    "save": (15.0, 2.0),
}
GLOBAL_MIN_GAP_S = 0.8
GLOBAL_JITTER_S = 0.6

p_lock = threading.Lock()
p_tokens: dict[str, tuple[float, float]] = {}
p_last_request_ts = 0.0
p_backoff_until = 0.0


def bucket_for(action: str) -> str:
    return action if action in BUCKETS else "read"


def acquire(action: str) -> None:
    """Block until it's polite to make a request of this action class."""
    global p_last_request_ts
    bucket = bucket_for(action)
    cap, refill = BUCKETS[bucket]
    while True:
        with p_lock:
            now = time.time()
            tokens, last = p_tokens.get(bucket, (cap, now))
            tokens = min(cap, tokens + (now - last) / refill)
            wait = max(0.0, p_backoff_until - now, (p_last_request_ts + GLOBAL_MIN_GAP_S) - now)
            if wait <= 0 and tokens >= 1.0:
                p_tokens[bucket] = (tokens - 1.0, now)
                p_last_request_ts = now
                break
            if tokens < 1.0:
                wait = max(wait, (1.0 - tokens) * refill)
            p_tokens[bucket] = (tokens, now)
        time.sleep(min(wait, 5.0) + random.uniform(0.0, GLOBAL_JITTER_S))


def note_response(status: int, headers: dict) -> None:
    """Feed response signals back: a 429 or a drained X-Ratelimit means back off."""
    global p_backoff_until
    retry_after = 0.0
    if status == 429:
        retry_after = p_to_float(headers.get("retry-after")) or 5.0
    remaining = p_to_float(headers.get("x-ratelimit-remaining"))
    reset = p_to_float(headers.get("x-ratelimit-reset"))
    if remaining is not None and remaining <= 1.0 and reset:
        retry_after = max(retry_after, reset)
    if retry_after > 0:
        with p_lock:
            p_backoff_until = max(p_backoff_until, time.time() + retry_after)


def p_to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
