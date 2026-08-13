// Decides whether an exited Python backend should be respawned. Pure policy, no Electron and no
// process handling, so the two properties that actually matter are unit-testable: a clean quit
// never restarts, and a chronically dying backend stops being restarted.
//
// An unbounded hot restart loop is WORSE than staying down -- it hammers ports, fills backend.log,
// and buries the real error under a thousand spawn traces -- so the bound is small and the delay
// grows. Once it is exhausted the caller tells the user rather than leaving a dead shell open.

// 4 tries covers the real transient causes (a port that freed a moment later, a killed child, an
// OOM under a passing memory spike). Anything that survives four attempts is a bug a retry cannot fix.
const MAX_RESTARTS = 4;
// Attempts older than this stop counting, so an app left open for a week does not permanently
// exhaust its budget on one bad afternoon.
const RESTART_WINDOW_MS = 10 * 60 * 1000;
// 1s, 2s, 4s, 8s. The first is fast enough that the user may not notice; the last is slow enough
// that a hard-failing backend cannot spin.
const RESTART_BASE_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 8000;

function backoffDelayMs(attempt) {
  const scaled = RESTART_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt));
  return Math.min(scaled, RESTART_MAX_DELAY_MS);
}

// `attemptTimestamps` are epoch ms of previous restarts; only those inside the window count.
function recentAttempts(attemptTimestamps, now = Date.now()) {
  const cutoff = now - RESTART_WINDOW_MS;
  return attemptTimestamps.filter((t) => t > cutoff);
}

/**
 * @param {{ intentional?: boolean, quitting?: boolean, installingUpdate?: boolean,
 *           attemptTimestamps?: number[], now?: number }} ctx
 * @returns {{ restart: boolean, delayMs: number, exhausted: boolean, reason: string }}
 */
function decideRestart(ctx = {}) {
  const attempts = recentAttempts(ctx.attemptTimestamps || [], ctx.now);
  // Three separate ways an exit is intentional; all must veto, because a restart here would fight
  // our own shutdown (respawning Python while will-quit is tearing it down) or strand an update swap.
  if (ctx.intentional) return { restart: false, delayMs: 0, exhausted: false, reason: 'we killed it' };
  if (ctx.quitting) return { restart: false, delayMs: 0, exhausted: false, reason: 'app is quitting' };
  if (ctx.installingUpdate) return { restart: false, delayMs: 0, exhausted: false, reason: 'update install in progress' };
  if (attempts.length >= MAX_RESTARTS) {
    return { restart: false, delayMs: 0, exhausted: true, reason: `${attempts.length} restarts within the window` };
  }
  return {
    restart: true,
    delayMs: backoffDelayMs(attempts.length),
    exhausted: false,
    reason: 'unexpected exit',
  };
}

module.exports = {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  RESTART_BASE_DELAY_MS,
  RESTART_MAX_DELAY_MS,
  backoffDelayMs,
  recentAttempts,
  decideRestart,
};
