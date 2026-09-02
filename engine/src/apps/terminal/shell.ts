// engine/src/apps/terminal/shell.ts -- 1:1 port of resolve_shell()/p_windows_powershell_fallback()
// from backend/apps/terminal/pty_backend.py. Node has no shutil.which() equivalent, so
// p_findOnPath() below is the minimal PATH scan that gives the same answer for the one binary name
// (pwsh.exe) this ever needs to resolve.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path to the always-present Windows PowerShell, used when pwsh is not installed. */
export function windowsPowershellFallback(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Minimal shutil.which() stand-in: scans PATH for an exact filename match. Good enough for the
 * one lookup resolveShell() needs (pwsh.exe on Windows, bash on POSIX) -- not a general which(). */
export function findOnPath(exe: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = process.platform === 'win32' ? (env.Path ?? env.PATH ?? '') : (env.PATH ?? '');
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of raw.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Return the argv for an interactive shell. argv[0] is always absolute -- node-pty's spawn()
 * feeds it straight to CreateProcess/execvpe on the platforms that matter here, and a bare name
 * resolving differently than the manager expects is exactly the kind of surprise pywinpty's own
 * absolute-path requirement (pty_backend.py's docstring) was written to avoid. */
export function resolveShell(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform === 'win32') {
    // pwsh is the modern cross-platform PowerShell; Windows PowerShell is the guaranteed fallback.
    const pwsh = findOnPath('pwsh.exe', env);
    if (pwsh) return [pwsh, '-NoLogo'];
    return [windowsPowershellFallback(), '-NoLogo'];
  }
  const shell = env.SHELL || findOnPath('bash', env) || '/bin/bash';
  return [shell, '-l'];
}
