// Hides legacy /serve/ vs new-mode Vite-runtime split for preview URLs; ref-counted spawn.

import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAuthToken } from '@/shared/config';

export interface RuntimeLogLine {
  source: 'backend' | 'runtime';
  stream: string;
  text: string;
}

export interface RuntimePreviewState {
  frontendUrl: string | null;
  isNewMode: boolean;
  // True until the runtime:status frame lands; prevents placeholder flash on remount when Vite is up.
  isHydrating: boolean;
  // PKG-2: true when the workspace's own backend needs Python 3 and none was found on the host.
  // Not agent-fixable (no amount of code editing installs an interpreter), so callers should show
  // this instead of treating the workspace as merely still booting.
  pythonMissing: boolean;
  pythonMissingDetail: string;
}

interface RuntimeStatusResponse {
  frontend_url?: string | null;
  is_new_mode?: boolean;
  python_missing?: boolean;
  python_missing_detail?: string;
}

// PKG-2: the runtime-logs WS (see server.ts's split routing) isn't wired for a native, no-Python-
// backend engine yet, so this can't rely solely on the 'runtime:status' WS frame to learn whether
// Python was found -- /runtime/start and /runtime/status are already-native HTTP routes that carry
// the same fields, so this polls them directly as a transport-independent path for that one signal.
const STATUS_POLL_INTERVAL_MS = 1500;
const STATUS_POLL_MAX_ATTEMPTS = 40;

export interface RuntimePreviewOptions {
  workspaceId: string | null | undefined;
  /** Gate the spawn so callers can defer paying runtime cost until preview is wanted. */
  enabled?: boolean;
  onLog?: (line: RuntimeLogLine) => void;
  /** Which independent instance of the app to attach (1 = primary). Each instance is its own process on its own ports. */
  instance?: number;
}

export function useRuntimePreviewUrl(opts: RuntimePreviewOptions): RuntimePreviewState {
  const { workspaceId, enabled = true, onLog, instance = 1 } = opts;
  const [frontendUrl, setFrontendUrl] = useState<string | null>(null);
  const [isNewMode, setIsNewMode] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [pythonMissing, setPythonMissing] = useState(false);
  const [pythonMissingDetail, setPythonMissingDetail] = useState('');
  // Pin latest onLog so callback identity changes don't tear down/respawn the runtime.
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setIsHydrating(false);
      return;
    }
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    setFrontendUrl(null);
    setIsNewMode(false);
    setIsHydrating(true);
    setPythonMissing(false);
    setPythonMissingDetail('');
    // 150ms: warm starts deliver status in 20-100ms; long enough to skip placeholder flash, short enough to not stall cold starts.
    const hydrationTimer = setTimeout(() => {
      if (!cancelled) setIsHydrating(false);
    }, 150);

    const auth = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;

    // Shared by the initial /runtime/start response and every /runtime/status poll below.
    const applyStatus = (status: RuntimeStatusResponse): boolean => {
      const fu = status.frontend_url ?? null;
      setFrontendUrl(fu || null);
      setIsNewMode(!!status.is_new_mode);
      setPythonMissing(!!status.python_missing);
      setPythonMissingDetail(status.python_missing_detail ?? '');
      setIsHydrating(false);
      return !!fu || !!status.python_missing;
    };

    // PKG-2: polls the already-native /runtime/status HTTP route so pythonMissing reaches the UI
    // even where the runtime-logs WS isn't wired (a native, no-Python-backend engine -- see this
    // file's own header). Stops once resolved (frontend up, or python confirmed missing) or after
    // STATUS_POLL_MAX_ATTEMPTS, so a genuinely stuck workspace doesn't poll forever.
    const pollStatus = (attempt: number): void => {
      if (cancelled || attempt >= STATUS_POLL_MAX_ATTEMPTS) return;
      pollTimer = setTimeout(() => {
        if (cancelled) return;
        fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/status?instance=${instance}`, { headers })
          .then((r) => (r.ok ? r.json() : null))
          .then((status: RuntimeStatusResponse | null) => {
            if (cancelled || !status) { pollStatus(attempt + 1); return; }
            const resolved = applyStatus(status);
            if (!resolved) pollStatus(attempt + 1);
          })
          .catch(() => { if (!cancelled) pollStatus(attempt + 1); });
      }, STATUS_POLL_INTERVAL_MS);
    };

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/start?instance=${instance}`, {
          method: 'POST',
          headers,
        });
        if (!cancelled && res.ok) {
          const status = (await res.json()) as RuntimeStatusResponse;
          if (!applyStatus(status)) pollStatus(0);
        }
      } catch (_) {
        // Spawn errors surface via the log WS; don't double-report.
      }
      if (cancelled) return;
      try {
        const wsBase = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');
        const url = `${wsBase}/ws/outputs/runtime/${workspaceId}/logs?token=${encodeURIComponent(auth || '')}&instance=${instance}`;
        ws = new WebSocket(url);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event === 'runtime:status') {
              applyStatus(msg.data ?? {});
            } else if (msg.event === 'runtime:log') {
              const stream = msg.data?.stream || 'stdout';
              const text = msg.data?.text || '';
              const source: RuntimeLogLine['source'] = stream === 'runtime' ? 'runtime' : 'backend';
              onLogRef.current?.({ source, stream, text });
            }
          } catch (_) {
            // Malformed frame; safe to drop.
          }
        };
      } catch (_) {
        // WS construction failed; caller stays in "no preview yet" state.
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(hydrationTimer);
      if (pollTimer) clearTimeout(pollTimer);
      try { ws?.close(); } catch (_) {}
      setFrontendUrl(null);
      setIsNewMode(false);
      setIsHydrating(true);
      setPythonMissing(false);
      setPythonMissingDetail('');
      // detach is ref-counted on the backend; fire-and-forget.
      fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/stop?instance=${instance}`, {
        method: 'POST',
        headers,
      }).catch(() => {});
    };
  }, [workspaceId, enabled, instance]);

  return { frontendUrl, isNewMode, isHydrating, pythonMissing, pythonMissingDetail };
}

export interface PickPreviewUrlOptions {
  workspaceId: string | null | undefined;
  /** Pre-new-mode URL the component used (serve/index.html); overridden by frontendUrl when ready. */
  legacyUrl: string | undefined;
  frontendUrl: string | null;
  isNewMode: boolean;
}

export interface PickPreviewUrlResult {
  /** undefined => render placeholder (new-mode and Vite not bound yet). */
  url: string | undefined;
  isBooting: boolean;
}

export function pickPreviewUrl(opts: PickPreviewUrlOptions): PickPreviewUrlResult {
  const { legacyUrl, frontendUrl, isNewMode, workspaceId } = opts;
  if (!workspaceId) {
    return { url: legacyUrl, isBooting: false };
  }
  if (isNewMode && !frontendUrl) {
    return { url: undefined, isBooting: true };
  }
  return { url: frontendUrl ?? legacyUrl, isBooting: false };
}
