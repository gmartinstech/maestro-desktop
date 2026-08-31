const { contextBridge, ipcRenderer } = require('electron');

// eslint-disable-next-line no-console
console.log('[diag][preload] start, ua=', navigator.userAgent);

// E2E gate: set the renderer flag BEFORE any page script parses so the
// production-build store-on-window expose fires deterministically when
// Playwright launches with MAESTRO_E2E=1. Read from the Chromium switch
// the main process appended; no-op for normal user launches.
try {
  const args = (typeof process !== 'undefined' && process.argv) ? process.argv : [];
  if (args.some((a) => /--maestro-e2e(=1)?$/.test(a))) {
    contextBridge.exposeInMainWorld('__MAESTRO_E2E__', true);
  }
} catch (e) { console.log('[diag][preload] e2e-flag setup failed:', e && e.message); }

// Synchronous exposure. The previous async IIFE (await ipcRenderer.invoke) raced React mount: any code reading window.maestro during the gap (BrowserCard's Electron-detection falling back to iframe mode, AgentChat's auth-token call throwing) saw undefined. sendSync blocks the renderer for one IPC round-trip during preload before any user-visible paint, so window.maestro is guaranteed to exist before the first frontend bundle evaluates.
// Coalesced into a single round-trip: this used to be two separate sendSync calls (get-backend-port-sync,
// get-webview-preload-path-sync); get-preload-bootstrap-sync returns both values from one main-process handler.
const { port, webviewPreloadPath } = ipcRenderer.sendSync('get-preload-bootstrap-sync');

contextBridge.exposeInMainWorld('__MAESTRO_PORT__', port);

