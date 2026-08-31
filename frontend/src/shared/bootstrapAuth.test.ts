import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldMountAfterAuth } from './bootstrapAuth';

test('packaged Electron refuses to mount without its local bearer', () => {
  assert.equal(shouldMountAfterAuth({ packaged: true, token: '' }), false);
});

test('packaged Electron mounts after its local bearer arrives', () => {
  assert.equal(shouldMountAfterAuth({ packaged: true, token: 'local-test-token' }), true);
});

test('plain-browser development retains its unauthenticated fallback', () => {
  assert.equal(shouldMountAfterAuth({ packaged: false, token: '' }), true);
});
