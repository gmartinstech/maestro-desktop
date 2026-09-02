import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression coverage for TRI-1 finding #2: detectShell() used to check `'maestro' in window`,
// which is true even when window.maestro is a present-but-undefined property (a stray global),
// wrongly selecting electronShell and setting up a later throw the first time one of its members
// is called. The fix checks truthiness instead.
vi.mock('./electronShell', () => ({ electronShell: { marker: 'electron' } }));
vi.mock('./tauriShell', () => ({ tauriShell: { marker: 'tauri' } }));

describe('shell detection', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as { maestro?: unknown }).maestro;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('selects electronShell when window.maestro is a real object', async () => {
    (window as unknown as { maestro?: unknown }).maestro = {};
    const { shell, hasNativeShell } = await import('./index');
    expect(shell).toEqual({ marker: 'electron' });
    expect(hasNativeShell).toBe(true);
  });

  it('does NOT select electronShell when window.maestro is present but undefined', async () => {
    Object.defineProperty(window, 'maestro', { value: undefined, configurable: true });
    expect('maestro' in window).toBe(true); // sanity-check the exact fragile condition the finding named
    const { shell, hasNativeShell } = await import('./index');
    expect(shell).not.toEqual({ marker: 'electron' });
    expect(hasNativeShell).toBe(false);
  });

  it('selects tauriShell when __TAURI_INTERNALS__ is a real object', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { shell, hasNativeShell } = await import('./index');
    expect(shell).toEqual({ marker: 'tauri' });
    expect(hasNativeShell).toBe(true);
  });

  it('falls back to a non-native shell when neither global is present', async () => {
    const { shell, hasNativeShell } = await import('./index');
    expect(shell).not.toEqual({ marker: 'electron' });
    expect(shell).not.toEqual({ marker: 'tauri' });
    expect(hasNativeShell).toBe(false);
  });
});
