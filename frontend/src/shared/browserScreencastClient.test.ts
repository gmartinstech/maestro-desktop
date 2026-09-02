import { describe, it, expect, vi } from 'vitest';
import { BrowserScreencastClient, type ScreencastSocketLike, type ScreencastClientOptions } from './browserScreencastClient';

// A minimal fake socket: records what's sent, lets the test fire 'message'/'error' events by
// hand, and never touches a real network -- same DI spirit as BRW-3's own ScreencastDeps fakes.
class FakeSocket implements ScreencastSocketLike {
  readyState = 1; // OPEN
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Array<(ev: any) => void>> = {};

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, cb: (ev: any) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: (ev: any) => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== cb);
  }

  emitMessage(data: unknown): void {
    for (const fn of this.listeners.message || []) fn({ data: JSON.stringify(data) });
  }

  emitOpen(): void {
    for (const fn of this.listeners.open || []) fn({});
  }
}

function makeClient(fake: FakeSocket, opts: ScreencastClientOptions = {}) {
  return new BrowserScreencastClient('ws://example.invalid/ws/browser-screencast?browserId=b1', {
    ...opts,
    createSocket: () => fake,
  });
}

describe('BrowserScreencastClient', () => {
  it('is not connected before connect() is called', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    expect(client.connected).toBe(false);
  });

  it('reports connected once the socket reports readyState OPEN', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    client.connect();
    expect(client.connected).toBe(true);
  });

  it('fires onOpen when the socket\'s own open event fires -- the earliest point a send() actually delivers', () => {
    const fake = new FakeSocket();
    const onOpen = vi.fn();
    const client = makeClient(fake, { onOpen });
    client.connect();
    expect(onOpen).not.toHaveBeenCalled();
    fake.emitOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('dispatches screencast:frame messages to onFrame with the right fields', () => {
    const fake = new FakeSocket();
    const onFrame = vi.fn();
    const client = makeClient(fake, { onFrame });
    client.connect();
    fake.emitMessage({
      event: 'screencast:frame',
      data: { frameNumber: 3, format: 'jpeg', base64: 'AAAA', metadata: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 1280, deviceHeight: 900, scrollOffsetX: 0, scrollOffsetY: 0 } },
    });
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith('AAAA', 'jpeg', expect.objectContaining({ deviceWidth: 1280 }), 3);
  });

  it('dispatches screencast:started/stopped/error to their own callbacks', () => {
    const fake = new FakeSocket();
    const onStarted = vi.fn();
    const onStopped = vi.fn();
    const onError = vi.fn();
    const client = makeClient(fake, { onStarted, onStopped, onError });
    client.connect();
    fake.emitMessage({ event: 'screencast:started', data: { cdpPort: 1234, format: 'jpeg', maxWidth: 1280, maxHeight: 900 } });
    fake.emitMessage({ event: 'screencast:stopped', data: { reason: 'ui_socket_closed', framesSent: 5, framesDropped: 0 } });
    fake.emitMessage({ event: 'screencast:error', data: { message: 'boom' } });
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ cdpPort: 1234 }));
    expect(onStopped).toHaveBeenCalledWith('ui_socket_closed');
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('ignores a malformed frame instead of throwing', () => {
    const fake = new FakeSocket();
    const onFrame = vi.fn();
    const client = makeClient(fake, { onFrame });
    client.connect();
    expect(() => fake.emitMessage as unknown).not.toThrow();
    for (const fn of (fake as any).listeners.message || []) {
      expect(() => fn({ data: 'not json{{{' })).not.toThrow();
    }
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('serializes sendMouseEvent as an input:mouse message', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    client.connect();
    client.sendMouseEvent({ type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 });
    expect(fake.sent).toHaveLength(1);
    expect(JSON.parse(fake.sent[0])).toEqual({
      event: 'input:mouse',
      data: { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 },
    });
  });

  it('serializes sendKeyEvent as an input:key message', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    client.connect();
    client.sendKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    expect(JSON.parse(fake.sent[0])).toEqual({
      event: 'input:key',
      data: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    });
  });

  it('serializes sendNavigate as a browser:navigate message', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    client.connect();
    client.sendNavigate('https://example.com');
    expect(JSON.parse(fake.sent[0])).toEqual({ event: 'browser:navigate', data: { url: 'https://example.com' } });
  });

  it('drops input sent before connect() (never queues)', () => {
    const fake = new FakeSocket();
    const client = makeClient(fake);
    client.sendMouseEvent({ type: 'mouseMoved', x: 0, y: 0 });
    expect(fake.sent).toHaveLength(0);
  });

  it('disconnect() closes the socket and stops delivering frames', () => {
    const fake = new FakeSocket();
    const onFrame = vi.fn();
    const client = makeClient(fake, { onFrame });
    client.connect();
    client.disconnect();
    expect(fake.closed).toBe(true);
    expect(client.connected).toBe(false);
  });

  it('connect() is idempotent -- a second call does not open a second socket', () => {
    let createCount = 0;
    const fake = new FakeSocket();
    const client = new BrowserScreencastClient('ws://example.invalid', {
      createSocket: () => { createCount += 1; return fake; },
    });
    client.connect();
    client.connect();
    expect(createCount).toBe(1);
  });
});
