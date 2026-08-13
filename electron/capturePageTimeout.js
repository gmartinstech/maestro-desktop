// A webContents whose renderer is wedged (or a guest that never composited a frame) leaves
// capturePage pending forever. The renderer awaiting ipcRenderer.invoke('capture-page') has no
// timeout of its own, so that await never settles and the caller hangs. 3000ms: a real capture is
// tens of milliseconds, and this path only feeds cosmetic previews, so failing fast and keeping
// the last good thumbnail beats an await that never returns.
const CAPTURE_PAGE_TIMEOUT_MS = 3000;

// Reject if `promise` has not settled within `ms`. The loser stays pending on purpose (there is no
// capture-cancel API); clearing the timer is what keeps repeated calls from leaking a handle each.
function withCaptureTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`capturePage timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { CAPTURE_PAGE_TIMEOUT_MS, withCaptureTimeout };
