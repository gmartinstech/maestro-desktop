// Decides whether an exited Python backend sidecar should be respawned. Pure policy, no process
// handling, so the two properties that actually matter are unit-testable: a clean quit never
// restarts, and a chronically dying backend stops being restarted.
//
// Ported 1:1 from electron/backendRestartPolicy.js (constants, `backoffDelayMs`,
// `recentAttempts`, `decideRestart`) so the JS and Rust supervisors make identical decisions for
// identical inputs. See that file's header comment for the full rationale; kept brief here to
// avoid drifting out of sync with two copies of the same explanation.
//
// An unbounded hot restart loop is WORSE than staying down -- it hammers ports, fills
// backend.log, and buries the real error under a thousand spawn traces -- so the bound is small
// and the delay grows. Once it is exhausted the caller tells the user rather than leaving a dead
// shell open.

// 4 tries covers the real transient causes (a port that freed a moment later, a killed child, an
// OOM under a passing memory spike). Anything that survives four attempts is a bug a retry cannot fix.
pub const MAX_RESTARTS: u32 = 4;
// Attempts older than this stop counting, so an app left open for a week does not permanently
// exhaust its budget on one bad afternoon.
pub const RESTART_WINDOW_MS: i64 = 10 * 60 * 1000;
// 1s, 2s, 4s, 8s. The first is fast enough that the user may not notice; the last is slow enough
// that a hard-failing backend cannot spin.
pub const RESTART_BASE_DELAY_MS: u64 = 1000;
pub const RESTART_MAX_DELAY_MS: u64 = 8000;

pub fn backoff_delay_ms(attempt: u32) -> u64 {
    // JS: RESTART_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt)). `attempt` is unsigned here so
    // the Math.max(0, ...) guard has no Rust equivalent to port -- it can never be negative.
    let scaled = RESTART_BASE_DELAY_MS.saturating_mul(1u64 << attempt.min(63));
    scaled.min(RESTART_MAX_DELAY_MS)
}

/// `attempt_timestamps` are epoch ms of previous restarts; only those inside the window count.
pub fn recent_attempts(attempt_timestamps: &[i64], now: i64) -> Vec<i64> {
    let cutoff = now - RESTART_WINDOW_MS;
    attempt_timestamps
        .iter()
        .copied()
        .filter(|&t| t > cutoff)
        .collect()
}

/// Mirrors backendRestartPolicy.js's `ctx` param object.
#[derive(Default, Clone)]
pub struct RestartContext {
    pub intentional: bool,
    pub quitting: bool,
    pub installing_update: bool,
    pub attempt_timestamps: Vec<i64>,
    pub now: i64,
}

/// Mirrors backendRestartPolicy.js's return shape.
#[derive(Debug, PartialEq, Eq)]
pub struct RestartDecision {
    pub restart: bool,
    pub delay_ms: u64,
    pub exhausted: bool,
    pub reason: String,
}

pub fn decide_restart(ctx: &RestartContext) -> RestartDecision {
    let attempts = recent_attempts(&ctx.attempt_timestamps, ctx.now);
    // Three separate ways an exit is intentional; all must veto, because a restart here would
    // fight our own shutdown (respawning Python while the app is tearing down) or strand an
    // update swap.
    if ctx.intentional {
        return RestartDecision {
            restart: false,
            delay_ms: 0,
            exhausted: false,
            reason: "we killed it".to_string(),
        };
    }
    if ctx.quitting {
        return RestartDecision {
            restart: false,
            delay_ms: 0,
            exhausted: false,
            reason: "app is quitting".to_string(),
        };
    }
    if ctx.installing_update {
        return RestartDecision {
            restart: false,
            delay_ms: 0,
            exhausted: false,
            reason: "update install in progress".to_string(),
        };
    }
    if attempts.len() as u32 >= MAX_RESTARTS {
        return RestartDecision {
            restart: false,
            delay_ms: 0,
            exhausted: true,
            reason: format!("{} restarts within the window", attempts.len()),
        };
    }
    RestartDecision {
        restart: true,
        delay_ms: backoff_delay_ms(attempts.len() as u32),
        exhausted: false,
        reason: "unexpected exit".to_string(),
    }
}

#[cfg(test)]
mod tests {
    // Every test below is ported 1:1 from electron/backendRestartPolicy.test.js -- same name (as
    // a comment), same inputs, same expected `restart`/`exhausted`/`delayMs` outcomes. Run with
    // `cargo test`.
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    // "an unexpected exit restarts"
    #[test]
    fn an_unexpected_exit_restarts() {
        let ctx = RestartContext {
            attempt_timestamps: vec![],
            now: now_ms(),
            ..Default::default()
        };
        let d = decide_restart(&ctx);
        assert_eq!(d.restart, true);
        assert_eq!(d.exhausted, false);
        assert!(d.delay_ms > 0, "first restart must still be delayed, never immediate");
    }

