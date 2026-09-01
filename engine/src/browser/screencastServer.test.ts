// Unit tests for BRW-4's engine-side wiring LOGIC only, per the same DI spirit as
// launcher.test.ts/screencast.test.ts: fake launchBrowser/findPageTargetWsUrl/connectCdpSession
// and a fake UI socket, no real browser, no real network, no real WS upgrade. The real end-to-end
// path (a real launched browser, a real engine server, a real click reaching the real page) is
// covered by the separate manual integration gate (screencastServer.integration-check.ts), run
// for real, not here.
import { describe, expect, it, vi } from 'vitest';
import type { RawData } from 'ws';
import type { WebSocket } from 'ws';
import { BrowserScreencastRegistry, wireConnection, type BrowserScreencastServerDeps } from './screencastServer';
import type { CdpSession } from './screencast';
import type { LaunchedBrowser } from './launcher';

function makeFakeCdp(): { cdp: CdpSession; sent: Array<{ method: string; params?: Record<string, unknown> }>; emit: (method: string, params: unknown) => void; closed: boolean } {
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const state = { closed: false };
  const cdp: CdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return {};
    }),
    onEvent: vi.fn((method: string, handler: (params: unknown) => void) => {
      let set = handlers.get(method);
      if (!set) { set = new Set(); handlers.set(method, set); }
      set.add(handler);
      return () => set?.delete(handler);
    }),
    close: vi.fn(() => { state.closed = true; }),
  };
  return {
    cdp, sent, closed: state.closed,
    emit(method, params) {
      const set = handlers.get(method);
      if (set) for (const h of set) h(params);
    },
  };
}

interface FakeUiSocket {
  readyState: number;
  bufferedAmount: number;
  sentEvents: Array<Record<string, unknown>>;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, cb: (raw: RawData) => void) => void;
  off: (event: string, cb: (raw: RawData) => void) => void;
  once: (event: string, cb: () => void) => void;
  emitMessage: (raw: unknown) => void;
}

function makeFakeUiSocket(): FakeUiSocket {
  const messageListeners = new Set<(raw: RawData) => void>();
  const closeListeners = new Set<() => void>();
  const sentEvents: Array<Record<string, unknown>> = [];
  const socket: FakeUiSocket = {
    readyState: 1,
    bufferedAmount: 0,
    sentEvents,
    send(data: string) { sentEvents.push(JSON.parse(data)); },
    close: vi.fn(),
    on(event, cb) { if (event === 'message') messageListeners.add(cb); },
    off(event, cb) { if (event === 'message') messageListeners.delete(cb); },
    once(event, cb) { if (event === 'close') closeListeners.add(cb); },
    emitMessage(raw: unknown) {
      const data = Buffer.from(JSON.stringify(raw));
      for (const fn of messageListeners) fn(data as unknown as RawData);
    },
  };
  return socket;
}

let launchCounter = 0;
function makeFakeLaunchedBrowser(): LaunchedBrowser {
  launchCounter += 1;
  return {
    cdpPort: 9000 + launchCounter,
    source: 'chrome',
    executablePath: '/fake/chrome',
    pid: 1000 + launchCounter,
    close: vi.fn(async () => {}),
  };
}

function makeDeps(): BrowserScreencastServerDeps & { launchCalls: string[]; connectCalls: number; cdpSessions: ReturnType<typeof makeFakeCdp>[] } {
  const cdpSessions: ReturnType<typeof makeFakeCdp>[] = [];
  const launchCalls: string[] = [];
  let connectCalls = 0;
  return {
    launchCalls,
    get connectCalls() { return connectCalls; },
    cdpSessions,
    launchBrowser: vi.fn(async () => {
      launchCalls.push('launch');
      return makeFakeLaunchedBrowser();
    }),
    findPageTargetWsUrl: vi.fn(async (cdpPort: number) => `ws://127.0.0.1:${cdpPort}/devtools/page/fake`),
    connectCdpSession: vi.fn(async () => {
      connectCalls += 1;
      const fake = makeFakeCdp();
      cdpSessions.push(fake);
      return fake.cdp;
    }),
  } as unknown as BrowserScreencastServerDeps & { launchCalls: string[]; connectCalls: number; cdpSessions: ReturnType<typeof makeFakeCdp>[] };
}

describe('BrowserScreencastRegistry', () => {
  it('launches exactly one browser per browserId', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const a = await registry.getOrLaunch('browser-1');
    const b = await registry.getOrLaunch('browser-1');
    expect(a).toBe(b);
    expect(deps.launchBrowser).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent getOrLaunch calls for the same id (no double launch)', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const [a, b] = await Promise.all([registry.getOrLaunch('browser-1'), registry.getOrLaunch('browser-1')]);
    expect(a).toBe(b);
    expect(deps.launchBrowser).toHaveBeenCalledTimes(1);
  });

  it('launches a separate browser per distinct browserId', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const a = await registry.getOrLaunch('browser-1');
    const b = await registry.getOrLaunch('browser-2');
    expect(a).not.toBe(b);
    expect(deps.launchBrowser).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(2);
  });

  it('navSession opens one CDP connection and reuses it on later calls', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const first = await registry.navSession('browser-1');
    const second = await registry.navSession('browser-1');
    expect(first).toBe(second);
    expect(deps.connectCdpSession).toHaveBeenCalledTimes(1);
    expect(deps.cdpSessions[0].sent.some((s) => s.method === 'Page.enable')).toBe(true);
  });

  it('close() closes the browser and the nav CDP session, and removes it from the registry', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const session = await registry.getOrLaunch('browser-1');
    await registry.navSession('browser-1');
    await registry.close('browser-1');
    expect(session.browser.close).toHaveBeenCalledTimes(1);
    expect(deps.cdpSessions[0].cdp.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
    // Relaunches (a fresh browser) if asked again after close.
    await registry.getOrLaunch('browser-1');
    expect(deps.launchBrowser).toHaveBeenCalledTimes(2);
  });

  it('closeAll() closes every registered session', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const a = await registry.getOrLaunch('browser-1');
    const b = await registry.getOrLaunch('browser-2');
    await registry.closeAll();
    expect(a.browser.close).toHaveBeenCalledTimes(1);
    expect(b.browser.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});

