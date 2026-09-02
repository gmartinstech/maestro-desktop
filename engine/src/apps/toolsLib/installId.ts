// engine/src/apps/toolsLib/installId.ts -- SUB-4, a full port of backend/config/install_id.py.
// Per-install UUID4, persisted under DATA_ROOT/install_id, binding in-flight OAuth claims (and the
// Discord MCP shim's guild-scoping) to the install that started them. Lives under toolsLib/ (not a
// new top-level engine/src/config/) since apps/toolsLib/mcpConfig.ts's Discord shim env injection
// is currently the only caller in the engine; a later ticket that ports the oauth/start route can
// import this same module rather than re-deriving it.

import { existsSync, mkdirSync, openSync, readFileSync, writeSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataRoot } from '../../auth/token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUuid(s: string): boolean {
  return s.length === 36 && UUID_RE.test(s);
}

let cached: string | null = null;

function installIdFilePath(): string {
  return join(resolveDataRoot(), 'install_id');
}

/** Test-only: resets the module-level cache so a test can point resolveDataRoot at a fresh temp
 * dir and observe a fresh mint. */
export function resetInstallIdCacheForTests(): void {
  cached = null;
}

/** Return the persistent install_id, generating and persisting on first call. */
export function getInstallId(): string {
  if (cached) return cached;

  const path = installIdFilePath();
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf8').trim();
      if (looksLikeUuid(existing)) {
        cached = existing;
        return cached;
      }
    }
  } catch {
    // Fall through to minting a fresh one, matches the Python original's broad except: pass.
  }

  const fresh = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'w', 0o600);
  try {
    writeSync(fd, fresh, null, 'utf8');
  } finally {
    closeSync(fd);
  }
  cached = fresh;
  return cached;
}
