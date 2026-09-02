// BRW-4: the CDP-canvas rendering path. Rendered by BrowserCard.tsx instead of an Electron
// <webview> when MAESTRO_BROWSER_ENGINE=cdp (see frontend/src/shared/browserEngineMode.ts) --
// paints live Page.startScreencast frames from engine/src/browser/screencastServer.ts onto a
// <canvas>, and posts mouse/keyboard input back over that same WebSocket (via
// browserScreencastClient.ts) instead of window.maestro's Electron CDP bridge.
//
// Deliberately dependency-light: no MUI, no Redux, no i18n -- a plain <canvas> plus the raw
// browser events it needs. Two reasons: (1) BrowserCard.tsx already owns the chrome around this
// (tab bar, URL bar, agent overlays); this component owns only the live page surface, same
// division of responsibility the <webview> branch has today. (2) it lets this exact component be
// mounted standalone (no store/theme/i18n bootstrap) for BRW-4's real-integration gate --
// see browserCanvasCdp.integration-check.tsx -- the same component the packaged app renders, not
// a stand-in.
import React, { useEffect, useRef, useState } from 'react';
import { BrowserScreencastClient, type ScreencastFrameMetadata } from '@/shared/browserScreencastClient';

// The screencast session's own viewport (must match what the engine passes to
// Page.startScreencast -- see screencastServer.ts's DEFAULT_MAX_WIDTH/HEIGHT). The canvas's own
// pixel buffer is fixed at this size and CSS-scaled to fill the card, so click math is a simple
// fraction-of-displayed-rect times this constant, mirroring browserCommandHandler.ts's
// handleClickPoint percent-of-viewport convention.
export const CDP_VIEWPORT_WIDTH = 1280;
export const CDP_VIEWPORT_HEIGHT = 900;

// Chrome's CDP button names, in MouseEvent.button order (0=left,1=middle,2=right).
const BUTTON_NAMES: Array<'left' | 'middle' | 'right'> = ['left', 'middle', 'right'];

function cdpModifiers(e: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): number {
  // CDP's Input.dispatch*Event `modifiers` bitmask: Alt=1, Ctrl=2, Meta/Cmd=4, Shift=8.
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
}

interface Props {
  browserId: string;
  wsUrl: string;
  /** The tab's current URL; a change navigates the live remote page (see sendNavigate). */
  url: string;
  isElementSelectMode?: boolean;
  onGuestSelect?: () => void;
}