    // "a clean intentional quit does NOT restart"
    #[test]
    fn a_clean_intentional_quit_does_not_restart() {
        let now = now_ms();
        let intentional = RestartContext { intentional: true, now, ..Default::default() };
        let quitting = RestartContext { quitting: true, now, ..Default::default() };
        assert_eq!(decide_restart(&intentional).restart, false);
        assert_eq!(decide_restart(&quitting).restart, false);
        // And it must not be reported as exhaustion, which would show the user a failure dialog
        // on a normal quit.
        assert_eq!(decide_restart(&intentional).exhausted, false);
        assert_eq!(decide_restart(&quitting).exhausted, false);
    }

    // "an update install does NOT restart, so the swap is not fought"
    #[test]
    fn an_update_install_does_not_restart() {
        let ctx = RestartContext { installing_update: true, now: now_ms(), ..Default::default() };
        let d = decide_restart(&ctx);
        assert_eq!(d.restart, false);
        assert_eq!(d.exhausted, false);
    }

    // "the intentional veto wins even with budget left"
    #[test]
    fn the_intentional_veto_wins_even_with_budget_left() {
        let ctx = RestartContext {
            intentional: true,
            attempt_timestamps: vec![],
            now: now_ms(),
            ..Default::default()
        };
        assert_eq!(decide_restart(&ctx).restart, false);
    }

    // "the bound is enforced: the attempt after the last one is refused"
    #[test]
    fn the_bound_is_enforced() {
        let now = now_ms();
        let mut used = vec![];
        for i in 0..MAX_RESTARTS {
            used.push(now - 1000 * (i as i64 + 1));
        }
        let ctx = RestartContext { attempt_timestamps: used, now, ..Default::default() };
        let d = decide_restart(&ctx);
        assert_eq!(d.restart, false);
        assert_eq!(d.exhausted, true, "exhaustion must be distinguishable so the user can be told");
    }

    // "one attempt below the bound still restarts"
    #[test]
    fn one_attempt_below_the_bound_still_restarts() {
        let now = now_ms();
        let mut used = vec![];
        for i in 0..(MAX_RESTARTS - 1) {
            used.push(now - 1000 * (i as i64 + 1));
        }
        let ctx = RestartContext { attempt_timestamps: used, now, ..Default::default() };
        assert_eq!(decide_restart(&ctx).restart, true);
    }

    // "attempts outside the window do not count against the budget"
    #[test]
    fn attempts_outside_the_window_do_not_count() {
        let now = now_ms();
        let mut stale = vec![];
        for i in 0..(MAX_RESTARTS * 3) {
            stale.push(now - RESTART_WINDOW_MS - 1000 * (i as i64 + 1));
        }
        let ctx = RestartContext { attempt_timestamps: stale, now, ..Default::default() };
        let d = decide_restart(&ctx);
        assert_eq!(d.restart, true);
        assert_eq!(d.exhausted, false);
    }

    // "backoff grows and is capped, so restarts can never hot-loop"
    #[test]
    fn backoff_grows_and_is_capped() {
        assert!(backoff_delay_ms(0) < backoff_delay_ms(1));
        assert!(backoff_delay_ms(1) < backoff_delay_ms(2));
        assert_eq!(backoff_delay_ms(99), RESTART_MAX_DELAY_MS);
        // Every delay across the whole budget must be a real wait.
        for i in 0..MAX_RESTARTS {
            assert!(backoff_delay_ms(i) >= 1000);
        }
    }

    // "the successive delays a real crash loop would see"
    #[test]
    fn the_successive_delays_a_real_crash_loop_would_see() {
        let now = now_ms();
        let mut used: Vec<i64> = vec![];
        let mut delays: Vec<u64> = vec![];
        for i in 0..MAX_RESTARTS {
            let ctx = RestartContext { attempt_timestamps: used.clone(), now, ..Default::default() };
            let d = decide_restart(&ctx);
            assert_eq!(d.restart, true, "attempt {} should be allowed", i + 1);
            delays.push(d.delay_ms);
            used.push(now - 1);
        }
        assert_eq!(delays, vec![1000, 2000, 4000, 8000]);
        let ctx = RestartContext { attempt_timestamps: used, now, ..Default::default() };
        assert_eq!(decide_restart(&ctx).exhausted, true);
    }
}
