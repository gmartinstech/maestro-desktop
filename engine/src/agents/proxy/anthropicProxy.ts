// engine/src/agents/proxy/anthropicProxy.ts -- AGT-7, ports backend/apps/agents/proxy/
// anthropic_proxy.py's route handler: an Anthropic-format HTTP proxy splitting requests by the
// `model` field -- primary traffic to the loopback 9Router process, aux Claude/Gemini/GPT-5/
// OpenRouter-bound requests get per-family scrubbing first, and a narrow GPT-5-with-PDF slice
// bypasses 9Router entirely via anthropicToOpenai.ts's direct-to-OpenAI translator.
//
// AUTH: mounted at /api/anthropic-proxy (backend/config/Apps.py's SubApp prefix convention) -- this
// path is deliberately NOT in engine/src/auth/middleware.ts's exempt lists (see backend/auth.py's
// own is_path_exempt, which likewise omits it), so it stays behind the same per-install-token
// check as every other native route. The bundled Claude Code CLI subprocess is launched with
// ANTHROPIC_API_KEY=<our per-install token> (see configureProviderEnv.ts), so its x-api-key header
// on every request here carries exactly that token -- requestMatchesToken's x-api-key branch is
// what accepts it. Verified by anthropicProxy.test.ts's own auth-sweep case.
//
// Wired into server.ts's native branch under the routing name "anthropic-proxy" -- like every
// other AGT/ENG native handler, split.ts's DEFAULT_ROUTES is deliberately left untouched (this
// only takes effect via MAESTRO_ENGINE_ROUTES=anthropic-proxy:native), so the contract suite's
// all-proxy default (scripts/run-contract-tests-via-engine.mjs) is unaffected.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { engineFetch } from '../../net/http';
import { loadSettings } from '../../settings/store';
import { forwardToOpenai, shouldBypass9router } from './anthropicToOpenai';
import {
  injectOpenrouterFileParser,
  isGeminiModel,
  isOpenaiMaxCompletionTokensModel,
  isOpenrouterModel,
  scrubRequestForGemini,
  scrubRequestForOpenaiGpt5,
} from './requestScrub';
import { buildForwardHeaders, HOP_HEADERS, pickUpstream } from './upstream';

// Gemini (especially the AI Studio key) intermittently 503s and 9Router holds the retry, which
// hangs the whole turn for the full read window. Bound Gemini so a stalled first response fails
// fast (~2 min) instead of stalling ~10 min; other providers keep the generous window for long
// reasoning turns. Mirrors p_read_timeout in the Python original -- fetch's AbortSignal has no
// separate connect-vs-read timeout knob, so this bounds the whole request, a strictly tighter
// (never looser) approximation of the Python original's connect=30s/read=N split.
const GEMINI_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 600_000;

