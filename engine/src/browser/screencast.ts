// BRW-3: screencast transport. Streams the live browser tab (launched via BRW-1's launcher.ts,
// see ./launcher.ts) to a remote/embedded UI over a plain WebSocket, using CDP's
// Page.startScreencast, and round-trips mouse/keyboard input back into the page via
// Input.dispatchMouseEvent/Input.dispatchKeyEvent. Gated at the call site (whoever wires this
// into engine/src/server.ts, a later ticket) behind MAESTRO_BROWSER_ENGINE=cdp -- this module
// itself has no server-wiring consumer yet, same posture as launcher.ts before it.
//
// CDP client note: BRW-2 (./cdp.ts) had not landed in engine/src/browser/ yet when this ticket
// started -- see docs/plans/txm-status.md's BRW phase table (queued at the time) -- and landed
// mid-session (a parallel stage of the same BRW workflow run). Checked it before finishing this
// file, and deliberately did NOT switch to it, for two concrete reasons: (1) its low-level
// request/response transport (`CdpTransport`) is a private, unexported class inside cdp.ts --
// there is nothing public to attach a Page.startScreencast listener or Input.dispatch* call to;
// only the higher-level `CdpBrowserPage` (screenshot/click/type/... BrowserAction commands, none
// of them screencast-related) is exported. (2) `CdpBrowserPage.connect()` always opens a brand
// NEW blank tab via CDP's `/json/new`, which is the right lifecycle for one-shot agent commands
// but wrong for a screencast, which needs to watch/control whatever tab is already live (found
// via `/json/list`, see findPageTargetWsUrl below) -- spawning a second, invisible tab would
// stream the wrong page. So this file keeps its own minimal CDP session (connectCdpSession
// below), scoped ONLY to the handful of methods/events it actually needs
// (Page.enable/startScreencast/stopScreencast/screencastFrameAck, the Page.screencastFrame event,
// Input.dispatchMouseEvent/dispatchKeyEvent) rather than the BrowserAction command set BRW-2
// owns. If a later ticket gives cdp.ts a public low-level transport that can attach to an
// existing target, promoting this file onto it (instead of duplicating the JSON-RPC framing) is
// the natural follow-up -- flagged here so it isn't a surprise. One thing this file did adopt
// from BRW-2's file header even though it didn't reuse the code: cdp.ts observes that Node has
// shipped a stable global `WebSocket` client since v22 (no dependency needed) -- true for this
// file's own CDP-side connection too, but this module also needs to accept WS connections FROM
// the watching UI (see UiSocketLike below), and Node has no built-in WebSocket *server* --
// `ws` remains a genuine, justified dependency here for that server side (moved from
// engine/package.json's devDependencies into dependencies, since it is now used at runtime, not
// only by server.test.ts).
//
// WS message shape note: this is a NEW engine-native WebSocket transport with no backend/Python
// equivalent, so it is deliberately NOT one of the five backend-sourced contracts documented under
// contract/ws/ (that directory's README scopes itself explicitly to backend/main.py's five real
// endpoints, enumerated by name). The event/message types below follow the STYLE of
// contract/ws/agents.ts (discriminated union on `event`, one interface per shape, JSDoc per shape)
// but live here, colocated with their only implementation, rather than under contract/ws/ --
// engine/tsconfig.json builds with `rootDir: "src"` + a real `outDir` (not noEmit), so an import
// reaching outside engine/src (e.g. `../../../contract/ws/...`) would fail `tsc -p tsconfig.json`
// ("File is not under 'rootDir'"); restructuring that tsconfig is out of scope for this ticket
// (engine/ is owned by the concurrent ENG phase, and the ticket's own instructions say not to
// restructure what's already there). If engine/ later grows a shared-package boundary that makes
// cross-directory imports safe, this type pair is the natural candidate to promote into
// contract/ws/browser-screencast.ts at that point.

import { WebSocket, type RawData } from 'ws';
// ENG-7: the loopback CDP HTTP probe below routes through the provider-egress allowlist like
// every other outbound call in engine/src -- 127.0.0.1 is always permitted, so this is a
// mechanical swap with no behavior change.
import { engineFetch } from '../net/http';

// ---------------------------------------------------------------------------------------------
// Minimal CDP session (placeholder for BRW-2 -- see file header)
// ---------------------------------------------------------------------------------------------

