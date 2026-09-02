import { invoke } from '@tauri-apps/api/core';
import type { ShellBridge, ShellBuildInfo } from './ShellBridge';

// TAU-1 stub: the six commands below are real invoke() wiring against Rust command names TAU-4
// implements to match exactly (get_backend_port, get_auth_token, get_app_version, get_build_info,
// open_external, hard_reset). Everything else has no Tauri equivalent yet, so it degrades to a
// typed no-op that logs once and returns a value the caller already knows how to handle (an
// unsubscribe no-op, an empty list, a `{ success: false }`, etc.) rather than throwing — later
// tickets (TAU-3/4/5) fill these in one at a time.
function warnNotImplemented(member: string): void {
  console.warn(`[tauriShell] ${member} not yet implemented in the Tauri shell (see TAU-3/4/5).`);
}

function noopUnsubscribe(member: string): () => void {
  warnNotImplemented(member);
  return () => {};
}

// The backend port is injected synchronously in Electron (preload's sendSync, before first paint);
// Tauri's invoke() is inherently async, so this caches the last-known value and returns it
// synchronously, same as a stale-but-usable read. TAU-4 should consider a synchronous injection
// path (e.g. a global set by Rust before the window loads) if a cold-start stale read proves to
// matter in practice.
let cachedBackendPort = 0;
function refreshBackendPort(): void {
  invoke<number>('get_backend_port')
    .then((p) => { cachedBackendPort = p; })
    .catch((err) => console.warn('[tauriShell] get_backend_port failed:', err));
}
// index.ts imports this module unconditionally on every platform; only actually invoke a Tauri
// command when a Tauri runtime is really present, so Electron/browser boot never fires (and fails)
// a Tauri IPC call.
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) refreshBackendPort();

export const tauriShell: ShellBridge = {
  getBackendPort: () => cachedBackendPort,
  getBackendPortLive: () => { refreshBackendPort(); return cachedBackendPort; },
  getWebviewPreloadPath: () => { warnNotImplemented('getWebviewPreloadPath'); return undefined; },
  getAuthToken: () => invoke<string>('get_auth_token'),

  getAppVersion: () => invoke<string>('get_app_version'),
  getBuildInfo: () => invoke<ShellBuildInfo>('get_build_info'),
  // Phase TAU targets Windows only (docs/plans/txm-status.md); revisit once MAC-2/MOB-2 add
  // non-Windows Tauri targets. No warning here: this module loads unconditionally on every
  // platform (see index.ts), so logging on construction would fire even under Electron.
  platform: 'win32',

  popupAppMenu: async () => { warnNotImplemented('popupAppMenu'); },
  setTitleBarOverlay: () => warnNotImplemented('setTitleBarOverlay'),

  markFirstAgentResponse: () => warnNotImplemented('markFirstAgentResponse'),

  openExternal: (url) => invoke<void>('open_external', { url }),
  hardReset: () => invoke<void>('hard_reset'),
  clearBrowserData: async () => { warnNotImplemented('clearBrowserData'); return { ok: false }; },

  connectSlack: async () => {
    warnNotImplemented('connectSlack');
    throw new Error('Slack auto-connect is not yet implemented in the Tauri shell (see TAU-5).');
  },
  getPartitionCookies: async () => {
    warnNotImplemented('getPartitionCookies');
    return { cookies: [], userAgent: '', error: 'not yet implemented in Tauri shell (see TAU-5)' };
  },
  setSessionCapsule: () => warnNotImplemented('setSessionCapsule'),

  sendCdpCommand: async () => {
    warnNotImplemented('sendCdpCommand');
    return { ok: false, error: 'CDP is not yet implemented in the Tauri shell (see TAU-3/BRW)' };
  },
  cdpDetachClean: async () => { warnNotImplemented('cdpDetachClean'); return undefined; },
  cdpCacheSet: async () => { warnNotImplemented('cdpCacheSet'); },
  cdpCacheGet: async () => { warnNotImplemented('cdpCacheGet'); return null; },
  cdpCacheClear: async () => { warnNotImplemented('cdpCacheClear'); },
  cdpChildSessionsGet: async () => { warnNotImplemented('cdpChildSessionsGet'); return []; },
  cdpRoutesGet: async () => { warnNotImplemented('cdpRoutesGet'); return []; },
  getWebviewConsole: async () => { warnNotImplemented('getWebviewConsole'); return []; },
  capturePage: async () => {
    warnNotImplemented('capturePage');
    throw new Error('capturePage is not yet implemented in the Tauri shell (see TAU-3/4)');
  },

  getUpdateStatus: async () => {
    warnNotImplemented('getUpdateStatus');
    return { status: 'idle', info: null, error: null };
  },
  openStoreUpdates: async () => {
    warnNotImplemented('openStoreUpdates');
    return { success: false, error: 'not yet implemented in Tauri shell (see TAU-5)' };
  },
  getCrashRecoveryInfo: async () => { warnNotImplemented('getCrashRecoveryInfo'); return null; },
  checkForUpdates: async () => {
    warnNotImplemented('checkForUpdates');
    return { success: false, error: 'not yet implemented in Tauri shell (see TAU-5)' };
  },
  downloadUpdate: async () => {
    warnNotImplemented('downloadUpdate');
    return { success: false, error: 'not yet implemented in Tauri shell (see TAU-5)' };
  },
  installUpdate: async () => { warnNotImplemented('installUpdate'); },
  setAllowPrerelease: async () => { warnNotImplemented('setAllowPrerelease'); },
  onUpdateAvailable: () => noopUnsubscribe('onUpdateAvailable'),
  onUpdateNotAvailable: () => noopUnsubscribe('onUpdateNotAvailable'),
  onDownloadProgress: () => noopUnsubscribe('onDownloadProgress'),
  onUpdateDownloaded: () => noopUnsubscribe('onUpdateDownloaded'),
  onUpdateError: () => noopUnsubscribe('onUpdateError'),

  restartApp: () => warnNotImplemented('restartApp'),
  openBackendLogs: () => warnNotImplemented('openBackendLogs'),
  onBackendUnrecoverable: () => noopUnsubscribe('onBackendUnrecoverable'),

  onWebviewNewWindow: () => noopUnsubscribe('onWebviewNewWindow'),
  onReloadShortcut: () => noopUnsubscribe('onReloadShortcut'),
  onBrowserShortcut: () => noopUnsubscribe('onBrowserShortcut'),
  onWindowFocus: () => noopUnsubscribe('onWindowFocus'),

  onOauthClaim: () => noopUnsubscribe('onOauthClaim'),
  onOauthCallback: () => noopUnsubscribe('onOauthCallback'),
};