const BrowserCanvasCdp: React.FC<Props> = ({ browserId, wsUrl, url, isElementSelectMode = false, onGuestSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<BrowserScreencastClient | null>(null);
  const lastNavigatedUrl = useRef<string>('');
  const [connected, setConnected] = useState(false);
  // Read via ref inside onOpen below so the initial navigate always uses the LATEST url even if
  // it changed between mount and the socket actually opening, without re-running the connect effect.
  const urlRef = useRef(url);
  urlRef.current = url;

  // One screencast connection per browserId for this component's lifetime; reconnecting on every
  // prop change would tear down and relaunch the remote browser (see screencastServer.ts's
  // per-browserId registry) for no reason.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Decode-and-draw the LATEST arrived frame, dropping any that arrived while a decode was
    // already in flight -- never queuing a backlog of stale frames. A naive `img.src = data:...`
    // per frame (the first version of this component) breaks at real screencast frame rates
    // (~60fps): reassigning an <img>'s src before its previous decode's `onload` has fired aborts
    // that decode, and at one new frame every ~16ms the decode can be aborted every single time,
    // so `onload` never fires and the canvas stays permanently blank. Found via the real
    // end-to-end gate (browserCanvasCdp.integration-check.mjs) -- a mocked-frame unit test could
    // not have caught this, only real screencast throughput exposed it.
    let latestFrame: { base64: string; format: 'jpeg' | 'png' } | null = null;
    let decoding = false;
    const drawLoop = (): void => {
      if (decoding) return;
      decoding = true;
      void (async () => {
        while (latestFrame) {
          const { base64, format } = latestFrame;
          latestFrame = null;
          try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: `image/${format}` });
            const bitmap = await createImageBitmap(blob);
            ctx?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close();
          } catch (err) {
            console.warn(`[browser-canvas-cdp] ${browserId}: frame decode failed`, err);
          }
        }
        decoding = false;
      })();
    };

    const onFrame = (base64: string, format: 'jpeg' | 'png', _metadata: ScreencastFrameMetadata, _frameNumber: number) => {
      latestFrame = { base64, format };
      drawLoop();
    };

    const client = new BrowserScreencastClient(wsUrl, {
      // Sending the initial navigate here, not synchronously after connect() below, matters: a
      // WebSocket's readyState is still CONNECTING (not OPEN) for a beat after `new WebSocket()`
      // returns, and send() silently drops while not open (by design -- see
      // browserScreencastClient.ts's own doc on why input is dropped, not queued). onOpen is the
      // earliest point a send() actually reaches the server. Found via the real end-to-end gate
      // (browserCanvasCdp.integration-check.mjs): a synchronous sendNavigate right after connect()
      // never left the browser at all.
      onOpen: () => {
        if (urlRef.current) {
          client.sendNavigate(urlRef.current);
          lastNavigatedUrl.current = urlRef.current;
        }
      },
      onFrame,
      onStarted: () => setConnected(true),
      onStopped: () => setConnected(false),
      onError: (message) => console.warn(`[browser-canvas-cdp] ${browserId}: ${message}`),
      onConnectionError: (err) => console.warn(`[browser-canvas-cdp] ${browserId}: connection error`, err),
    });
    client.connect();
    clientRef.current = client;

    return () => {
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
    // Deliberately NOT re-run on `url` changes (read via urlRef instead, above) -- see the effect below.
  }, [wsUrl, browserId]);

  // A later URL-bar navigation (not the initial mount) drives the same live connection instead of
  // reconnecting -- reconnecting would relaunch the remote browser (see the effect above).
  useEffect(() => {
    if (!url || url === lastNavigatedUrl.current) return;
    lastNavigatedUrl.current = url;
    clientRef.current?.sendNavigate(url);
  }, [url]);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const fracX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const fracY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return {
      x: Math.max(0, Math.min(CDP_VIEWPORT_WIDTH, fracX * CDP_VIEWPORT_WIDTH)),
      y: Math.max(0, Math.min(CDP_VIEWPORT_HEIGHT, fracY * CDP_VIEWPORT_HEIGHT)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    canvasRef.current?.focus();
    onGuestSelect?.();
    const { x, y } = toCanvasCoords(e);
    clientRef.current?.sendMouseEvent({
      type: 'mousePressed', x, y, button: BUTTON_NAMES[e.button] ?? 'left', clickCount: 1, modifiers: cdpModifiers(e),
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    const { x, y } = toCanvasCoords(e);
    clientRef.current?.sendMouseEvent({
      type: 'mouseReleased', x, y, button: BUTTON_NAMES[e.button] ?? 'left', clickCount: 1, modifiers: cdpModifiers(e),
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    const { x, y } = toCanvasCoords(e);
    clientRef.current?.sendMouseEvent({ type: 'mouseMoved', x, y, modifiers: cdpModifiers(e) });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    const { x, y } = toCanvasCoords(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    clientRef.current?.sendMouseEvent({
      type: 'mouseWheel', x, y, deltaX: -e.deltaX, deltaY: -e.deltaY, modifiers: cdpModifiers(e),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    e.preventDefault();
    clientRef.current?.sendKeyEvent({
      type: 'keyDown', key: e.key, code: e.code,
      text: e.key.length === 1 ? e.key : undefined,
      modifiers: cdpModifiers(e),
    });
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (isElementSelectMode) return;
    e.preventDefault();
    clientRef.current?.sendKeyEvent({ type: 'keyUp', key: e.key, code: e.code, modifiers: cdpModifiers(e) });
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="browser-canvas-cdp"
      data-connected={connected ? '1' : '0'}
      width={CDP_VIEWPORT_WIDTH}
      height={CDP_VIEWPORT_HEIGHT}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        cursor: isElementSelectMode ? 'default' : 'default',
        pointerEvents: isElementSelectMode ? 'none' : 'auto',
      }}
    />
  );
};

export default React.memo(BrowserCanvasCdp);
