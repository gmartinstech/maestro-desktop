// engine/src/apps/terminal/workspaceCwd.ts -- port of backend/main.py's p_terminal_cwd().

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';

/** Resolve the directory the shell opens in: the card's workspace, falling back to home if it has
 * vanished. Mirrors backend/config/paths.py's OUTPUTS_WORKSPACE_DIR = DATA_ROOT/outputs_workspace. */
export function terminalCwd(workspaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  const folder = join(resolveDataRoot(env), 'outputs_workspace', workspaceId);
  try {
    if (existsSync(folder) && statSync(folder).isDirectory()) return folder;
  } catch {
    // fall through to home, same as os.path.isdir() returning False on a stat error
  }
  return homedir();
}
