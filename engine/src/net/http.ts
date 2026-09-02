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
// This is the TypeScript-side twin of the never-call-the-upstream-vendor / Maestro-provider-only
// (deliberately not spelling the banned host here: this module is an ALLOW-list, so it never needs
// the name functionally, and keeping it out means check-callhome can scan production source with
// no exemptions. scripts/check-callhome.mjs is the one place that names it.)
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
//   - api.anthropic.com / api.openai.com / generativelanguage.googleapis.com -- ONLY for the
//     explicitly-configured own-API-key passthrough lanes (a caller must pass `passthroughLane`
//     naming which one; see PASSTHROUGH_LANE_HOSTS below). The first two mirror backend/apps/
//     agents/proxy/anthropic_proxy.py's p_pick_upstream() direct-key branch ("https://
//     api.anthropic.com", used when the user supplied their own Anthropic key rather than routing
//     through 9Router) and backend/apps/agents/core/openai_passthrough.py's P_OPENAI_UPSTREAM
//     ("https://api.openai.com/v1", the OpenAI-compatible passthrough lane). The Gemini host is
//     SUB-8's web sub-app (apps/web/grounded.ts), the same own-key-direct-call shape for backend/
//     apps/web/web.py's `p_gemini_grounded_call` (the user's own AI Studio key). Never allowed as
//     part of the general request path -- a caller that doesn't name a lane cannot reach any of
//     these three hosts.
//   - registry.modelcontextprotocol.io -- SUB-4's MCP registry (apps/mcpRegistry/registry.ts), a
//     full port of backend/apps/mcp_registry/mcp_registry.py: an hourly background refresh of the
//     public MCP server catalog. Same posture as the skill registry entry below -- OUR OWN code's
//     hardcoded outbound call, not something a user configured, so it's a plain always-allowed host
//     rather than the arbitrary-host escape hatch documented further down.
//   - api.github.com / raw.githubusercontent.com / skills.sh -- SUB-2's skill registry
//     (apps/skillRegistry/skillRegistryGithub.ts + skillRegistrySources.ts), a full port of
//     backend/apps/skill_registry/*.py: resolving/installing a skill from the curated
//     anthropics/skills repo or the skills.sh community index needs these at runtime, not just at
//     build time -- this is a real, narrower correction to this file's OWN prior "github.com is
//     build-time only, no runtime code should ever need it" assumption below, not a loosening of
//     the provider-egress policy itself (the call-home ban this module also enforces, at the top
//     of ALWAYS_ALLOWED_HOSTS's exclusion by omission, is untouched). Always allowed, no
//     passthrough-lane gate -- unlike the Anthropic/OpenAI keys, there is no credential-bearing
//     "direct" vs "routed" distinction here, every skill-registry call is the same public,
//     unauthenticated-by-default read.
//   - github.com (the bare marketing/web host, distinct from api.github.com above) /
//     registry.npmjs.org -- still BUILD-TIME TOOLING ONLY (npm install, a future asset-fetch
//     step), never reachable through this module's runtime request-serving API. Listed here purely
//     as documentation of the full policy; deliberately NOT wired into isHostAllowed() or
//     engineFetch() -- build-time npm/git already reach these hosts outside this process entirely.
//   - html.duckduckgo.com / lite.duckduckgo.com -- SUB-8's web sub-app (apps/web/ddg.ts), a full
//     port of backend/apps/agents/tools/{search_ddg,search_ddg_lite}.py. Same "our own code's
//     hardcoded outbound call" posture as the MCP/skill registry hosts above -- always allowed, no
//     passthrough-lane gate, no user-supplied credential involved.
//   - www.reddit.com / www.tiktok.com -- SUB-9's social MCP shims (apps/socialShims/reddit/
//     redditHttp.ts, apps/socialShims/tiktok/tiktokHttp.ts), full ports of backend/apps/
//     {reddit,tiktok}_mcp_shim's own session-cookie-borrowing HTTP transport. Same "our own code's
//     hardcoded outbound call, not a user-typed URL" posture as the skill/mcp registry and DDG hosts
//     above -- the site is fixed by which curated integration the user connected (frontend/src/app/
//     pages/Tools/integrations.tsx), never a value read out of tool.mcp_config the way
//     mcpDiscovery.ts's allowArbitraryHost carve-out is. The Python originals had no egress
//     allowlist to pass at all (stdlib urllib.request, no chokepoint); this is the narrower,
//     disclosed extension needed to reach the exact same two hosts once routed through this one.
//     x.com/twitter.com are deliberately NOT here: the X shim never calls x.com directly (it can't
//     -- X signs every request with browser JS), so it exclusively drives the user's own logged-in
//     browser card via the loopback `/api/browser-session/action` bridge (already always-allowed as
//     a loopback host) -- see apps/socialShims/common/browserAction.ts.

