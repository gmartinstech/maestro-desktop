// engine/src/apps/service/version.ts -- port of backend/apps/service/version.py's
// read_app_version(). Same two-tier resolution: MAESTRO_APP_VERSION (set by Electron/Tauri when
// they spawn a backend process; see electron/main.js and tauri/src/sidecar.rs) wins when present,
// falling back to reading electron/package.json's own "version" field for dev runs where the env
// var was never set.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// engine/src/apps/service -> engine/src/apps -> engine/src -> engine -> repo root.
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

export function readAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const envVersion = (env.MAESTRO_APP_VERSION ?? '').trim();
  if (envVersion) return envVersion;
  try {
    const pkgPath = join(P_REPO_ROOT, 'electron', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const APP_VERSION = readAppVersion();