function parseJsonObject(body: Buffer): Record<string, unknown> | null {
  if (body.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}

export interface AnthropicProxyDeps {
  fetchImpl: typeof engineFetch;
  /** Defaults to the real loopback 9Router URL (by way of MAESTRO_NINE_ROUTER_URL_OVERRIDE, see
   * below); a caller may override it to point the loopback leg at a throwaway fake server (tests)
   * instead of a real, possibly-already-running 9Router process on the same machine. */
  nineRouterUrl?: string;
}

// Read at call time (not module load) so tests that set/unset this per-case aren't order-
// dependent. Unset in every normal run -- this exists ONLY so a live gate script driving the real
// compiled engine binary (which can't inject a JS deps object into an already-spawned process) can
// redirect the loopback leg to a throwaway fake "9Router" instead of the real one, which may
// already be running on this same machine with real OAuth connections (see docs/plans/txm-
// status.md's AGT-1 row for why that process must never be sent live traffic by an automated
// pass). Same convention as MAESTRO_ENGINE_SKIP_BACKEND/MAESTRO_ENGINE_ROUTES: an env-var escape
// hatch that changes nothing when unset.
function defaultDeps(): AnthropicProxyDeps {
  const override = (process.env.MAESTRO_NINE_ROUTER_URL_OVERRIDE ?? '').trim();
  return { fetchImpl: engineFetch, nineRouterUrl: override || undefined };
}

/** Handles GET/HEAD/OPTIONS on the bare /api/anthropic-proxy[/] path (the CLI healthchecks the
 * proxy root) and every method on /api/anthropic-proxy/v1/{rest} (the real dispatch). Returns
 * false for anything else so the caller falls back to proxying at Python. */
export async function handleAnthropicProxyHttpRequest(
  pathname: string,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnthropicProxyDeps = defaultDeps(),
): Promise<boolean> {
  if (pathname === '/api/anthropic-proxy' || pathname === '/api/anthropic-proxy/') {
    reply.code(200).send({ ok: true });
    return true;
  }

  const match = /^\/api\/anthropic-proxy\/v1\/(.*)$/.exec(pathname);
  if (!match) return false;
  const rest = match[1];

  const rawBody = (request.body as Buffer | undefined) ?? Buffer.alloc(0);
  const parsedForBypass = parseJsonObject(rawBody);
  const model = parsedForBypass ? String(parsedForBypass.model ?? '') : '';
  const settings = loadSettings().settings;

  // 9Router-bypass path for PDF-bearing GPT-5.x requests -- 9Router 0.3.60 strips the OpenAI
  // native `type:file` shape, so we translate + POST directly to OpenAI and convert the streaming
  // response back to Anthropic SSE. See anthropicToOpenai.ts's module doc for the OpenRouter-direct
  // half's deliberate scope cut (no host-allowlist entry for openrouter.ai).
  if (parsedForBypass && isOpenaiMaxCompletionTokensModel(model)) {
    const openaiKey = (settings.openai_api_key ?? '').trim();
    if (shouldBypass9router(parsedForBypass, openaiKey)) {
      const result = await forwardToOpenai(parsedForBypass, openaiKey, deps.fetchImpl);
      reply.hijack();
      reply.raw.writeHead(result.status, result.headers as Record<string, string>);
      for await (const chunk of result.body) reply.raw.write(chunk);
      reply.raw.end();
      return true;
    }
  }

  let body = rawBody;
  if (isGeminiModel(model)) body = scrubRequestForGemini(body);
  if (isOpenaiMaxCompletionTokensModel(model)) body = scrubRequestForOpenaiGpt5(body);
  if (isOpenrouterModel(model)) body = injectOpenrouterFileParser(body);

  const { baseUrl, authHeaders } = pickUpstream(model, settings, deps.nineRouterUrl);
  const forwardHeaders = buildForwardHeaders(Object.entries(request.headers), authHeaders);

  const rawUrl = request.raw.url ?? '';
  const queryIdx = rawUrl.indexOf('?');
  const query = queryIdx === -1 ? '' : rawUrl.slice(queryIdx);
  const url = `${baseUrl}/v1/${rest}${query}`;

  const timeoutMs = isGeminiModel(model) ? GEMINI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const passthroughLane = baseUrl === 'https://api.anthropic.com' ? ('anthropic-passthrough' as const) : undefined;

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(
      url,
      { method: request.method, headers: forwardHeaders, body: body.length > 0 ? body : undefined, signal: AbortSignal.timeout(timeoutMs) },
      passthroughLane ? { passthroughLane } : {},
    );
  } catch (err) {
    if (isAbortLikeError(err)) {
      reply.code(504).send({ error: 'upstream timeout' });
    } else {
      reply.code(502).send({ error: String(err instanceof Error ? err.message : err).slice(0, 300) });
    }
    return true;
  }

  reply.hijack();
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    // content-encoding is also stripped here (not part of the shared HOP_HEADERS set, which is
    // reused for request-side filtering too): the platform fetch() implementation transparently
    // decompresses gzip/br/deflate bodies before Response.body ever yields bytes, so forwarding
    // the original content-encoding header alongside the already-decoded stream would tell the
    // client to decompress data that isn't compressed anymore.
    if (!HOP_HEADERS.has(lower) && lower !== 'content-encoding') responseHeaders[k] = v;
  });
  reply.raw.writeHead(upstream.status, responseHeaders);
  if (upstream.body) {
    Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(reply.raw);
  } else {
    reply.raw.end();
  }
  return true;
}
