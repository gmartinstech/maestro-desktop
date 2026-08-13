// Run: node --test electron/capturePageTimeout.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_PAGE_TIMEOUT_MS, withCaptureTimeout } = require('./capturePageTimeout');

test('a capture that never settles rejects instead of hanging forever', async () => {
  const wedged = new Promise(() => {});
  await assert.rejects(() => withCaptureTimeout(wedged, 30), /timed out after 30ms/);
});

test('a capture that resolves in time passes its value through', async () => {
  const image = { tag: 'native-image' };
  assert.equal(await withCaptureTimeout(Promise.resolve(image), 1000), image);
});

test('a capture that rejects keeps its own error, not the timeout error', async () => {
  const boom = Promise.reject(new Error('UnknownVizError'));
  await assert.rejects(() => withCaptureTimeout(boom, 1000), /UnknownVizError/);
});

test('the timer is cleared on success so the process can exit immediately', async () => {
  // An uncleared 60s timer would keep the event loop alive; node --test would hang on this test.
  await withCaptureTimeout(Promise.resolve('ok'), 60_000);
});

test('the bound is short enough to stay cosmetic', () => {
  assert.ok(CAPTURE_PAGE_TIMEOUT_MS > 0 && CAPTURE_PAGE_TIMEOUT_MS <= 5000);
});
