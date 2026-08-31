const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUpdateChannel, storeManagedStatus } = require('./storeChannel');

test('only a positively Store-packaged Windows app selects Store updates', () => {
  assert.equal(resolveUpdateChannel({ platform: 'win32', windowsStore: true }), 'store');
  assert.equal(resolveUpdateChannel({ platform: 'win32', windowsStore: false }), 'cdn');
  assert.equal(resolveUpdateChannel({ platform: 'linux', windowsStore: true }), 'native');
});

test('Store status explains that Microsoft Store owns updates', () => {
  assert.deepEqual(storeManagedStatus(), {
    status: 'store-managed',
    info: { source: 'microsoft-store' },
    error: null,
  });
});