export type PassthroughLane = 'anthropic-passthrough' | 'openai-passthrough' | 'gemini-passthrough';

const ALWAYS_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'llm.martinstech.net',
  'martinstech.net',
  'cdn.martinstech.net',
  // SUB-4's MCP registry -- see this file's own module doc above.
  'registry.modelcontextprotocol.io',
  // SUB-2's skill registry -- see this file's own module doc above for why these are runtime, not
  // build-time-only, allowances. NOT the bare 'github.com' web host (still build-time-only, see
  // below) -- only the API and raw-content subdomains skill_registry_github.py/
  // skill_registry_sources.py's Python original actually calls. raw.githubusercontent.com is also
  // where mcp_registry's Google MCP catalog parser (registry.ts's fetchGoogleServers) reads from.
  'api.github.com',
  'raw.githubusercontent.com',
  'skills.sh',
  // SUB-8's web sub-app (apps/web/ddg.ts) -- a full port of backend/apps/agents/tools/
  // {search_ddg,search_ddg_lite}.py's free search fallback. Same "our own code's hardcoded
  // outbound call, not something a user configured" posture as the skill-registry/mcp-registry
  // hosts above, not the arbitrary-host escape hatch further down.
  'html.duckduckgo.com',
  'lite.duckduckgo.com',
  // SUB-9's social MCP shims -- see this file's own module doc above.
  'www.reddit.com',
  'www.tiktok.com',
]);

// name -> the exact host it unlocks. A caller must name the lane explicitly (engineFetch's
// `options.passthroughLane`) for the corresponding host to pass the allowlist -- naming a lane
// does NOT unlock the other one, and omitting a lane leaves both hosts blocked.
const PASSTHROUGH_LANE_HOSTS: Readonly<Record<PassthroughLane, string>> = {
  'anthropic-passthrough': 'api.anthropic.com',
  'openai-passthrough': 'api.openai.com',
  // SUB-8's web sub-app (apps/web/grounded.ts): backend/apps/web/web.py's own-AI-Studio-key
  // Gemini grounding call (p_gemini_grounded_call), the exact same "user supplied their own
  // provider key, call it directly" trust boundary as the two lanes above -- just for Gemini
  // instead of Anthropic/OpenAI.
  'gemini-passthrough': 'generativelanguage.googleapis.com',
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
  /** SUB-4's tools_lib MCP discovery (apps/toolsLib/mcpDiscovery.ts's discoverMcpToolsHttp) is the
   * ONE legitimate reason to reach a host that isn't on ALWAYS_ALLOWED_HOSTS: a community MCP
   * server's HTTP/SSE endpoint, whose address is data the USER typed into their own Tools settings
   * (tool.mcp_config.url), not a host baked into this codebase -- the exact same trust boundary
   * backend/apps/tools_lib/mcp_discovery.py accepts by using a bare, unrestricted
   * httpx.AsyncClient() for this one call, since Python has no egress-allowlist chokepoint at all.
   * This is NOT a blanket bypass: it only unlocks the request `engineFetch` was already about to
   * make (still routes through this one function, still subject to `isHostAllowed`'s loopback/
   * always-allowed checks first), and a caller must set it explicitly and by name -- omitting it
   * leaves every non-allowlisted host blocked, same as today. */
  allowArbitraryHost?: boolean;
}

/** Returns true iff `hostname` (already lower-cased by the caller) is reachable under the current
 * options. Exported standalone so scripts/check-provider-egress.mjs and unit tests can exercise
 * the policy table without constructing a real Request. */
export function isHostAllowed(hostname: string, options: EngineFetchOptions = {}): boolean {
  const h = hostname.toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (ALWAYS_ALLOWED_HOSTS.has(h)) return true;
  if (options.passthroughLane && PASSTHROUGH_LANE_HOSTS[options.passthroughLane] === h) return true;
  if (options.allowArbitraryHost) return true;
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
