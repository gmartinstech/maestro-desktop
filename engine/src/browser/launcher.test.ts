// Unit tests for the browser resolution PRIORITY LOGIC only (edge -> chrome -> playwright
// fallback), per BRW-1's gate: a stubbed filesystem/platform, no real disk access, no real
// download, no real browser launch. launchBrowser() itself (the real spawn/CDP-poll path) is
// covered by the ticket's separate real-integration gate, run manually, not here.
import { describe, expect, it, vi } from 'vitest';
import { resolveBrowserExecutable, type ResolveDeps } from './launcher';

function makeDeps(overrides: Partial<ResolveDeps> & { existing: string[] }): ResolveDeps {
  const { existing, ...rest } = overrides;
  return {
    platform: 'win32',
    env: {
      PROGRAMFILES: 'C:/Program Files',
      'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
      LOCALAPPDATA: 'C:/Users/fake/AppData/Local',
    },
    existsSync: (path: string) => existing.includes(path),
    // mockImplementation defers creating the rejected promise until actually invoked — using
    // mockRejectedValue here would create it eagerly at setup time, tripping vitest's unhandled-
    // rejection detection on every test that (correctly) never calls this fallback.
    resolvePlaywrightChromium: vi.fn().mockImplementation(() => Promise.reject(new Error('should not be called'))),
    ...rest,
  };
}

describe('resolveBrowserExecutable priority order', () => {
  it('picks system Edge when it is present, without touching Chrome or the Playwright fallback', async () => {
    const edgePath = 'C:/Program Files/Microsoft/Edge/Application/msedge.exe';
    const deps = makeDeps({ existing: [edgePath, 'C:/Program Files/Google/Chrome/Application/chrome.exe'] });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: edgePath, source: 'edge' });
    expect(deps.resolvePlaywrightChromium).not.toHaveBeenCalled();
  });

  it('falls back to Chrome when Edge is absent', async () => {
    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const deps = makeDeps({ existing: [chromePath] });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: chromePath, source: 'chrome' });
    expect(deps.resolvePlaywrightChromium).not.toHaveBeenCalled();
  });

  it('checks the per-user LOCALAPPDATA install location for Edge, not just per-machine Program Files', async () => {
    const perUserEdge = 'C:/Users/fake/AppData/Local/Microsoft/Edge/Application/msedge.exe';
    const deps = makeDeps({ existing: [perUserEdge] });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: perUserEdge, source: 'edge' });
  });

  it('checks the (x86) Program Files location for Chrome when the 64-bit one is absent', async () => {
    const x86Chrome = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
    const deps = makeDeps({ existing: [x86Chrome] });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: x86Chrome, source: 'chrome' });
  });

  it('falls back to the lazily-resolved Playwright Chromium when neither Edge nor Chrome is found', async () => {
    const resolvePlaywrightChromium = vi.fn().mockResolvedValue('C:/fake/ms-playwright/chromium-1234/chrome.exe');
    const deps = makeDeps({ existing: [], resolvePlaywrightChromium });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: 'C:/fake/ms-playwright/chromium-1234/chrome.exe', source: 'playwright-chromium' });
    expect(resolvePlaywrightChromium).toHaveBeenCalledOnce();
  });

  it('prefers Edge over Chrome even when both are present', async () => {
    const edgePath = 'C:/Program Files/Microsoft/Edge/Application/msedge.exe';
    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const deps = makeDeps({ existing: [chromePath, edgePath] });
    const result = await resolveBrowserExecutable(deps);
    expect(result.source).toBe('edge');
  });

  it('resolves macOS candidate paths when platform is darwin', async () => {
    const macEdge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    const deps = makeDeps({ existing: [macEdge], platform: 'darwin' });
    const result = await resolveBrowserExecutable(deps);
    expect(result).toEqual({ executablePath: macEdge, source: 'edge' });
  });

  it('propagates a rejection from the Playwright fallback instead of swallowing it', async () => {
    const resolvePlaywrightChromium = vi.fn().mockRejectedValue(new Error('download failed'));
    const deps = makeDeps({ existing: [], resolvePlaywrightChromium });
    await expect(resolveBrowserExecutable(deps)).rejects.toThrow('download failed');
  });
});
