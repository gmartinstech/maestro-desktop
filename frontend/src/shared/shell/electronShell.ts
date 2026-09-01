import type { ShellBridge } from './ShellBridge';

// TAU-1: the ONLY file in frontend/src allowed to reference `window.maestro` — every other call
// site imports `shell` from './index' instead. Every member here is a pure passthrough: it calls
// the corresponding window.maestro member and nothing else, so Electron's behavior is byte-for-byte
// unchanged by this refactor. `window.maestro`'s ambient type (frontend/src/types/electron.d.ts) is
// a narrower legacy subset, so this cast asserts the full runtime shape electron/preload.js actually
// exposes rather than widening that global type.
// Typed as possibly-undefined: index.ts imports this module unconditionally on every platform
// (Tauri, plain browser) so the ONLY thing this top level may do when window.maestro is absent is
// build an inert, never-selected object — every member below is a closure (or, for `platform`,
// optional-chained) so none of it runs or throws until electronShell is actually selected, which
// index.ts only does once window.maestro is confirmed present.
const maestro = (window as unknown as { maestro?: ShellBridge }).maestro;

export const electronShell: ShellBridge = {
  getBackendPort: () => maestro!.getBackendPort(),
  getBackendPortLive: () => maestro!.getBackendPortLive(),
  getWebviewPreloadPath: () => maestro!.getWebviewPreloadPath(),
  getAuthToken: () => maestro!.getAuthToken(),

  getAppVersion: () => maestro!.getAppVersion(),
  getBuildInfo: () => maestro!.getBuildInfo(),
  platform: maestro?.platform ?? '',

  popupAppMenu: (x, y) => maestro!.popupAppMenu(x, y),
  setTitleBarOverlay: (color, symbolColor) => maestro!.setTitleBarOverlay(color, symbolColor),

  markFirstAgentResponse: () => maestro!.markFirstAgentResponse(),

  openExternal: (url) => maestro!.openExternal(url),
  hardReset: () => maestro!.hardReset(),
  clearBrowserData: () => maestro!.clearBrowserData(),

  connectSlack: () => maestro!.connectSlack(),
  getPartitionCookies: (domain) => maestro!.getPartitionCookies(domain),
  setSessionCapsule: (webContentsId, capsule) => maestro!.setSessionCapsule(webContentsId, capsule),

  sendCdpCommand: (webContentsId, method, params, sessionId) => maestro!.sendCdpCommand(webContentsId, method, params, sessionId),
  cdpDetachClean: (webContentsId) => maestro!.cdpDetachClean(webContentsId),
  cdpCacheSet: (webContentsId, indexMap) => maestro!.cdpCacheSet(webContentsId, indexMap),
  cdpCacheGet: (webContentsId) => maestro!.cdpCacheGet(webContentsId),
  cdpCacheClear: (webContentsId) => maestro!.cdpCacheClear(webContentsId),
  cdpChildSessionsGet: (webContentsId) => maestro!.cdpChildSessionsGet(webContentsId),
  cdpRoutesGet: (webContentsId, originFilter) => maestro!.cdpRoutesGet(webContentsId, originFilter),
  getWebviewConsole: (webContentsId) => maestro!.getWebviewConsole(webContentsId),
  capturePage: (rect) => maestro!.capturePage(rect),

  getUpdateStatus: () => maestro!.getUpdateStatus(),
  openStoreUpdates: () => maestro!.openStoreUpdates(),
  getCrashRecoveryInfo: () => maestro!.getCrashRecoveryInfo(),
  checkForUpdates: () => maestro!.checkForUpdates(),
  downloadUpdate: () => maestro!.downloadUpdate(),
  installUpdate: () => maestro!.installUpdate(),
  setAllowPrerelease: (value) => maestro!.setAllowPrerelease(value),
  onUpdateAvailable: (cb) => maestro!.onUpdateAvailable(cb),
  onUpdateNotAvailable: (cb) => maestro!.onUpdateNotAvailable(cb),
  onDownloadProgress: (cb) => maestro!.onDownloadProgress(cb),
  onUpdateDownloaded: (cb) => maestro!.onUpdateDownloaded(cb),
  onUpdateError: (cb) => maestro!.onUpdateError(cb),

  restartApp: () => maestro!.restartApp(),
  openBackendLogs: () => maestro!.openBackendLogs(),
  onBackendUnrecoverable: (cb) => maestro!.onBackendUnrecoverable(cb),

  onWebviewNewWindow: (cb) => maestro!.onWebviewNewWindow(cb),
  onReloadShortcut: (cb) => maestro!.onReloadShortcut(cb),
  onBrowserShortcut: (cb) => maestro!.onBrowserShortcut(cb),
  onWindowFocus: (cb) => maestro!.onWindowFocus(cb),

  onOauthClaim: (cb) => maestro!.onOauthClaim(cb),
  onOauthCallback: (cb) => maestro!.onOauthCallback(cb),

  // Not in electron/preload.js today: left `undefined` unless the running build happens to expose
  // one, matching today's `window.maestro.notify` being absent, so callers' own `if (!x) return`
  // guards behave exactly as they do now (a pure passthrough adds no feature preload doesn't have).
  notify: maestro?.notify ? (payload) => maestro?.notify?.(payload) : undefined,
  onNotificationAction: maestro?.onNotificationAction
    ? (cb) => maestro!.onNotificationAction!(cb)
    : undefined,
};
