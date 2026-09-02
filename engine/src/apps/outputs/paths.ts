// engine/src/apps/outputs/paths.ts -- SUB-5's slice of backend/config/paths.py's DATA_ROOT-relative
// constants (OUTPUTS_DIR, OUTPUTS_WORKSPACE_DIR, OUTPUTS_VERSIONS_DIR). auth/token.ts's
// resolveDataRoot() already ports DATA_ROOT itself byte-for-byte; this just adds the three
// subdirectory segments, same convention as dashboards/store.ts's dashboardsDir().

import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';

export function outputsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'outputs');
}

export function outputsWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'outputs_workspace');
}

export function outputsVersionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'outputs_versions');
}
