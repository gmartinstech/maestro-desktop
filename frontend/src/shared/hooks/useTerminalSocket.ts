// Raw WebSocket rather than WebSocketManager: that class is session/dashboard-scoped and dispatches into Redux, and terminal bytes have no business passing through the store. Mirrors useRuntimePreviewUrl's ref-pinned-callback shape.

import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAuthToken } from '@/shared/config';
import {
  decodeTerminalFrame,
  encodeInputFrame,
  encodeResizeFrame,
  TerminalStatus,
} from '@/shared/terminalFrames';

export interface TerminalSocketOptions {
  workspaceId: string | null | undefined;
  /** Gate the connect so a Shell tab nobody opened never spawns a shell. */
  enabled?: boolean;
  instance?: number;
  onOutput?: (data: string) => void;
}

export interface TerminalSocketState {
  status: TerminalStatus | null;
  exitCode: number | null;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useTerminalSocket(opts: TerminalSocketOptions): TerminalSocketState {
  const { workspaceId, enabled = true, instance = 1, onOutput } = opts;
  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Pin the latest callback so its identity changing never tears down the socket and respawns the shell.
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;

  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let cancelled = false;
    setStatus(null);
    setExitCode(null);
    const auth = getAuthToken();
    const wsBase = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');
    const url = `${wsBase}/ws/terminal/${workspaceId}?token=${encodeURIComponent(auth || '')}&instance=${instance}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (cancelled) return;
        const frame = decodeTerminalFrame(String(ev.data));
        if (frame.kind === 'status') setStatus(frame.status);
        else if (frame.kind === 'output') onOutputRef.current?.(frame.data);
        else if (frame.kind === 'exit') setExitCode(frame.code);
      };
    } catch {
      // Construction failure leaves status null; the pane renders its disconnected state.
    }
    return () => {
      cancelled = true;
      try { ws?.close(); } catch { /* already gone */ }
      wsRef.current = null;
    };
  }, [workspaceId, enabled, instance]);

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encodeInputFrame(data));
  };

  const sendResize = (cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encodeResizeFrame(cols, rows));
  };

  return { status, exitCode, sendInput, sendResize };
}
