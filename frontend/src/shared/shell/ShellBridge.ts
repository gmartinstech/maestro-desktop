// The full native-shell surface the frontend depends on, abstracted so the same React app can run
// hosted by Electron (electronShell.ts), Tauri (tauriShell.ts), or nothing at all (index.ts's
// nullShell). Source of truth for the member list: electron/preload.js's `contextBridge.exposeInMainWorld('maestro', ...)`.
// TAU-1: this ticket only introduces the indirection — every member here must still mean exactly
// what it means in preload.js today.

/** A single CDP debugger-protocol round-trip result, as returned by the Electron main process. */
export interface ShellCdpResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** One attached out-of-process iframe (OOPIF) child CDP session. */
export interface ShellCdpChildSession {
  sessionId: string;
  frameId: string;
  parentSessionId: string | null;
  url: string;
}

/** A safe (GET/HEAD) API route captured for the current site, used for the fast network-replay tier. */
export interface ShellCdpRoute {
  method: string;
  template?: string;
  example?: string;
  hits?: number;
  safe?: boolean;
}

/** Recent console output captured for a webview, surfaced to the agent for self-debugging. */
export interface ShellWebviewConsoleEntry {
  level: string;
  message: string;
  source?: string;
  line?: number;
}

/** A vetted social platform's partition cookies, handed to its session-backed MCP shim. */
export interface ShellPartitionCookies {
  cookies: Array<{ name: string; value: string }>;
  userAgent: string;
  error?: string;
}

/** Suspend/resume state snapshot for a browser-card tab, staged in the shell before the guest reloads. */
export interface ShellBrowserSessionCapsule {
  ss: Record<string, string>;
  sx: number;
  sy: number;
  origin: string;
  capturedAt: number;
}

/** Cached update status, as reported after a boot-time check or the last explicit user check. */
export interface ShellUpdateStatus {
  status: MaestroCachedUpdateStatus;
  info: { source?: 'microsoft-store'; version?: string; percent?: number } | null;
  error: string | null;
}

/** Crash-recovery info surfaced once, right after a relaunch that followed an unclean exit. */
export interface ShellCrashRecoveryInfo {
  ts: number;
  parent_pid: number;
  uptime_ms: number;
}

/** The provenance stamp for the exact build running, for the About panel / support screenshots. */
export interface ShellBuildInfo {
  sha: string;
  shortSha: string;
  builtAt: string | null;
  channel: string;
}

/** Rectangle in device pixels, used to crop a full-window capture down to just the dashboard viewport. */
export interface ShellCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The native-shell surface. One instance is selected at module load (see index.ts) and imported everywhere else instead of touching the Electron `maestro` global directly. */
export interface ShellBridge {
  // Backend connection: the port the local backend is actually listening on.
  getBackendPort(): number;
  // Fresh re-query of the LIVE backend port, for self-heal if the cached value ever resolved wrong.
  getBackendPortLive(): number;
  // Preload path for the guest <webview>'s own preload script (Electron-only concept; undefined elsewhere).
  getWebviewPreloadPath(): string | undefined;
  // Per-install auth token required for WS + HTTP calls to the localhost backend.
  getAuthToken(): Promise<string>;

  // App identity.
  getAppVersion(): Promise<string>;
  getBuildInfo(): Promise<ShellBuildInfo>;
  // OS the shell is running on, e.g. 'darwin' | 'win32' | 'linux'.
  platform: string;

  // Native window chrome.
  popupAppMenu(x: number, y: number): Promise<void>;
  setTitleBarOverlay(color: string, symbolColor: string): void;

  // Phase 0 boot instrumentation: fired exactly once, when the first streamed agent token paints.
  markFirstAgentResponse(): void;

  openExternal(url: string): Promise<void>;
  // Factory reset: wipes the data dir and relaunches. Never resolves on success (the app exits first).
  hardReset(): Promise<void>;
  // Clears the browser-card partition's cookies/cache/localStorage only, never the app's own session.
  clearBrowserData(): Promise<{ ok: boolean }>;

