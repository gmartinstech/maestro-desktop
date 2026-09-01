// Unit tests for cdp.ts's pure helpers plus a mocked-transport round-trip through
// CdpBrowserPage.runCommand() -- no real browser, no real network. The real-browser path (launch
// via launcher.ts, connect for real, drive an actual page) is BRW-2's separate manual gate, run
// with `npx tsx src/browser/cdp.integration-check.ts`, mirroring launcher.integration-check.ts's
// own split between stubbed unit tests and a manual real-integration script.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CdpBrowserPage, resolveNavUrl, toRouteTemplate } from './cdp';

describe('resolveNavUrl', () => {
  it('leaves a URL that already has a scheme untouched', () => {
    expect(resolveNavUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(resolveNavUrl('about:blank')).toBe('about:blank');
    expect(resolveNavUrl('data:text/html,<h1>hi</h1>')).toBe('data:text/html,<h1>hi</h1>');
  });

  it('prepends https:// to a bare host', () => {
    expect(resolveNavUrl('example.com')).toBe('https://example.com');
    expect(resolveNavUrl('example.com/some/path')).toBe('https://example.com/some/path');
  });

  it('treats free text with no dotted host as a search query', () => {
    expect(resolveNavUrl('weather in paris')).toBe('https://www.google.com/search?q=weather%20in%20paris');
  });
});

describe('toRouteTemplate', () => {
  it('replaces purely numeric path segments with {{value}}', () => {
    expect(toRouteTemplate('/api/users/1234/posts')).toBe('/api/users/{{value}}/posts');
  });

  it('replaces UUID-like segments with {{value}}', () => {
    expect(toRouteTemplate('/api/orders/9f8a7b6c-1111-2222-3333-444455556666')).toBe('/api/orders/{{value}}');
  });

  it('leaves non-numeric, non-UUID segments untouched', () => {
    expect(toRouteTemplate('/api/users/me/settings')).toBe('/api/users/me/settings');
  });
});

// A minimal stand-in for the global `WebSocket` (Node 22+) that CdpTransport opens: dispatches an
// 'open' event on the next microtask, and routes every {id,method,params} frame sent to it through
// a per-test responder so command results/events can be scripted without a real browser.
type Responder = (method: string, params: Record<string, unknown>) => unknown;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static responder: Responder = () => ({});
  readyState = 0;
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn);
  }

  send(data: string): void {
    const msg = JSON.parse(data) as { id: number; method: string; params?: Record<string, unknown> };
    queueMicrotask(() => {
      try {
        const result = FakeWebSocket.responder(msg.method, msg.params || {});
        this.emit('message', { data: JSON.stringify({ id: msg.id, result }) });
      } catch (err) {
        this.emit('message', { data: JSON.stringify({ id: msg.id, error: { message: String(err) } }) });
      }
    });
  }

  close(): void {
    this.readyState = 3;
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) || []) fn(ev);
  }

  // Test helper: push an unsolicited CDP event frame (Network.requestWillBeSent, etc.) as the
  // real browser would, outside of any request/response pair.
  emitEvent(method: string, params: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify({ method, params }) });
  }
}

describe('CdpBrowserPage against a mocked transport', () => {
  const fakeFetch = vi.fn(async (url: string) => {
    if (url.includes('/json/new')) {
      return { ok: true, json: async () => ({ id: 'target-1', webSocketDebuggerUrl: 'ws://127.0.0.1:9999/devtools/page/target-1' }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.responder = () => ({});
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', fakeFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enables the expected CDP domains on connect', async () => {
    const enabled: string[] = [];
    FakeWebSocket.responder = (method) => {
      if (method.endsWith('.enable')) enabled.push(method);
      return {};
    };
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    expect(enabled.sort()).toEqual(['DOM.enable', 'Log.enable', 'Network.enable', 'Page.enable', 'Runtime.enable'].sort());
    await page.close();
  });

  it('screenshot() returns image/url/title shaped like browserCommandHandler.ts expects', async () => {
    FakeWebSocket.responder = (method) => {
      if (method === 'Page.captureScreenshot') return { data: 'ZmFrZS1wbmctYnl0ZXM=' };
      if (method === 'Runtime.evaluate') return { result: { value: { url: 'https://example.com/', title: 'Example' } } };
      return {};
    };
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const result = await page.runCommand('screenshot');
    expect(result).toEqual({ image: 'ZmFrZS1wbmctYnl0ZXM=', url: 'https://example.com/', title: 'Example' });
    await page.close();
  });

  it('screenshot() surfaces a CDP failure as an honest error, not a throw', async () => {
    FakeWebSocket.responder = (method) => {
      if (method === 'Page.captureScreenshot') throw new Error('target crashed');
      return {};
    };
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const result = await page.runCommand('screenshot');
    expect(result.error).toMatch(/Screenshot failed/);
    await page.close();
  });

  it('navigate() resolves once Page.domContentEventFired fires and clears the route cache', async () => {
    FakeWebSocket.responder = (method) => {
      if (method === 'Page.navigate') return {};
      return {};
    };
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const ws = FakeWebSocket.instances[0];
    const navigatePromise = page.runCommand('navigate', { url: 'example.com' });
    queueMicrotask(() => ws.emitEvent('Page.domContentEventFired', {}));
    const result = await navigatePromise;
    expect(result.text).toBe('Navigated to https://example.com');
    expect(result.url).toBe('https://example.com');
    await page.close();
  });

  it('navigate() requires a url parameter', async () => {
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const result = await page.runCommand('navigate', {});
    expect(result).toEqual({ error: 'url parameter is required' });
    await page.close();
  });

  it('runCommand() reports an unknown action instead of throwing', async () => {
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    // @ts-expect-error deliberately passing an action outside the BrowserAction union
    const result = await page.runCommand('not_a_real_action', {});
    expect(result.error).toMatch(/Unknown browser action/);
    await page.close();
  });

  it('getConsole() surfaces buffered warn/error console entries from Runtime.consoleAPICalled', async () => {
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const ws = FakeWebSocket.instances[0];
    ws.emitEvent('Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'boom' }] });
    ws.emitEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'ignored, not warn/error' }] });
    await new Promise((r) => setTimeout(r, 0));
    const result = page.getConsole();
    expect(result.errors).toEqual([{ level: 'error', message: 'boom' }]);
    await page.close();
  });

  it('click_index errors clearly when the index was never listed', async () => {
    const page = await CdpBrowserPage.connect(9999, 'about:blank');
    const result = await page.runCommand('click_index', { index: 3 });
    expect(result.error).toMatch(/not in the cached element map/);
    await page.close();
  });
});
