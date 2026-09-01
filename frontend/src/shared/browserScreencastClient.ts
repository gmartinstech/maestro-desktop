// frontend/src/shared/browserScreencastClient.ts -- BRW-4: the frontend half of BRW-3's
// screencast wire protocol (engine/src/browser/screencast.ts). Duplicated here rather than
// imported: frontend/ and engine/ are separate builds with no shared package boundary (same
// reasoning screencast.ts's own header gives for not moving its wire types under contract/ws/),
// and this side only ever needs to construct client->server messages and parse server->client
// ones -- a small, stable subset worth keeping in sync by hand rather than by import.
//
// Framework-agnostic on purpose (no React import) so BrowserCanvasCdp.tsx stays a thin view over
// this, and so this file's own logic -- frame dispatch, input serialization, connection lifecycle
// -- is unit-testable against a fake socket with no real network or React involved (see
// browserScreencastClient.test.ts).

export interface ScreencastFrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

export type ScreencastServerEvent =
  | { event: 'screencast:started'; data: { cdpPort: number; format: 'jpeg' | 'png'; maxWidth: number; maxHeight: number } }
  | { event: 'screencast:frame'; data: { frameNumber: number; format: 'jpeg' | 'png'; base64: string; metadata: ScreencastFrameMetadata } }
  | { event: 'screencast:stopped'; data: { reason: string; framesSent: number; framesDropped: number } }
  | { event: 'screencast:error'; data: { message: string } };

export interface MouseEventInput {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle' | 'none';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface KeyEventInput {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char';
  key?: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  windowsVirtualKeyCode?: number;
  modifiers?: number;
}

// Minimal WebSocket surface this client needs -- lets a unit test hand in a plain fake instead of
// a real socket, same DI spirit as launcher.ts's ResolveDeps / screencast.ts's ScreencastDeps.
export interface ScreencastSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: 'open' | 'message' | 'close' | 'error', cb: (ev: any) => void) => void;
  removeEventListener: (type: 'open' | 'message' | 'close' | 'error', cb: (ev: any) => void) => void;
}

export interface ScreencastClientOptions {
  // Fires once the underlying socket's own 'open' event fires -- i.e. once send() will actually
  // deliver, not merely once connect() has been called. A send() issued synchronously right after
  // connect() (readyState is still CONNECTING, not OPEN, at that point) is dropped by the
  // connected-check in send() below; callers with something that MUST reach the server on
  // connect (BrowserCanvasCdp.tsx's initial sendNavigate) belong here, not right after connect().
  onOpen?: () => void;
  onFrame?: (base64: string, format: 'jpeg' | 'png', metadata: ScreencastFrameMetadata, frameNumber: number) => void;
  onStarted?: (data: { cdpPort: number; format: 'jpeg' | 'png'; maxWidth: number; maxHeight: number }) => void;
  onStopped?: (reason: string) => void;
  onError?: (message: string) => void;
  onConnectionError?: (err: unknown) => void;
  // Defaults to the real global WebSocket; injectable for tests.
  createSocket?: (url: string) => ScreencastSocketLike;
}

const WS_OPEN = 1;

// One connection to engine/src/browser/screencastServer.ts's WS endpoint for a single
// browser/tab. Owns nothing about rendering -- BrowserCanvasCdp.tsx supplies onFrame and draws.
export class BrowserScreencastClient {
  private socket: ScreencastSocketLike | null = null;
  private readonly onOpen = (): void => this.opts.onOpen?.();
  private readonly onMessage = (ev: { data: string }): void => this.handleMessage(ev.data);
  private readonly onSocketError = (ev: unknown): void => this.opts.onConnectionError?.(ev);

  constructor(private readonly url: string, private readonly opts: ScreencastClientOptions = {}) {}

  connect(): void {
    if (this.socket) return; // already connecting/connected
    const create = this.opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as ScreencastSocketLike);
    const socket = create(this.url);
    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('error', this.onSocketError);
    this.socket = socket;
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeEventListener('open', this.onOpen);
    this.socket.removeEventListener('message', this.onMessage);
    this.socket.removeEventListener('error', this.onSocketError);
    try { this.socket.close(); } catch { /* already closing/closed */ }
    this.socket = null;
  }

  get connected(): boolean {
    return !!this.socket && this.socket.readyState === WS_OPEN;
  }

  private handleMessage(raw: string): void {
    let msg: ScreencastServerEvent;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // malformed frame from the server -- ignore rather than throw into a render loop
    }
    switch (msg.event) {
      case 'screencast:started':
        this.opts.onStarted?.(msg.data);
        break;
      case 'screencast:frame':
        this.opts.onFrame?.(msg.data.base64, msg.data.format, msg.data.metadata, msg.data.frameNumber);
        break;
      case 'screencast:stopped':
        this.opts.onStopped?.(msg.data.reason);
        break;
      case 'screencast:error':
        this.opts.onError?.(msg.data.message);
        break;
      default:
        break; // forward-compat: an unknown event shape is ignored, not fatal
    }
  }

  private send(payload: Record<string, unknown>): void {
    // Dropped, not queued, when not connected -- matches screencast.ts's own backpressure
    // posture (never build an unbounded backlog of stale input behind a slow/reconnecting link).
    if (!this.connected) return;
    this.socket!.send(JSON.stringify(payload));
  }

  sendMouseEvent(data: MouseEventInput): void {
    this.send({ event: 'input:mouse', data });
  }

  sendKeyEvent(data: KeyEventInput): void {
    this.send({ event: 'input:key', data });
  }

  // Extension beyond BRW-3's own wire protocol -- engine/src/browser/screencastServer.ts handles
  // this with its own listener alongside startScreencastSession's (see that file's header) so the
  // URL bar can drive the same live tab, not only mouse/keyboard.
  sendNavigate(url: string): void {
    this.send({ event: 'browser:navigate', data: { url } });
  }
}
