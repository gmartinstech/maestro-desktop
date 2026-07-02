// App terminal plumbing shared by the ViewEditor and dashboard-card Terminal panes:
// a batched beacon that folds webview console lines into the backend runtime stream
// (ring buffer -> WS subscribers -> agent-readable .openswarm/terminal.log), and the
// stream->TerminalLine mapping for lines arriving back over the runtime logs WS.
import { API_BASE, getAuthToken } from '@/shared/config';

export interface AppTerminalLineFields {
  source: 'frontend' | 'backend' | 'runtime';
  level: string;
  text: string;
}

// Batched so a chatty console (tick loops, HMR spam) costs one request/second, not one per line.
const FLUSH_MS = 1000;
const MAX_LINES_PER_FLUSH = 50;

interface PendingConsoleLine { level: string; text: string }

const pendingByWorkspace = new Map<string, PendingConsoleLine[]>();
const flushTimers = new Map<string, number>();

function flushConsoleLines(workspaceId: string): void {
  flushTimers.delete(workspaceId);
  const queue = pendingByWorkspace.get(workspaceId);
  if (!queue || queue.length === 0) return;
  const batch = queue.splice(0, MAX_LINES_PER_FLUSH);
  if (queue.length > 0) {
    batch.push({ level: 'warn', text: `[console] dropped ${queue.length} lines (rate cap)` });
    queue.length = 0;
  }
  const tok = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/console-log`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ lines: batch }),
  }).catch(() => {});
}

export function postAppConsoleLine(workspaceId: string, level: string, text: string): void {
  if (!workspaceId || !text) return;
  let queue = pendingByWorkspace.get(workspaceId);
  if (!queue) {
    queue = [];
    pendingByWorkspace.set(workspaceId, queue);
  }
  queue.push({ level, text });
  if (!flushTimers.has(workspaceId)) {
    flushTimers.set(workspaceId, window.setTimeout(() => flushConsoleLines(workspaceId), FLUSH_MS));
  }
}

export function terminalLineFromStream(stream: string, text: string): AppTerminalLineFields {
  if (stream === 'runtime') return { source: 'runtime', level: 'info', text };
  if (stream.startsWith('frontend')) {
    const level = stream === 'frontend-warn' ? 'warn' : stream === 'frontend-error' ? 'error' : 'log';
    return { source: 'frontend', level, text };
  }
  return { source: 'backend', level: stream, text };
}
