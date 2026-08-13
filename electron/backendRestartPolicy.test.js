// Run: node --test electron/backendRestartPolicy.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  RESTART_MAX_DELAY_MS,
  backoffDelayMs,
  decideRestart,
} = require('./backendRestartPolicy');

test('an unexpected exit restarts', () => {
  const d = decideRestart({ attemptTimestamps: [] });
  assert.equal(d.restart, true);
  assert.equal(d.exhausted, false);
  assert.ok(d.delayMs > 0, 'first restart must still be delayed, never immediate');
});

test('a clean intentional quit does NOT restart', () => {
  assert.equal(decideRestart({ intentional: true }).restart, false);
  assert.equal(decideRestart({ quitting: true }).restart, false);
  // And it must not be reported as exhaustion, which would show the user a failure dialog on a normal quit.
  assert.equal(decideRestart({ intentional: true }).exhausted, false);
  assert.equal(decideRestart({ quitting: true }).exhausted, false);
});

test('an update install does NOT restart, so the swap is not fought', () => {
  const d = decideRestart({ installingUpdate: true });
  assert.equal(d.restart, false);
  assert.equal(d.exhausted, false);
});

test('the intentional veto wins even with budget left', () => {
  assert.equal(decideRestart({ intentional: true, attemptTimestamps: [] }).restart, false);
});

test('the bound is enforced: the attempt after the last one is refused', () => {
  const now = Date.now();
  const used = [];
  for (let i = 0; i < MAX_RESTARTS; i++) used.push(now - 1000 * (i + 1));
  const d = decideRestart({ attemptTimestamps: used, now });
  assert.equal(d.restart, false);
  assert.equal(d.exhausted, true, 'exhaustion must be distinguishable so the user can be told');
});

test('one attempt below the bound still restarts', () => {
  const now = Date.now();
  const used = [];
  for (let i = 0; i < MAX_RESTARTS - 1; i++) used.push(now - 1000 * (i + 1));
  assert.equal(decideRestart({ attemptTimestamps: used, now }).restart, true);
});

test('attempts outside the window do not count against the budget', () => {
  const now = Date.now();
  const stale = [];
  for (let i = 0; i < MAX_RESTARTS * 3; i++) stale.push(now - RESTART_WINDOW_MS - 1000 * (i + 1));
  const d = decideRestart({ attemptTimestamps: stale, now });
  assert.equal(d.restart, true);
  assert.equal(d.exhausted, false);
});

test('backoff grows and is capped, so restarts can never hot-loop', () => {
  assert.ok(backoffDelayMs(0) < backoffDelayMs(1));
  assert.ok(backoffDelayMs(1) < backoffDelayMs(2));
  assert.equal(backoffDelayMs(99), RESTART_MAX_DELAY_MS);
  // Every delay across the whole budget must be a real wait.
  for (let i = 0; i < MAX_RESTARTS; i++) assert.ok(backoffDelayMs(i) >= 1000);
});

test('the successive delays a real crash loop would see', () => {
  const now = Date.now();
  const used = [];
  const delays = [];
  for (let i = 0; i < MAX_RESTARTS; i++) {
    const d = decideRestart({ attemptTimestamps: used, now });
    assert.equal(d.restart, true, `attempt ${i + 1} should be allowed`);
    delays.push(d.delayMs);
    used.push(now - 1);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  assert.equal(decideRestart({ attemptTimestamps: used, now }).exhausted, true);
});
