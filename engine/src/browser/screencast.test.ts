// Unit tests for BRW-3's screencast/input/backpressure LOGIC only, per the same DI spirit as
// launcher.test.ts: a fake CdpSession and a fake UiSocketLike, no real browser, no real network,
// no real WebSocket. The real end-to-end path (real browser, real CDP WS, real client WS, fps
// measurement, a synthetic click actually reaching the page) is covered by the ticket's separate
// manual integration gate (screencast.integration-check.ts), run for real, not here.
import { describe, expect, it, vi } from 'vitest';
import type { RawData } from 'ws';
import {
  startScreencastSession,
  type CdpSession,
  type ScreencastDeps,
  type ScreencastServerEvent,
  type UiSocketLike,
} from './screencast';

function makeFakeCdp(): { cdp: CdpSession; sent: Array<{ method: string; params?: Record<string, unknown> }>; emit: (method: string, params: unknown) => void } {
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const cdp: CdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return {};
    }),
    onEvent: vi.fn((method: string, handler: (params: unknown) => void) => {
      let set = handlers.get(method);
      if (!set) {
        set = new Set();
        handlers.set(method, set);
      }
      set.add(handler);
      return () => set?.delete(handler);
    }),
    close: vi.fn(),
  };
  return {
    cdp,
    sent,
    emit(method, params) {
      const set = handlers.get(method);
      if (set) for (const h of set) h(params);
    },
  };
}

interface FakeUiSocket extends UiSocketLike {
  sentEvents: ScreencastServerEvent[];
  emitMessage: (raw: unknown) => void;
  emitClose: () => void;
}

function makeFakeUiSocket(bufferedAmount = 0): FakeUiSocket {
  const messageListeners = new Set<(raw: RawData) => void>();
  const closeListeners = new Set<() => void>();
  const sentEvents: ScreencastServerEvent[] = [];
  const socket: FakeUiSocket = {
    readyState: 1,
    bufferedAmount,
    send(data: string) {
      sentEvents.push(JSON.parse(data) as ScreencastServerEvent);
    },
    on(event, cb) {
      if (event === 'message') messageListeners.add(cb);
    },
    off(event, cb) {
      if (event === 'message') messageListeners.delete(cb);
    },
    once(event, cb) {
      if (event === 'close') closeListeners.add(cb);
    },
    sentEvents,
    emitMessage(raw: unknown) {
      const buf = Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
      for (const h of messageListeners) h(buf as unknown as RawData);
    },
    emitClose() {
      for (const h of closeListeners) h();
    },
  };
  return socket;
}

function makeDeps(cdp: CdpSession): ScreencastDeps {
  return {
    findPageTargetWsUrl: vi.fn().mockResolvedValue('ws://fake-cdp/devtools/page/1'),
    connectCdpSession: vi.fn().mockResolvedValue(cdp),
  };
}

const FRAME_METADATA = { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 1280, deviceHeight: 900, scrollOffsetX: 0, scrollOffsetY: 0 };

