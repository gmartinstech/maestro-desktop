import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression coverage for TRI-1 finding #1: getBackendPortLive() returning the cached port
// (initially 0) before invoke('get_backend_port') resolves made config.ts's
// `shell.getBackendPortLive() || 8324` fall back to the hardcoded 8324 on every fresh page load,
// even when the real backend landed on a different port. The fix caches the resolved port in
// sessionStorage so a same-session reload reads the real value synchronously instead of guessing.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const PORT_CACHE_KEY = 'maestro.tauriShell.backendPort';

describe('tauriShell backend port caching', () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    window.sessionStorage.clear();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it('returns 0 synchronously on a cold session before invoke() has a chance to resolve', async () => {
    invokeMock.mockReturnValue(new Promise(() => {})); // never resolves during this test
    const { tauriShell } = await import('./tauriShell');
    expect(tauriShell.getBackendPortLive()).toBe(0);
  });

  it('returns a sessionStorage-cached port synchronously, without waiting on invoke() at all', async () => {
    window.sessionStorage.setItem(PORT_CACHE_KEY, '9001');
    invokeMock.mockReturnValue(new Promise(() => {})); // never resolves during this test
    const { tauriShell } = await import('./tauriShell');
    // The whole point: this is a SYNCHRONOUS read, right after import, before any microtask runs.
    expect(tauriShell.getBackendPortLive()).toBe(9001);
  });

  it('persists a newly resolved port to sessionStorage so the next load guesses correctly', async () => {
    let resolveInvoke: (value: number) => void = () => {};
    invokeMock.mockReturnValue(new Promise<number>((resolve) => { resolveInvoke = resolve; }));
    const { tauriShell } = await import('./tauriShell');
    expect(tauriShell.getBackendPortLive()).toBe(0);

    resolveInvoke(9001);
    await Promise.resolve();
    await Promise.resolve();

    expect(window.sessionStorage.getItem(PORT_CACHE_KEY)).toBe('9001');
    expect(tauriShell.getBackendPort()).toBe(9001);
  });

  it('ignores a corrupt/non-numeric cached value instead of throwing or using it', async () => {
    window.sessionStorage.setItem(PORT_CACHE_KEY, 'not-a-number');
    invokeMock.mockReturnValue(new Promise(() => {}));
    const { tauriShell } = await import('./tauriShell');
    expect(tauriShell.getBackendPortLive()).toBe(0);
  });

  it('ignores a cached zero/negative value the same as no cache at all', async () => {
    window.sessionStorage.setItem(PORT_CACHE_KEY, '0');
    invokeMock.mockReturnValue(new Promise(() => {}));
    const { tauriShell } = await import('./tauriShell');
    expect(tauriShell.getBackendPortLive()).toBe(0);
  });
});
