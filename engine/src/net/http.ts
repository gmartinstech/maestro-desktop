// engine/src/net/http.ts -- ENG-7's provider-egress chokepoint.
//
// THE ONLY MODULE IN engine/src ALLOWED TO MAKE OUTBOUND NETWORK CALLS. Every other module must
// route through engineFetch() below -- enforced two ways, belt-and-suspenders, per the plan's own
// ENG-7 gate note ("string scanning alone is not sufficient for new code, so it is a lint rule
// plus check-callhome, not either alone"):
//
//   1. engine/eslint.config.mjs's no-restricted-imports rule bans node:http, node:https, undici,
//      axios, got, and bare global `fetch` everywhere in engine/src EXCEPT this directory.
//   2. scripts/check-provider-egress.mjs re-verifies (a) that lint rule is actually configured and
//      (b) does its own source scan for the same banned patterns outside engine/src/net/, so a
//      quietly-disabled or misconfigured lint rule doesn't silently reopen the hole.
//
// This is the TypeScript-side twin of the never-call-openswarm.com / Maestro-provider-only
// constraint scripts/check-callhome.mjs enforces via string scanning on built output -- here the
// enforcement is structural (a host allowlist gating the one function permitted to reach the
// network) rather than textual, because freshly-written TS has no "known bad string" to grep for
// yet at the point it's written.
//
// Host policy (see docs/plans/2026-08-31-txm-tauri-typescript-migration.md's ENG-7 entry):
//   - llm.martinstech.net, martinstech.net, cdn.martinstech.net -- the Maestro provider gateway,
//     its parent domain, and its CDN. Always allowed.
//   - 127.0.0.1 / localhost, any port -- the spawned Python backend, 9Router, and any other
//     loopback-only local process. Always allowed.
//   - api.anthropic.com / api.openai.com -- ONLY for the explicitly-configured own-API-key
//     passthrough lanes (a caller must pass `passthroughLane` naming which one; see
//     PASSTHROUGH_LANE_HOSTS below). These mirror backend/apps/agents/proxy/anthropic_proxy.py's
//     p_pick_upstream() direct-key branch ("https://api.anthropic.com", used when the user supplied
//     their own Anthropic key rather than routing through 9Router) and
//     backend/apps/agents/core/openai_passthrough.py's P_OPENAI_UPSTREAM
//     ("https://api.openai.com/v1", the OpenAI-compatible passthrough lane). Never allowed as part
//     of the general request path -- a caller that doesn't name a lane cannot reach either host.
//   - github.com / registry.npmjs.org -- BUILD-TIME TOOLING ONLY (npm install, a future
//     asset-fetch step), never reachable through this module's runtime request-serving API. Listed
//     here purely as documentation of the full policy; deliberately NOT wired into isHostAllowed()
//     or engineFetch() -- build-time npm/git already reach these hosts outside this process
//     entirely, so there is nothing to enforce on the request-serving path, and no runtime code
//     should ever need to.

export type PassthroughLane = 'anthropic-passthrough' | 'openai-passthrough';

const ALWAYS_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'llm.martinstech.net',
  'martinstech.net',
  'cdn.martinstech.net',
]);

// name -> the exact host it unlocks. A caller must name the lane explicitly (engineFetch's
// `options.passthroughLane`) for the corresponding host to pass the allowlist -- naming a lane
// does NOT unlock the other one, and omitting a lane leaves both hosts blocked.
const PASSTHROUGH_LANE_HOSTS: Readonly<Record<PassthroughLane, string>> = {
  'anthropic-passthrough': 'api.anthropic.com',
  'openai-passthrough': 'api.openai.com',
};

// Documented, deliberately inert -- see the module doc above. Not consulted by isHostAllowed().
export const BUILD_TIME_ONLY_HOSTS: readonly string[] = Object.freeze(['github.com', 'registry.npmjs.org']);

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

export interface EngineFetchOptions {
  /** Names the own-API-key passthrough lane this call belongs to, unlocking exactly the one host
   * that lane is defined for. Omit for every other call. */
  passthroughLane?: PassthroughLane;
}

/** Returns true iff `hostname` (already lower-cased by the caller) is reachable under the current
 * options. Exported standalone so scripts/check-provider-egress.mjs and unit tests can exercise
 * the policy table without constructing a real Request. */
export function isHostAllowed(hostname: string, options: EngineFetchOptions = {}): boolean {
  const h = hostname.toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (ALWAYS_ALLOWED_HOSTS.has(h)) return true;
  if (options.passthroughLane && PASSTHROUGH_LANE_HOSTS[options.passthroughLane] === h) return true;
  return false;
}

export class EgressBlockedError extends Error {
  constructor(public readonly hostname: string, public readonly url: string) {
    super(`engine/src/net/http.ts blocked an outbound request to "${hostname}" (${url}) -- not on the provider-egress allowlist`);
    this.name = 'EgressBlockedError';
  }
}

/** The one permitted way to make an outbound HTTP(S) request from anywhere in engine/src. Throws
 * EgressBlockedError before any network I/O happens if the target host isn't on the allowlist --
 * fail closed, never fall through to the real fetch(). Delegates to the platform's global fetch
 * (Node 22's built-in undici-backed implementation) once the host clears the check; this file is
 * the one place in engine/src permitted to call it (see the eslint no-restricted-imports rule,
 * which exempts this directory but still bans a *bare* `fetch` identifier even here -- this
 * function is the sanctioned call site).
 *
 * Signature deliberately matches the global `fetch`'s own `input` type exactly (`string | URL |
 * Request`, @types/node's web-globals/fetch.d.ts has no separate `RequestInfo` alias) -- accepting
 * a `Request` object, not only a string/URL, is what lets router/sync.ts's `RouterHttpDeps.fetch:
 * typeof fetch` (a dependency-injection seam ported verbatim from
 * backend/apps/nine_router/sync.py's own test-injection pattern) assign this function directly in
 * its defaultDeps, with no wrapper and no loss of type safety. */
export async function engineFetch(input: string | URL | Request, init?: RequestInit, options: EngineFetchOptions = {}): Promise<Response> {
  const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(urlString);
  if (!isHostAllowed(parsed.hostname, options)) {
    throw new EgressBlockedError(parsed.hostname, parsed.toString());
  }
  // This is the sanctioned call site -- no-restricted-globals is turned off for the whole
  // engine/src/net/ directory (eslint.config.mjs), so no inline disable is needed here; every
  // other file in engine/src is banned from reaching this identifier.
  return fetch(input, init);
}
