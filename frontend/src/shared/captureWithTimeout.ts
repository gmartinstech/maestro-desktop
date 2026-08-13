// A half-initialised webview or a wedged renderer can leave capturePage pending FOREVER (Electron/Viz stops producing frames for an unpainted guest), and an unbounded await hangs the whole browser command with no error at all. This bounds one attempt so the caller can fail honestly.
export const CAPTURE_ATTEMPT_TIMEOUT_MS = 2500;
// Whole-retry-loop ceiling, deliberately under the backend's 15s screenshot command timeout so the agent receives OUR error text instead of a generic command timeout it cannot act on.
export const CAPTURE_TOTAL_BUDGET_MS = 10_000;

/** Reject if `promise` has not settled within `ms`. The loser is left pending on purpose: there is no capture-cancel API, and clearing the timer is what keeps repeated attempts from leaking a handle each. */
export function captureWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`capturePage timed out after ${ms}ms (renderer not producing frames)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