contextBridge.exposeInMainWorld('maestro', {
  getBackendPort: () => port,
  // Fresh re-query of the LIVE backend port (not the cached preload value).
  // Used by the renderer to self-heal if its cached port ever resolved wrong
  // (raced null -> 8324, or backend on a fallback port because 8324 was held).
  getBackendPortLive: () => {
    try { return ipcRenderer.sendSync('get-backend-port-sync'); } catch (_) { return port; }
  },
  getWebviewPreloadPath: () => webviewPreloadPath,

  // Per-install auth token required for WS + HTTP calls to the
  // localhost backend. Returns a Promise<string>. The renderer should
  // await this on startup and include the token on every WS URL
  // (`?token=...`) and HTTP request (`Authorization: Bearer ...`).
  // We deliberately do NOT expose the token as a plain window global
  // or a sync getter: contextBridge + IPC keeps it off the renderer's
  // global object so third-party scripts (including any code that
  // leaks through <webview>) can't scrape it.
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Unified title bar. The renderer branches on platform because macOS keeps its
  // traffic lights (and its real menubar) while Windows/Linux fold both into our bar.
  platform: process.platform,
  popupAppMenu: (x, y) => ipcRenderer.invoke('app-menu:popup', x, y),
  setTitleBarOverlay: (color, symbolColor) => ipcRenderer.send('titlebar:set-overlay', color, symbolColor),

  // Phase 2 provenance: { sha, shortSha, builtAt, channel } for the About panel.
  getBuildInfo: () => ipcRenderer.invoke('get-build-info'),

  // Phase 0 boot instrumentation: renderer calls this exactly once, when the
  // first streamed token of the first agent response paints. Fire-and-forget
  // (send, not invoke) so it never blocks the render path. Main dedupes.
  markFirstAgentResponse: () => ipcRenderer.send('perf:first-agent-response'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Factory reset: wipes the data dir and relaunches. Never resolves on success (the app exits first).
  hardReset: () => ipcRenderer.invoke('hard-reset'),
  // Clears cookies/cache/localStorage for the browser-card partition only (never the app's defaultSession). Logs you out of sites opened in browser cards.
  clearBrowserData: () => ipcRenderer.invoke('browser:clear-data'),
  connectSlack: () => ipcRenderer.invoke('connect-slack'),
  // Hands a vetted social platform's partition cookies to its session-backed MCP shim (allowlisted domains only, gated again in the main process).
  getPartitionCookies: (domain) => ipcRenderer.invoke('get-partition-cookies', domain),
  // Suspend/resume state capsule: stages a resumed webview's sessionStorage snapshot in main (keyed by webContents id, short TTL) so the guest preload can sync-take it at document-start. Fire-and-forget; main validates the sender.
  setSessionCapsule: (wcId, capsule) => ipcRenderer.send('browser-capsule-set', wcId, capsule),
  sendCdpCommand: (wcId, method, params, sessionId) => ipcRenderer.invoke('send-cdp-command', wcId, method, params, sessionId),
  cdpDetachClean: (wcId) => ipcRenderer.invoke('cdp-detach-clean', wcId),
  cdpCacheSet: (wcId, indexMap) => ipcRenderer.invoke('cdp-cache-set', wcId, indexMap),
  cdpCacheGet: (wcId) => ipcRenderer.invoke('cdp-cache-get', wcId),
  cdpCacheClear: (wcId) => ipcRenderer.invoke('cdp-cache-clear', wcId),
  cdpChildSessionsGet: (wcId) => ipcRenderer.invoke('cdp-child-sessions-get', wcId),
  cdpRoutesGet: (wcId, originFilter) => ipcRenderer.invoke('cdp-routes-get', wcId, originFilter),
  getWebviewConsole: (wcId) => ipcRenderer.invoke('get-webview-console', wcId),
  capturePage: (rect) => ipcRenderer.invoke('capture-page', rect),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  openStoreUpdates: () => ipcRenderer.invoke('open-store-updates'),
  getCrashRecoveryInfo: () => ipcRenderer.invoke('get-crash-recovery-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setAllowPrerelease: (value) => ipcRenderer.invoke('set-allow-prerelease', value),

  onUpdateAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateNotAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },
  onDownloadProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  onUpdateError: (cb) => {
    const listener = (_event, message) => cb(message);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },
  // Reuses the splash's action handler (app.relaunch + app.exit / reveal backend.log); it is not splash-specific, and the backend-down notice needs exactly these two.
  restartApp: () => ipcRenderer.send('splash:action', 'restart'),
  openBackendLogs: () => ipcRenderer.send('splash:action', 'open-logs'),
  // The backend died and the bounded restart gave up. The renderer owns the copy because only it has i18n, and pt-BR is the default language.
  onBackendUnrecoverable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('backend-unrecoverable', listener);
    return () => ipcRenderer.removeListener('backend-unrecoverable', listener);
  },

  onWebviewNewWindow: (cb) => {
    const listener = (_event, url, webContentsId, disposition) => cb(url, webContentsId, disposition);
    ipcRenderer.on('webview-new-window', listener);
    return () => ipcRenderer.removeListener('webview-new-window', listener);
  },

  // Cmd/Ctrl+R, intercepted in main (kills the default-menu reload), so the renderer can reload the focused browser instead of the whole app.
  onReloadShortcut: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('maestro:reload-shortcut', listener);
    return () => ipcRenderer.removeListener('maestro:reload-shortcut', listener);
  },

  // In-page browser shortcuts (zoom/find/tab-cycle) from a focused guest webview, carrying the guest's webContents id so the renderer targets that exact browser.
  onBrowserShortcut: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('maestro:browser-shortcut', listener);
    return () => ipcRenderer.removeListener('maestro:browser-shortcut', listener);
  },

  // OAuth claim deep-link channel. Receives maestro://oauth/{provider}/complete
  // after the user finishes an OAuth flow in their browser.
  onOauthClaim: (cb) => {
    const listener = (_event, url) => cb(url);
    ipcRenderer.on('maestro:oauth-claim', listener);
    return () => ipcRenderer.removeListener('maestro:oauth-claim', listener);
  },

  // Window blur/focus events: analytics signal for "user switched to
  // another app" (temp-churn measurement). Throttled in main.js to at
  // most once per 2s per direction so OS-level focus storms don't
  // pollute the event stream.
  onWindowFocus: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('maestro:window-focus', listener);
    return () => ipcRenderer.removeListener('maestro:window-focus', listener);
  },

  // OAuth popup callback. Fires when any child webContents navigates
  // to localhost:20128/callback?code=... main.js watches for this and
  // forwards the parsed params here. Used as a belt-and-suspenders
  // alongside window.opener.postMessage (which silently fails on some
  // Anthropic flows that reset the opener chain during redirect).
  onOauthCallback: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('maestro:oauth-callback', listener);
    return () => ipcRenderer.removeListener('maestro:oauth-callback', listener);
  },
});