describe('startScreencastSession', () => {
  it('enables Page and starts the screencast with the requested (or default) options', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    expect(sent.map((s) => s.method)).toEqual(['Page.enable', 'Page.startScreencast']);
    expect(sent[1].params).toEqual({ format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
    expect(ui.sentEvents[0]).toEqual({ event: 'screencast:started', data: { cdpPort: 9999, format: 'jpeg', maxWidth: 1280, maxHeight: 900 } });
  });

  it('forwards a screencast frame to the UI and acks it on the CDP side', async () => {
    const { cdp, sent, emit } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    const session = await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    emit('Page.screencastFrame', { data: 'BASE64==', metadata: FRAME_METADATA, sessionId: 7 });
    await Promise.resolve(); // let the ack's fire-and-forget send() microtask settle

    const ackCall = sent.find((s) => s.method === 'Page.screencastFrameAck');
    expect(ackCall?.params).toEqual({ sessionId: 7 });

    const frameEvent = ui.sentEvents.find((e) => e.event === 'screencast:frame');
    expect(frameEvent).toEqual({
      event: 'screencast:frame',
      data: { frameNumber: 1, format: 'jpeg', base64: 'BASE64==', metadata: FRAME_METADATA },
    });
    expect(session.framesSent).toBe(1);
    expect(session.framesDropped).toBe(0);
  });

  it('drops a frame instead of queuing it when the UI socket is backed up, but still acks CDP', async () => {
    const { cdp, sent, emit } = makeFakeCdp();
    const ui = makeFakeUiSocket(10 * 1024 * 1024); // way over the backpressure threshold
    const session = await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    const framesBefore = ui.sentEvents.length;
    emit('Page.screencastFrame', { data: 'A', metadata: FRAME_METADATA, sessionId: 1 });
    emit('Page.screencastFrame', { data: 'B', metadata: FRAME_METADATA, sessionId: 2 });
    emit('Page.screencastFrame', { data: 'C', metadata: FRAME_METADATA, sessionId: 3 });
    await Promise.resolve();

    // No new 'screencast:frame' events reached the UI...
    expect(ui.sentEvents.slice(framesBefore).some((e) => e.event === 'screencast:frame')).toBe(false);
    expect(session.framesSent).toBe(0);
    expect(session.framesDropped).toBe(3);
    // ...but every single one was still acked on the CDP side, so the browser keeps producing frames.
    const acks = sent.filter((s) => s.method === 'Page.screencastFrameAck');
    expect(acks.map((a) => a.params)).toEqual([{ sessionId: 1 }, { sessionId: 2 }, { sessionId: 3 }]);
  });

  it('resumes forwarding once the UI socket drains back under the backpressure threshold', async () => {
    const { cdp, emit } = makeFakeCdp();
    const ui = makeFakeUiSocket(10 * 1024 * 1024);
    const session = await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    emit('Page.screencastFrame', { data: 'A', metadata: FRAME_METADATA, sessionId: 1 });
    await Promise.resolve();
    expect(session.framesDropped).toBe(1);

    ui.bufferedAmount = 0; // client caught up
    emit('Page.screencastFrame', { data: 'B', metadata: FRAME_METADATA, sessionId: 2 });
    await Promise.resolve();

    expect(session.framesSent).toBe(1);
    const frameEvent = ui.sentEvents.find((e) => e.event === 'screencast:frame');
    expect(frameEvent).toMatchObject({ data: { frameNumber: 1, base64: 'B' } });
  });

  it('translates an input:mouse message into Input.dispatchMouseEvent', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    ui.emitMessage({ event: 'input:mouse', data: { type: 'mousePressed', x: 100, y: 90 } });
    await Promise.resolve();

    const call = sent.find((s) => s.method === 'Input.dispatchMouseEvent');
    expect(call?.params).toEqual({ type: 'mousePressed', x: 100, y: 90, button: 'left', clickCount: 1, modifiers: 0 });
  });

  it('translates an input:mouse wheel message including deltaX/deltaY', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    ui.emitMessage({ event: 'input:mouse', data: { type: 'mouseWheel', x: 10, y: 20, deltaX: 0, deltaY: 40 } });
    await Promise.resolve();

    const call = sent.find((s) => s.method === 'Input.dispatchMouseEvent');
    expect(call?.params).toEqual({ type: 'mouseWheel', x: 10, y: 20, button: 'left', clickCount: 0, modifiers: 0, deltaX: 0, deltaY: 40 });
  });

  it('translates an input:key message into Input.dispatchKeyEvent', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    ui.emitMessage({ event: 'input:key', data: { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' } });
    await Promise.resolve();

    const call = sent.find((s) => s.method === 'Input.dispatchKeyEvent');
    expect(call?.params).toEqual({ type: 'keyDown', modifiers: 0, key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a' });
  });

  it('ignores a malformed (non-JSON) UI message without throwing', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    expect(() => ui.emitMessage('not json{{{')).not.toThrow();
    await Promise.resolve();
    expect(sent.some((s) => s.method.startsWith('Input.'))).toBe(false);
  });

  it('ignores a well-formed JSON message with an unknown event name', async () => {
    const { cdp, sent } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    ui.emitMessage({ event: 'not:a:real:event', data: {} });
    await Promise.resolve();
    expect(sent.some((s) => s.method.startsWith('Input.'))).toBe(false);
  });

  it('stop() unsubscribes the frame handler, stops the CDP screencast, and closes the session', async () => {
    const { cdp, sent, emit } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    const session = await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    await session.stop();

    expect(sent.some((s) => s.method === 'Page.stopScreencast')).toBe(true);
    expect(cdp.close).toHaveBeenCalledOnce();
    const stoppedEvent = ui.sentEvents.find((e) => e.event === 'screencast:stopped');
    expect(stoppedEvent).toMatchObject({ event: 'screencast:stopped', data: { reason: 'stopped' } });

    // A frame emitted after stop() must not be forwarded -- the handler was unsubscribed.
    const framesBefore = ui.sentEvents.filter((e) => e.event === 'screencast:frame').length;
    emit('Page.screencastFrame', { data: 'late', metadata: FRAME_METADATA, sessionId: 99 });
    await Promise.resolve();
    expect(ui.sentEvents.filter((e) => e.event === 'screencast:frame').length).toBe(framesBefore);
  });

  it('stop() is idempotent -- calling it twice only emits one screencast:stopped', async () => {
    const { cdp } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    const session = await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    await session.stop();
    await session.stop();

    expect(ui.sentEvents.filter((e) => e.event === 'screencast:stopped').length).toBe(1);
  });

  it('auto-stops when the UI socket closes', async () => {
    const { cdp } = makeFakeCdp();
    const ui = makeFakeUiSocket();
    await startScreencastSession(ui, 9999, {}, makeDeps(cdp));

    ui.emitClose();
    await Promise.resolve();

    const stoppedEvent = ui.sentEvents.find((e) => e.event === 'screencast:stopped');
    expect(stoppedEvent).toMatchObject({ data: { reason: 'ui_socket_closed' } });
  });
});