describe('wireConnection', () => {
  it('starts a real screencast session on the launched browser and forwards a screencast:started event', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const fakeSocket = makeFakeUiSocket();

    await wireConnection(fakeSocket as unknown as WebSocket, 'browser-1', registry);

    expect(deps.launchBrowser).toHaveBeenCalledTimes(1);
    // Two CDP connections by design: [0] the eager viewport-pin/nav session opened inside
    // getOrLaunch (Page.enable + Emulation.setDeviceMetricsOverride), [1] startScreencastSession's
    // own separate connection -- see screencastServer.ts's header on why they aren't shared.
    expect(deps.connectCdpSession).toHaveBeenCalledTimes(2);
    expect(deps.cdpSessions[0].sent.some((s) => s.method === 'Emulation.setDeviceMetricsOverride')).toBe(true);
    expect(fakeSocket.sentEvents.some((e) => e.event === 'screencast:started')).toBe(true);
    const startedCdp = deps.cdpSessions[1];
    expect(startedCdp.sent.some((s) => s.method === 'Page.startScreencast')).toBe(true);
  });

  it('forwards a real Page.screencastFrame event to the UI socket as screencast:frame', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const fakeSocket = makeFakeUiSocket();

    await wireConnection(fakeSocket as unknown as WebSocket, 'browser-1', registry);
    const cdp = deps.cdpSessions[1]; // [0] is the eager viewport-pin/nav session; frames come from startScreencastSession's own connection
    cdp.emit('Page.screencastFrame', {
      data: 'ZmFrZWpwZWc=', sessionId: 1,
      metadata: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 1280, deviceHeight: 900, scrollOffsetX: 0, scrollOffsetY: 0 },
    });

    const frame = fakeSocket.sentEvents.find((e) => e.event === 'screencast:frame') as { data?: { base64?: string } } | undefined;
    expect(frame?.data?.base64).toBe('ZmFrZWpwZWc=');
    // Every frame is ack'd unconditionally -- see screencast.ts's own doc on why.
    expect(cdp.sent.some((s) => s.method === 'Page.screencastFrameAck')).toBe(true);
  });

  it('a browser:navigate message issues Page.navigate on the shared nav CDP session', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const fakeSocket = makeFakeUiSocket();

    await wireConnection(fakeSocket as unknown as WebSocket, 'browser-1', registry);
    fakeSocket.emitMessage({ event: 'browser:navigate', data: { url: 'https://example.com' } });
    await new Promise((r) => setTimeout(r, 0)); // let the async navigate handler settle

    // navSession REUSES the eager viewport-pin connection from getOrLaunch ([0]) rather than
    // opening a third one -- still 2 total, same as the plain connect case above.
    expect(deps.connectCdpSession).toHaveBeenCalledTimes(2);
    const navCdp = deps.cdpSessions[0];
    expect(navCdp.sent).toContainEqual({ method: 'Page.navigate', params: { url: 'https://example.com' } });
  });

  it('ignores an input:mouse message on its own navigate listener (that one belongs to startScreencastSession)', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const fakeSocket = makeFakeUiSocket();

    await wireConnection(fakeSocket as unknown as WebSocket, 'browser-1', registry);
    fakeSocket.emitMessage({ event: 'input:mouse', data: { type: 'mousePressed', x: 1, y: 1 } });
    await new Promise((r) => setTimeout(r, 0));

    // Still only the 2 connections from a plain connect (eager pin + screencast's own) -- proving
    // the navigate-only listener correctly ignored an input:mouse message (no Page.navigate ever
    // reached the pin session either).
    expect(deps.connectCdpSession).toHaveBeenCalledTimes(2);
    expect(deps.cdpSessions[0].sent.some((s) => s.method === 'Page.navigate')).toBe(false);
    // But the click DID reach Input.dispatchMouseEvent via startScreencastSession's own listener.
    const startedCdp = deps.cdpSessions[1];
    expect(startedCdp.sent.some((s) => s.method === 'Input.dispatchMouseEvent')).toBe(true);
  });

  it('a malformed browser:navigate message is ignored, not thrown', async () => {
    const deps = makeDeps();
    const registry = new BrowserScreencastRegistry(deps);
    const fakeSocket = makeFakeUiSocket();
    await wireConnection(fakeSocket as unknown as WebSocket, 'browser-1', registry);
    expect(() => fakeSocket.emitMessage({ event: 'browser:navigate', data: {} })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // Still just the plain-connect 2 (eager pin + screencast) -- no Page.navigate reached either
    // session, proving the malformed message never triggered a navigate.
    expect(deps.connectCdpSession).toHaveBeenCalledTimes(2);
    expect(deps.cdpSessions[0].sent.some((s) => s.method === 'Page.navigate')).toBe(false);
  });
});
