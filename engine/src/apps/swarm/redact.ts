// engine/src/apps/swarm/redact.ts -- SUB-3, a full TypeScript port of backend/apps/swarm/redact.py.
// SECURITY-SENSITIVE: strip secrets before anything enters a .swarm. Two layers: scrubPayload
// scrubs every payload + text body, and ziputil.ts's pack() refuses to write if anything denied
// slipped through. Over-redacting a bundle is fine; shipping a stranger your API key is not.
//
// Every deny-list entry below is copied VERBATIM from backend/apps/swarm/redact.py's
// P_DENY_SUBSTRINGS / P_DENY_EXACT -- including `provedor_ia_token`, the Maestro credential this
// repo deliberately keeps un-renamed everywhere (see CLAUDE.md / this ticket's own instructions).
// redact.test.ts asserts this list is exhaustive against the Python source, not just "looks right".

import { findSecretsInFiles, redactSecretShapes, REDACTED } from '../skillRegistry/secretScan';

export { REDACTED, findSecretsInFiles };

// Substrings that mark a field name as secret (matched case-insensitively).
export const P_DENY_SUBSTRINGS: readonly string[] = [
  'api_key', 'apikey', 'secret', 'password', 'passwd', 'credential', 'oauth',
  'bearer', 'subscription_token', 'access_token', 'refresh_token',
  'session_token', 'auth_token', 'private_key',
];

// Exact field names that are sensitive or per-install identity (the substring pass alone would
// miss these).
export const P_DENY_EXACT: ReadonlySet<string> = new Set([
  'token', 'installation_id', 'user_id', 'maestro_bearer_token',
  'provedor_ia_token',
  'connected_account_email', 'oauth_tokens',
  'credentials', 'sdk_session_id',
]);

export function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (P_DENY_EXACT.has(k)) return true;
  return P_DENY_SUBSTRINGS.some((sub) => k.includes(sub));
}

// The secret-shape scanner: reused from skillRegistry/secretScan.ts rather than re-ported, per
// that file's own header ("whichever later ticket ports swarm/redact.py ... should import THIS
// file rather than re-porting the same regexes a second time").
function scrubText(text: string): string {
  return redactSecretShapes(text);
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue } | Record<string, unknown> | unknown[];

/** Recursively drops denied keys and redacts secret-shaped strings in a JSON-able structure.
 * Returns a new structure; never mutates the input. */
export function scrubPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => scrubPayload(v));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isDeniedKey(k)) continue;
      out[k] = scrubPayload(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    return scrubText(value);
  }
  return value;
}

/** Audit used by ziputil.ts's pack() as the last line of defense: the paths of any denied key
 * still present. Empty array means clean. */
export function findDeniedKeys(value: unknown, pPath = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      found.push(...findDeniedKeys(v, `${pPath}[${i}]`));
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const here = pPath ? `${pPath}.${k}` : k;
      if (isDeniedKey(k)) found.push(here);
      found.push(...findDeniedKeys(v, here));
    }
  }
  return found;
}