interface CdpTargetInfo {
  id: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

/** Finds the first "page" target's WS debugger URL via the browser's CDP HTTP endpoint. This is
 * the per-target (not Target.attachToTarget-multiplexed) style of CDP connection -- simplest thing
 * that works for controlling a single tab, which is all this module needs. */
export async function findPageTargetWsUrl(cdpPort: number): Promise<string> {
  const res = await engineFetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list returned ${res.status}`);
  const targets = (await res.json()) as CdpTargetInfo[];
  const page = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
  if (!page?.webSocketDebuggerUrl) throw new Error('No page target with a webSocketDebuggerUrl found via CDP /json/list');
  return page.webSocketDebuggerUrl;
}

export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Subscribes to a CDP event by method name; returns an unsubscribe function. */
  onEvent(method: string, handler: (params: unknown) => void): () => void;
  close(): void;
}

interface CdpResponseMessage {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface CdpEventMessage {
  method: string;
  params?: unknown;
}

/** Opens a raw WS connection to one CDP target's debugger URL and exposes a tiny
 * request/response + event-subscription session over it. */
export function connectCdpSession(wsUrl: string): Promise<CdpSession> {
  return new Promise((resolve, reject) => {
    // maxPayload raised well past the default (~100MB is plenty of headroom for the largest
    // base64 screencast frame this module will ever see at 1280x900) -- CDP frame payloads are
    // small individually (tens to low-hundreds of KB), but the default `ws` limit is conservative.
    const socket = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const eventHandlers = new Map<string, Set<(params: unknown) => void>>();
    let settled = false;

    socket.once('open', () => {
      settled = true;
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent(method, handler) {
          let set = eventHandlers.get(method);
          if (!set) {
            set = new Set();
            eventHandlers.set(method, set);
          }
          set.add(handler);
          return () => set?.delete(handler);
        },
        close() {
          socket.close();
        },
      });
    });

    socket.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    socket.on('message', (raw: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return; // not valid JSON -- ignore rather than crash the session over one bad frame
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const msg = parsed as Record<string, unknown>;

      if (typeof msg.id === 'number') {
        const response = msg as unknown as CdpResponseMessage;
        const waiting = pending.get(response.id);
        if (!waiting) return;
        pending.delete(response.id);
        if (response.error) waiting.reject(new Error(response.error.message ?? 'CDP command error'));
        else waiting.resolve(response.result);
        return;
      }

      const evt = msg as unknown as CdpEventMessage;
      if (typeof evt.method === 'string') {
        const handlers = eventHandlers.get(evt.method);
        if (handlers) for (const h of handlers) h(evt.params);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Wire message shapes (see file header for why these live here, not under contract/ws/)
// ---------------------------------------------------------------------------------------------

/** Mirrors CDP's own Page.screencastFrame `metadata` shape. */
export interface ScreencastFrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

/** Sent once Page.startScreencast has been accepted by CDP. */
export interface ScreencastStarted {
  event: 'screencast:started';
  data: { cdpPort: number; format: 'jpeg' | 'png'; maxWidth: number; maxHeight: number };
}

/** One video frame. `base64` is the frame image, already base64-encoded by CDP (jpeg or png per
 * `format`) -- forwarded as-is, never re-encoded, so the UI can hand it straight to an <img> src
 * or a canvas draw call. `frameNumber` is this session's own monotonic counter (not CDP's
 * `sessionId`, which is an ack-correlation id, not a display counter). */
export interface ScreencastFrame {
  event: 'screencast:frame';
  data: { frameNumber: number; format: 'jpeg' | 'png'; base64: string; metadata: ScreencastFrameMetadata };
}

export interface ScreencastStopped {
  event: 'screencast:stopped';
  data: { reason: string; framesSent: number; framesDropped: number };
}

export interface ScreencastError {
  event: 'screencast:error';
  data: { message: string };
}

/** Discriminated union of every message this module sends to the watching UI. Discriminate on
 * `event`, same pattern as contract/ws/agents.ts's AgentWsServerEvent. */
export type ScreencastServerEvent = ScreencastStarted | ScreencastFrame | ScreencastStopped | ScreencastError;

/** One mouse event from the UI, translated 1:1 into Input.dispatchMouseEvent. Coordinates are in
 * CSS pixels within the streamed viewport (maxWidth x maxHeight), matching what CDP expects. */
export interface ScreencastInputMouse {
  event: 'input:mouse';
  data: {
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle' | 'none';
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
    modifiers?: number;
  };
}

/** One keyboard event from the UI, translated 1:1 into Input.dispatchKeyEvent. */
export interface ScreencastInputKey {
  event: 'input:key';
  data: {
    type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char';
    key?: string;
    code?: string;
    text?: string;
    unmodifiedText?: string;
    windowsVirtualKeyCode?: number;
    modifiers?: number;
  };
}

/** Discriminated union of every message this module accepts from the watching UI. */
export type ScreencastClientEvent = ScreencastInputMouse | ScreencastInputKey;

function isScreencastClientEvent(v: unknown): v is ScreencastClientEvent {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (o.event === 'input:mouse' || o.event === 'input:key') && typeof o.data === 'object' && o.data !== null;
}

// ---------------------------------------------------------------------------------------------
// The UI-facing side: the minimal socket surface this module needs. Deliberately narrower than
// `ws`'s full WebSocket type so a unit test can hand in a plain fake without dragging in a real
// socket (same DI spirit as launcher.ts's ResolveDeps).
// ---------------------------------------------------------------------------------------------

export interface UiSocketLike {
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
  on(event: 'message', cb: (raw: RawData) => void): void;
  off(event: 'message', cb: (raw: RawData) => void): void;
  once(event: 'close', cb: () => void): void;
}

const P_WS_READY_STATE_OPEN = 1;

// Backpressure threshold: if the UI socket already has more than this many bytes queued and not
// yet flushed to the OS (bufferedAmount), the next incoming CDP frame is DROPPED rather than
// queued behind it. ~512KB is a few frames of headroom at the ticket's target resolution
// (1280x900 jpeg frames typically run tens-to-low-hundreds of KB) -- enough to absorb a brief
// stall without dropping on every single frame, small enough that a genuinely slow/stuck client
// stays bounded to a small, constant amount of stale data in flight rather than an
// ever-growing queue. Queueing instead of dropping here would make latency grow without bound
// under sustained load, which is the exact failure mode the ticket calls out.
const P_MAX_BUFFERED_BYTES = 512 * 1024;

export interface ScreencastOptions {
  format?: 'jpeg' | 'png';
  /** jpeg only; ignored for png. 0-100. */
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Send every Nth frame CDP produces; 1 = every frame. */
  everyNthFrame?: number;
}

const P_DEFAULT_FORMAT = 'jpeg' as const;
const P_DEFAULT_MAX_WIDTH = 1280;
const P_DEFAULT_MAX_HEIGHT = 900;
const P_DEFAULT_QUALITY = 80;
const P_DEFAULT_EVERY_NTH_FRAME = 1;

export interface ScreencastSession {
  stop(): Promise<void>;
  /** Live counters, useful for logging/tests; not part of the wire protocol. */
  readonly framesSent: number;
  readonly framesDropped: number;
}

// Injected for unit testing: lets the frame-forwarding/backpressure/input-translation logic run
// against a fake CDP session and a fake UI socket, with no real browser or network involved.
export interface ScreencastDeps {
  findPageTargetWsUrl: (cdpPort: number) => Promise<string>;
  connectCdpSession: (wsUrl: string) => Promise<CdpSession>;
}

function defaultScreencastDeps(): ScreencastDeps {
  return { findPageTargetWsUrl, connectCdpSession };
}

interface RawScreencastFrameParams {
  data: string;
  metadata: ScreencastFrameMetadata;
  sessionId: number;
}

function isScreencastFrameParams(v: unknown): v is RawScreencastFrameParams {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.data === 'string' && typeof o.sessionId === 'number' && typeof o.metadata === 'object' && o.metadata !== null;
}

/**
 * Wires an already-open UI-side WebSocket-like connection to a live browser tab's CDP screencast
 * and input. The caller owns accepting/upgrading `uiSocket` (this module has no opinion on how the
 * connection was established, same as launcher.ts having no opinion on who spawns the browser).
 *
 * - Frames: CDP `Page.screencastFrame` -> `screencast:frame` sent on `uiSocket`. Every CDP frame is
 *   ack'd immediately and unconditionally (`Page.screencastFrameAck`) regardless of whether it
 *   ends up forwarded -- that ack is what keeps the browser producing frames at a steady rate.
 *   Whether the frame is actually forwarded is a separate decision: if `uiSocket.bufferedAmount`
 *   is already above the backpressure threshold, the frame is DROPPED, never queued (see
 *   P_MAX_BUFFERED_BYTES's comment for why).
 * - Input: `input:mouse` / `input:key` messages received on `uiSocket` are translated 1:1 into
 *   `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` CDP calls against the same page.
 */
export async function startScreencastSession(
  uiSocket: UiSocketLike,
  cdpPort: number,
  options: ScreencastOptions = {},
  deps: ScreencastDeps = defaultScreencastDeps(),
): Promise<ScreencastSession> {
  const format = options.format ?? P_DEFAULT_FORMAT;
  const maxWidth = options.maxWidth ?? P_DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? P_DEFAULT_MAX_HEIGHT;
  const quality = options.quality ?? P_DEFAULT_QUALITY;
  const everyNthFrame = options.everyNthFrame ?? P_DEFAULT_EVERY_NTH_FRAME;

  const wsUrl = await deps.findPageTargetWsUrl(cdpPort);
  const cdp = await deps.connectCdpSession(wsUrl);

  let framesSent = 0;
  let framesDropped = 0;
  let stopped = false;

  function sendToUi(evt: ScreencastServerEvent): void {
    if (uiSocket.readyState !== P_WS_READY_STATE_OPEN) return;
    uiSocket.send(JSON.stringify(evt));
  }

  const unsubscribeFrame = cdp.onEvent('Page.screencastFrame', (rawParams) => {
    if (!isScreencastFrameParams(rawParams)) return;
    const { data, metadata, sessionId } = rawParams;

    // Ack first, unconditionally -- see doc comment above.
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {
      /* session may already be tearing down; a missed ack just means one fewer frame arrives */
    });

    if (uiSocket.bufferedAmount > P_MAX_BUFFERED_BYTES) {
      framesDropped += 1;
      return; // DROP, never queue -- see P_MAX_BUFFERED_BYTES's comment
    }

    framesSent += 1;
    sendToUi({ event: 'screencast:frame', data: { frameNumber: framesSent, format, base64: data, metadata } });
  });

  function dispatchMouse(d: ScreencastInputMouse['data']): void {
    const params: Record<string, unknown> = {
      type: d.type,
      x: d.x,
      y: d.y,
      button: d.button ?? 'left',
      clickCount: d.clickCount ?? (d.type === 'mousePressed' || d.type === 'mouseReleased' ? 1 : 0),
      modifiers: d.modifiers ?? 0,
    };
    if (d.deltaX !== undefined) params.deltaX = d.deltaX;
    if (d.deltaY !== undefined) params.deltaY = d.deltaY;
    void cdp.send('Input.dispatchMouseEvent', params).catch((err: unknown) => {
      sendToUi({ event: 'screencast:error', data: { message: `input:mouse failed: ${String(err)}` } });
    });
  }

  function dispatchKey(d: ScreencastInputKey['data']): void {
    const params: Record<string, unknown> = { type: d.type, modifiers: d.modifiers ?? 0 };
    if (d.key !== undefined) params.key = d.key;
    if (d.code !== undefined) params.code = d.code;
    if (d.text !== undefined) params.text = d.text;
    if (d.unmodifiedText !== undefined) params.unmodifiedText = d.unmodifiedText;
    else if (d.text !== undefined) params.unmodifiedText = d.text;
    if (d.windowsVirtualKeyCode !== undefined) {
      params.windowsVirtualKeyCode = d.windowsVirtualKeyCode;
      params.nativeVirtualKeyCode = d.windowsVirtualKeyCode;
    }
    void cdp.send('Input.dispatchKeyEvent', params).catch((err: unknown) => {
      sendToUi({ event: 'screencast:error', data: { message: `input:key failed: ${String(err)}` } });
    });
  }

  function onUiMessage(raw: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return; // malformed frame from the UI -- ignore rather than crash the session
    }
    if (!isScreencastClientEvent(parsed)) return;
    if (parsed.event === 'input:mouse') dispatchMouse(parsed.data);
    else dispatchKey(parsed.data);
  }
  uiSocket.on('message', onUiMessage);

  async function stop(reason = 'stopped'): Promise<void> {
    if (stopped) return;
    stopped = true;
    unsubscribeFrame();
    uiSocket.off('message', onUiMessage);
    try {
      await cdp.send('Page.stopScreencast');
    } catch {
      /* best-effort */
    }
    cdp.close();
    sendToUi({ event: 'screencast:stopped', data: { reason, framesSent, framesDropped } });
  }

  uiSocket.once('close', () => {
    void stop('ui_socket_closed');
  });

  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.startScreencast', { format, quality, maxWidth, maxHeight, everyNthFrame });
  } catch (err) {
    unsubscribeFrame();
    uiSocket.off('message', onUiMessage);
    cdp.close();
    throw err;
  }
  sendToUi({ event: 'screencast:started', data: { cdpPort, format, maxWidth, maxHeight } });

  return {
    stop,
    get framesSent() {
      return framesSent;
    },
    get framesDropped() {
      return framesDropped;
    },
  };
}