  // Slack's own OAuth dance, driven from a session-backed partition the shell owns.
  connectSlack(): Promise<{ token: string; cookie: string }>;
  // Cookies for an allowlisted social-platform partition, handed to its session-backed MCP shim.
  getPartitionCookies(domain: string): Promise<ShellPartitionCookies>;
  // Stages a resumed webview's session snapshot so its guest preload can sync-take it at document-start.
  setSessionCapsule(webContentsId: number, capsule: ShellBrowserSessionCapsule): void;

  // CDP group: everything the agent's browser tools need to drive a webview via the debugger protocol.
  sendCdpCommand(webContentsId: number, method: string, params?: unknown, sessionId?: string): Promise<ShellCdpResult>;
  cdpDetachClean(webContentsId: number): Promise<unknown>;
  cdpCacheSet(webContentsId: number, indexMap: Record<number, unknown>): Promise<void>;
  cdpCacheGet(webContentsId: number): Promise<unknown>;
  cdpCacheClear(webContentsId: number): Promise<void>;
  cdpChildSessionsGet(webContentsId: number): Promise<ShellCdpChildSession[]>;
  cdpRoutesGet(webContentsId: number, originFilter?: string): Promise<ShellCdpRoute[]>;
  getWebviewConsole(webContentsId: number): Promise<ShellWebviewConsoleEntry[]>;
  // Screenshots a rectangle of the app window itself (device pixels), for dashboard thumbnails.
  capturePage(rect?: ShellCaptureRect): Promise<string>;

  // Updater group.
  getUpdateStatus(): Promise<ShellUpdateStatus>;
  openStoreUpdates(): Promise<{ success: boolean; error?: string }>;
  getCrashRecoveryInfo(): Promise<ShellCrashRecoveryInfo | null>;
  checkForUpdates(): Promise<{ success: boolean; version?: string; error?: string }>;
  downloadUpdate(): Promise<{ success: boolean; error?: string }>;
  installUpdate(): Promise<void>;
  setAllowPrerelease(value: boolean): Promise<void>;
  onUpdateAvailable(cb: (info: MaestroUpdateInfo) => void): () => void;
  onUpdateNotAvailable(cb: (info: MaestroUpdateInfo) => void): () => void;
  onDownloadProgress(cb: (progress: MaestroDownloadProgress) => void): () => void;
  onUpdateDownloaded(cb: (info: MaestroUpdateInfo) => void): () => void;
  onUpdateError(cb: (message: string) => void): () => void;

  // Backend-death recovery.
  restartApp(): void;
  openBackendLogs(): void;
  onBackendUnrecoverable(cb: (info: { attempts: number; logs?: string }) => void): () => void;

  // Browser/webview group.
  onWebviewNewWindow(cb: (url: string, webContentsId: number, disposition?: string) => void): () => void;
  onReloadShortcut(cb: () => void): () => void;
  onBrowserShortcut(cb: (payload: { action: string; webContentsId: number }) => void): () => void;
  onWindowFocus(cb: (payload: { kind: 'blur' | 'focus'; ts: number }) => void): () => void;

  // OAuth deep-link / loopback-callback channels.
  onOauthClaim(cb: (url: string) => void): () => void;
  onOauthCallback(cb: (data: { code?: string; state?: string; error?: string }) => void): () => void;

  // Referenced by frontend call sites (WebSocketManager.ts) but NOT present in electron/preload.js as
  // of this ticket — already inert no-ops in the shipping Electron app. Kept optional and preserved
  // as-is rather than fixed here, so this refactor stays a pure move, not a behavior change.
  notify?(payload: unknown): void;
  onNotificationAction?(cb: (payload: { outcome: string; runId?: string; workflowId?: string }) => void): () => void;
}
