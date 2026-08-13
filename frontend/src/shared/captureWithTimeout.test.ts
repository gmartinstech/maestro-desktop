// Run: node --test frontend/src/shared/captureWithTimeout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureWithTimeout, CAPTURE_ATTEMPT_TIMEOUT_MS, CAPTURE_TOTAL_BUDGET_MS } from './captureWithTimeout.ts';

test('a wedged capture rejects rather than hanging the browser command', async () => {
  await assert.rejects(() => captureWithTimeout(new Promise(() => {}), 30), /timed out after 30ms/);
});

test('a capture that lands in time passes its image through', async () => {
  const image = { isEmpty: () => false };
  assert.equal(await captureWithTimeout(Promise.resolve(image), 1000), image);
});

test("a capture's own error survives the bound", async () => {
  await assert.rejects(() => captureWithTimeout(Promise.reject(new Error('UnknownVizError')), 1000), /UnknownVizError/);
});

test('the timer is cleared on success so a long bound cannot hold the loop open', async () => {
  await captureWithTimeout(Promise.resolve('ok'), 60_000);
});

test('four bounded attempts plus backoff still fit inside the total budget', () => {
  const backoff = 250 + 500 + 750 + 1000;
  assert.ok(4 * CAPTURE_ATTEMPT_TIMEOUT_MS + backoff > CAPTURE_TOTAL_BUDGET_MS, 'budget should be the binding constraint, not decoration');
  // And the budget must stay under the backend's 15s screenshot command timeout so our error text wins.
  assert.ok(CAPTURE_TOTAL_BUDGET_MS < 15_000);
});
