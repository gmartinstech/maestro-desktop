// BRW-4: the frontend half of the MAESTRO_BROWSER_ENGINE=electron|cdp safety switch (see
// docs/plans/2026-08-31-txm-tauri-typescript-migration.md's BRW-4 row and the plan's "Risk/
// Rollback" note under Phase BRW). Default is 'electron' -- today's Electron <webview> path,
// completely unmodified. 'cdp' opts BrowserCard.tsx into the new canvas + screencast path
// (BrowserCanvasCdp.tsx) fed by engine/src/browser/screencastServer.ts.
//
// process.env.MAESTRO_BROWSER_ENGINE is replaced by webpack.config.js's DefinePlugin entry at
// BUILD time (same mechanism as process.env.NODE_ENV, which webpack always defines from `mode` --
// see frontend/src/shared/state/store.ts's existing `process.env.NODE_ENV` check for the same
// pattern already live in this codebase) with a literal string baked into the bundle -- there is
// no real `process` global in the packaged renderer to read at runtime, so this MUST stay a bare
// `process.env.MAESTRO_BROWSER_ENGINE` reference (no `typeof process` guard) or DefinePlugin's
// static replacement never fires and the branch always reads as unset. Flipping the switch means
// setting the env var before `npm run build`, then relaunching the app -- matches this repo's
// MAESTRO_MOCK_AGENT convention (CLAUDE.md): set before the process starts, not a live toggle.
// Under Vitest (this file's own .test.ts), `process` is the real Node process, so the same line
// reads the real env var directly, no build step needed -- see browserEngineMode.test.ts.
export type BrowserEngineMode = 'electron' | 'cdp';

export function getBrowserEngineMode(): BrowserEngineMode {
  return process.env.MAESTRO_BROWSER_ENGINE === 'cdp' ? 'cdp' : 'electron';
}
