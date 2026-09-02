// engine/src/auth/scrubber.test.ts -- installTokenScrubber() redacts the token from every
// console method, at up to one level of nesting, mirroring backend/auth.py's p_TokenScrubFilter
// scope (see scrubber.ts's module doc).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installTokenScrubber, resetTokenScrubberForTests } from './scrubber';

const P_TOKEN = 'super-secret-install-token-xyz';
const P_PLACEHOLDER = '<REDACTED:maestro-token>';

let originalLog: typeof console.log;
let originalError: typeof console.error;
let spy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetTokenScrubberForTests();
  originalLog = console.log;
  originalError = console.error;
  spy = vi.fn();
  // installTokenScrubber wraps whatever console.log currently is, so point that at our spy
  // first -- this is how a real caller's original console methods get preserved underneath.
  console.log = spy as unknown as typeof console.log;
  console.error = spy as unknown as typeof console.error;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe('installTokenScrubber', () => {
  test('redacts a token embedded in a plain string argument', () => {
    installTokenScrubber(() => P_TOKEN);
    console.log(`Authorization: Bearer ${P_TOKEN}`);
    expect(spy).toHaveBeenCalledWith(`Authorization: Bearer ${P_PLACEHOLDER}`);
  });

  test('redacts a token inside a top-level object value (one level deep)', () => {
    installTokenScrubber(() => P_TOKEN);
    console.log({ header: `Bearer ${P_TOKEN}`, other: 'unrelated' });
    expect(spy).toHaveBeenCalledWith({ header: `Bearer ${P_PLACEHOLDER}`, other: 'unrelated' });
  });

  test('redacts a token inside a top-level array of strings', () => {
    installTokenScrubber(() => P_TOKEN);
    console.log(['clean', `x-api-key: ${P_TOKEN}`]);
    expect(spy).toHaveBeenCalledWith(['clean', `x-api-key: ${P_PLACEHOLDER}`]);
  });

  test('leaves output untouched when the token has not been minted yet (empty string)', () => {
    installTokenScrubber(() => '');
    console.log('nothing sensitive here');
    expect(spy).toHaveBeenCalledWith('nothing sensitive here');
  });

  test('leaves strings with no token in them untouched', () => {
    installTokenScrubber(() => P_TOKEN);
    console.log('just a normal log line');
    expect(spy).toHaveBeenCalledWith('just a normal log line');
  });

  test('applies to console.error too, not just console.log', () => {
    installTokenScrubber(() => P_TOKEN);
    console.error(`boom: ${P_TOKEN}`);
    expect(spy).toHaveBeenCalledWith(`boom: ${P_PLACEHOLDER}`);
  });

  test('is a no-op the second time it is installed in the same process', () => {
    installTokenScrubber(() => P_TOKEN);
    const patchedLog = console.log;
    installTokenScrubber(() => 'a-different-token');
    expect(console.log).toBe(patchedLog);
  });
});
