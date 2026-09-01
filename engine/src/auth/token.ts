// engine/src/auth/token.ts -- per-install bearer token generation and persistence for the
// engine's own auth middleware (auth/middleware.ts).
//
// Writes to the EXACT same path backend/config/paths.py's AUTH_TOKEN_FILE resolves to, in a
// format backend/auth.py's init_auth_token() already accepts (a 16-512 char string, no embedded
// newline). During the proxy period both processes read/write the same file, so whichever one
// starts first mints the token and the other just reads it back -- no separate handshake needed.
// main.ts calls initAuthToken() before spawning Python (pythonBackend.ts) and before the engine's
// HTTP/WS port binds, mirroring backend/main.py's own "generate the token before the port binds"
// ordering comment: by the time any request lands, the token file exists.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// engine/src/auth -> engine/src -> engine -> repo root, same anchor pythonBackend.ts uses from
// engine/src (one level deeper here, hence three '..' instead of two).
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..');

const P_MIN_TOKEN_LEN = 16;
const P_MAX_TOKEN_LEN = 512;

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

// Mirrors backend/config/paths.py's DATA_ROOT resolution exactly (env override, then packaged
// per-platform app-support dir, then dev fallback) so both processes agree on one path without
// either side having to set MAESTRO_DATA_ROOT explicitly.
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.MAESTRO_DATA_ROOT ?? '').trim();
  if (override) return resolve(expandHome(override));

  if (env.MAESTRO_PACKAGED === '1') {
    let appSupport: string;
    if (process.platform === 'darwin') {
      appSupport = join(homedir(), 'Library', 'Application Support', 'Maestro Studio');
    } else if (process.platform === 'win32') {
      appSupport = join(env.APPDATA ?? homedir(), 'Maestro Studio');
    } else {
      appSupport = join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Maestro Studio');
    }
    return join(appSupport, 'data');
  }

  // Dev fallback: backend/data -- the SAME physical directory backend/config/paths.py's
  // P_BACKEND_DIR resolves to (backend/), not engine/data. This is what lets the token file be
  // shared with no env var set on either side.
  return join(P_REPO_ROOT, 'backend', 'data');
}

export function authTokenFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'auth.token');
}

// Atomic write at 0600: never world-readable, never half-written if the process dies mid-write.
// Mirrors backend/auth.py's p_write_atomic.
function writeAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Best-effort -- chmod is a no-op on Windows, same tradeoff backend/auth.py accepts.
  }
  renameSync(tmp, path);
}

let cachedToken = '';

// Loads the per-install token from disk, or mints one if missing/malformed, and persists it.
// Reused across restarts so Electron's (and this engine's own) cached copy stays valid -- same
// contract as backend/auth.py's init_auth_token().
export function initAuthToken(env: NodeJS.ProcessEnv = process.env): string {
  const path = authTokenFilePath(env);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf8').trim();
      if (existing.length >= P_MIN_TOKEN_LEN && existing.length <= P_MAX_TOKEN_LEN) {
        cachedToken = existing;
        return cachedToken;
      }
    }
  } catch {
    // Fall through to minting a fresh one -- matches backend/auth.py's warn-and-regenerate.
  }

  cachedToken = randomBytes(32).toString('base64url');
  try {
    writeAtomic(path, cachedToken);
  } catch (e) {
    // If we can't write the file, Python (and Electron/Tauri) can't read it -- log loudly but
    // don't crash the engine over it, same tradeoff backend/auth.py takes.
    console.error(`[engine] auth: failed to write token file: ${(e as Error).message}`);
  }
  return cachedToken;
}

// Returns the current token; empty string if initAuthToken() hasn't run yet.
export function getAuthToken(): string {
  return cachedToken;
}

// Test-only escape hatch: server.test.ts and auth/*.test.ts need to reset the module-level cache
// between runs without re-importing the module. Not used by any runtime path.
export function resetAuthTokenForTests(value = ''): void {
  cachedToken = value;
}
