// engine/src/auth/scrubber.ts -- redacts the per-install token from anything the engine logs.
//
// Installed by main.ts right after initAuthToken() runs (auth/token.ts), same ordering
// backend/auth.py's install_token_scrubber() documents: nothing logged after this point --
// subprocess output, proxied-request error bodies, a stray console.log of a headers object --
// can leak the token verbatim.
//
// Mirrors backend/auth.py's p_TokenScrubFilter scope: scrubs the token out of string values at
// up to one level of nesting (a top-level string, or a string value inside a top-level array or
// plain object) -- the same shallow scope the backend's scrubber commits to, not a deep-recursive
// walk of arbitrary object graphs.

const P_PLACEHOLDER = '<REDACTED:maestro-token>';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
const P_METHODS: readonly ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];

function scrubString(value: string, token: string): string {
  return value.includes(token) ? value.split(token).join(P_PLACEHOLDER) : value;
}

function scrubValue(value: unknown, token: string): unknown {
  if (typeof value === 'string') return scrubString(value, token);
  if (value instanceof Error) {
    const scrubbed = new Error(scrubString(value.message, token));
    scrubbed.name = value.name;
    scrubbed.stack = value.stack ? scrubString(value.stack, token) : value.stack;
    return scrubbed;
  }
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? scrubString(v, token) : v));
  }
  if (value && typeof value === 'object') {
    let copy: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.includes(token)) {
        if (!copy) copy = { ...(value as Record<string, unknown>) };
        copy[k] = scrubString(v, token);
      }
    }
    return copy ?? value;
  }
  return value;
}

let installed = false;

// Patches every console method to redact getToken()'s current value from every argument before
// the real console output runs. Safe to call more than once (a no-op after the first).
export function installTokenScrubber(getToken: () => string): void {
  if (installed) return;
  installed = true;
  for (const method of P_METHODS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
      const token = getToken();
      if (!token) {
        original(...args);
        return;
      }
      original(...args.map((a) => scrubValue(a, token)));
    };
  }
}

// Test-only escape hatch: lets a test install the scrubber more than once in the same process.
export function resetTokenScrubberForTests(): void {
  installed = false;
}
