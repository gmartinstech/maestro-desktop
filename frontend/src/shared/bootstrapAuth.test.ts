import { describe, expect, it } from 'vitest';
import { shouldMountAfterAuth } from './bootstrapAuth';

describe('shouldMountAfterAuth', () => {
  it('refuses packaged Electron without its local bearer', () => {
    expect(shouldMountAfterAuth({ packaged: true, token: '' })).toBe(false);
  });

  it('allows packaged Electron after its local bearer arrives', () => {
    expect(shouldMountAfterAuth({ packaged: true, token: 'local-test-token' })).toBe(true);
  });

  it('retains the unauthenticated plain-browser fallback', () => {
    expect(shouldMountAfterAuth({ packaged: false, token: '' })).toBe(true);
  });
});
