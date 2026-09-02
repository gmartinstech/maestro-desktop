// engine/src/apps/terminal/env.ts -- 1:1 port of backend/apps/terminal/env.py.
//
// What the user's shell inherits. The user typing here is trusted, so this is not a sandbox; the
// narrow goal is that `env`/a screen-share does not casually print the Maestro gateway key.

// Mirrors env.py's P_SCRUBBED_ENV_KEYS by intent, not by import: the engine's own credential set
// (engineFetch's allowlist, engine/src/net/http.ts) uses different env var names in a couple of
// spots than the Python original did, so this keeps BOTH name generations scrubbed rather than
// silently dropping the ones Python's executor.py list names but the engine no longer sets.
const P_SCRUBBED_ENV_KEYS: ReadonlySet<string> = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'PROVEDOR_IA_TOKEN',
  'PROVEDOR_IA_BASE_URL',
  'MAESTRO_AUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GITHUB_TOKEN',
]);

/** Inherit the engine process's environment minus provider credentials, plus a TERM that makes
 * programs emit color. `baseEnv` is injectable for tests; defaults to the real process env. */
export function buildTerminalEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (P_SCRUBBED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  return env;
}
