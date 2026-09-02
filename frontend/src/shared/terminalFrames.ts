// Wire codec for the /ws/terminal channel, kept free of React and JSX so `node --test` can cover it.

import type { WsTerminalStatus, WsTerminalOutput, WsTerminalExit } from '../../../contract/ws/terminal';

export interface TerminalStatus {
  running: boolean;
  shell: string;
  cwd: string;
}

export type TerminalFrame =
  | { kind: 'status'; status: TerminalStatus }
  | { kind: 'output'; data: string }
  | { kind: 'exit'; code: number }
  | { kind: 'unknown' };

// atob/btoa are byte-oriented and mangle multi-byte UTF-8 on their own; going through TextDecoder over the raw bytes is the only correct path.
function p_decodeBase64(payload: string): string {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function p_encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeTerminalFrame(raw: string): TerminalFrame {
  let msg: { event?: string; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: 'unknown' };
  }
  const data = msg?.data ?? {};
  if (msg?.event === 'term:status') {
    const status = data as WsTerminalStatus['data'];
    return {
      kind: 'status',
      status: {
        running: Boolean(status.running),
        shell: String(status.shell ?? ''),
        cwd: String(status.cwd ?? ''),
      },
    };
  }
  if (msg?.event === 'term:output') {
    const output = data as WsTerminalOutput['data'];
    try {
      return { kind: 'output', data: p_decodeBase64(String(output.data ?? '')) };
    } catch {
      return { kind: 'unknown' };
    }
  }
  if (msg?.event === 'term:exit') {
    const exit = data as WsTerminalExit['data'];
    return { kind: 'exit', code: Number(exit.code ?? 0) };
  }
  return { kind: 'unknown' };
}

export function encodeInputFrame(data: string): string {
  return JSON.stringify({ event: 'term:input', data: { data: p_encodeBase64(data) } });
}

export function encodeResizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ event: 'term:resize', data: { cols, rows } });
}
