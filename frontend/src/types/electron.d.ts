export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          preload?: string;
          partition?: string;
          allowpopups?: string;
          nodeintegration?: string;
          webpreferences?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }

  interface MaestroUpdateInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | Array<{ version: string; note: string }>;
  }

  interface MaestroDownloadProgress {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  }

  interface MaestroAPI {
    getBackendPort: () => number;
    getWebviewPreloadPath: () => string;
    getAppVersion: () => Promise<string>;
    getBuildInfo: () => Promise<{ sha: string; shortSha: string; builtAt: string | null; channel: string }>;
    getUpdateStatus: () => Promise<{ status: string; info: any; error: string | null }>;
    getCrashRecoveryInfo?: () => Promise<{ ts: number; parent_pid: number; uptime_ms: number } | null>;
    checkForUpdates: () => Promise<{ success: boolean; version?: string; error?: string }>;
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
    installUpdate: () => Promise<void>;
    onUpdateAvailable: (cb: (info: MaestroUpdateInfo) => void) => () => void;
    onUpdateNotAvailable: (cb: (info: MaestroUpdateInfo) => void) => () => void;
    onDownloadProgress: (cb: (progress: MaestroDownloadProgress) => void) => () => void;
    onUpdateDownloaded: (cb: (info: MaestroUpdateInfo) => void) => () => void;
    onUpdateError: (cb: (message: string) => void) => () => void;
    onWebviewNewWindow: (cb: (url: string, webContentsId: number, disposition?: string) => void) => () => void;
    onReloadShortcut?: (cb: () => void) => () => void;
    onBrowserShortcut?: (cb: (payload: { action: string; webContentsId: number }) => void) => () => void;
    openExternal: (url: string) => Promise<void>;
    hardReset?: () => Promise<void>;
    clearBrowserData?: () => Promise<{ ok: boolean }>;
    onOauthClaim?: (cb: (url: string) => void) => () => void;
  }

  interface Window {
    __MAESTRO_PORT__: number;
    maestro: MaestroAPI;
  }
}
