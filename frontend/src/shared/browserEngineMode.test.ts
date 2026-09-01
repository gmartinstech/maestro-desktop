import { describe, it, expect, afterEach } from 'vitest';
import { getBrowserEngineMode } from './browserEngineMode';

describe('getBrowserEngineMode', () => {
  const original = process.env.MAESTRO_BROWSER_ENGINE;
  afterEach(() => {
    if (original === undefined) delete process.env.MAESTRO_BROWSER_ENGINE;
    else process.env.MAESTRO_BROWSER_ENGINE = original;
  });

  it('defaults to electron when unset', () => {
    delete process.env.MAESTRO_BROWSER_ENGINE;
    expect(getBrowserEngineMode()).toBe('electron');
  });

  it('defaults to electron for any value other than "cdp"', () => {
    process.env.MAESTRO_BROWSER_ENGINE = 'bogus';
    expect(getBrowserEngineMode()).toBe('electron');
  });

  it('returns cdp when explicitly set to cdp', () => {
    process.env.MAESTRO_BROWSER_ENGINE = 'cdp';
    expect(getBrowserEngineMode()).toBe('cdp');
  });
});
