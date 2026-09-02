import type { ShellBridge } from './ShellBridge';
import { electronShell } from './electronShell';
import { tauriShell } from './tauriShell';

// Every member a typed no-op that logs a warning: what lets the frontend boot in a plain browser
// with no native shell at all (RMT's browser-hosted client). Built once, at module load, from the
// full ShellBridge surface, so a member added to the interface is never silently missing here.
function warnNoShell(member: string): void {
  console.warn(`[nullShell] ${member} called with no shell present (not Electron or Tauri).`);
}

function noopUnsubscribe(member: string): () => void {
  warnNoShell(member);
  return () => {};
}

const nullShell: ShellBridge = {
  getBackendPort: () => { warnNoShell('getBackendPort'); return 0; },
  getBackendPortLive: () => { warnNoShell('getBackendPortLive'); return 0; },
  getWebviewPreloadPath: () => { warnNoShell('getWebviewPreloadPath'); return undefined; },
  getAuthToken: async () => { warnNoShell('getAuthToken'); return ''; },

  getAppVersion: async () => { warnNoShell('getAppVersion'); return ''; },
  getBuildInfo: async () => {
    warnNoShell('getBuildInfo');
    return { sha: 'unknown', shortSha: 'unknown', builtAt: null, channel: 'unknown' };
  },
  platform: (() => { warnNoShell('platform'); return 'unknown'; })(),

  popupAppMenu: async () => { warnNoShell('popupAppMenu'); },
  setTitleBarOverlay: () => warnNoShell('setTitleBarOverlay'),

  markFirstAgentResponse: () => warnNoShell('markFirstAgentResponse'),

  openExternal: async (url) => {
    warnNoShell('openExternal');
    window.open(url, '_blank');
  },
  hardReset: async () => { warnNoShell('hardReset'); },
  clearBrowserData: async () => { warnNoShell('clearBrowserData'); return { ok: false }; },

  connectSlack: async () => {
    warnNoShell('connectSlack');
    throw new Error('Slack auto-connect requires the desktop app.');
  },
  getPartitionCookies: async () => {
    warnNoShell('getPartitionCookies');
    return { cookies: [], userAgent: '', error: 'no shell present' };
  },
  setSessionCapsule: () => warnNoShell('setSessionCapsule'),

  sendCdpCommand: async () => {
    warnNoShell('sendCdpCommand');
    return { ok: false, error: 'no shell present' };
  },
  cdpDetachClean: async () => { warnNoShell('cdpDetachClean'); return undefined; },
  cdpCacheSet: async () => { warnNoShell('cdpCacheSet'); },
  cdpCacheGet: async () => { warnNoShell('cdpCacheGet'); return null; },
  cdpCacheClear: async () => { warnNoShell('cdpCacheClear'); },
  cdpChildSessionsGet: async () => { warnNoShell('cdpChildSessionsGet'); return []; },
  cdpRoutesGet: async () => { warnNoShell('cdpRoutesGet'); return []; },
  getWebviewConsole: async () => { warnNoShell('getWebviewConsole'); return []; },
  capturePage: async () => {
    warnNoShell('capturePage');
    throw new Error('capturePage requires a native shell.');
  },

  getUpdateStatus: async () => {
    warnNoShell('getUpdateStatus');
    return { status: 'idle', info: null, error: null };
  },
  openStoreUpdates: async () => { warnNoShell('openStoreUpdates'); return { success: false, error: 'no shell present' }; },
  getCrashRecoveryInfo: async () => { warnNoShell('getCrashRecoveryInfo'); return null; },
  checkForUpdates: async () => { warnNoShell('checkForUpdates'); return { success: false, error: 'no shell present' }; },
  downloadUpdate: async () => { warnNoShell('downloadUpdate'); return { success: false, error: 'no shell present' }; },
  installUpdate: async () => { warnNoShell('installUpdate'); },
  setAllowPrerelease: async () => { warnNoShell('setAllowPrerelease'); },
  onUpdateAvailable: () => noopUnsubscribe('onUpdateAvailable'),
  onUpdateNotAvailable: () => noopUnsubscribe('onUpdateNotAvailable'),
  onDownloadProgress: () => noopUnsubscribe('onDownloadProgress'),
  onUpdateDownloaded: () => noopUnsubscribe('onUpdateDownloaded'),
  onUpdateError: () => noopUnsubscribe('onUpdateError'),

  restartApp: () => warnNoShell('restartApp'),
  openBackendLogs: () => warnNoShell('openBackendLogs'),
  onBackendUnrecoverable: () => noopUnsubscribe('onBackendUnrecoverable'),

  onWebviewNewWindow: () => noopUnsubscribe('onWebviewNewWindow'),
  onReloadShortcut: () => noopUnsubscribe('onReloadShortcut'),
  onBrowserShortcut: () => noopUnsubscribe('onBrowserShortcut'),
  onWindowFocus: () => noopUnsubscribe('onWindowFocus'),

  onOauthClaim: () => noopUnsubscribe('onOauthClaim'),
  onOauthCallback: () => noopUnsubscribe('onOauthCallback'),
};

// Selected once at module load: electronShell when the Electron preload has run (the `maestro`
// global exists on window), tauriShell when Tauri 2.x's own detection global is present, nullShell
// otherwise (a plain browser tab, e.g. later RMT phases). Real selection, not a re-export, so this
// file is not a barrel.
function detectShell(): { instance: ShellBridge; native: boolean } {
  if (typeof window === 'undefined') return { instance: nullShell, native: false };
  // Truthiness, not `'maestro' in window`: `in` is true even when window.maestro is a present-but-
  // undefined property (e.g. a stray global from another script), which would wrongly select
  // electronShell and then throw the first time one of its methods dereferences a nonexistent
  // window.maestro.
  if ((window as unknown as { maestro?: unknown }).maestro) return { instance: electronShell, native: true };
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return { instance: tauriShell, native: true };
  return { instance: nullShell, native: false };
}

const detected = detectShell();
export const shell: ShellBridge = detected.instance;
// True whenever a real native bridge (Electron or Tauri) was detected, false in a plain browser
// tab. Equivalent to the pre-TAU-1 "does the Electron global exist" feature detection some call
// sites used to gate packaged-app-only behavior, without leaking that global outside
// electronShell.ts.
export const hasNativeShell: boolean = detected.native;
export type { ShellBridge } from './ShellBridge';
