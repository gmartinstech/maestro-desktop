// engine/src/agents/proxy/openaiPassthrough.ts -- AGT-7, ports backend/apps/agents/core/
// openai_passthrough.py: a tiny OpenAI passthrough renaming max_tokens to max_completion_tokens
// for GPT-5 (9Router 0.3.60 is pinned and doesn't know the rename), plus the sampling-knob strip
// GPT-5's reasoning models reject. This is the file item 2 of the ticket's "will bite" list names
// directly -- see scrubGpt5Params below.
//
// Mounted at /api/openai-passthrough (matches backend/config/Apps.py's SubApp("openai-passthrough",
// ...) prefix convention, and engine/src/auth/middleware.ts's AUTH_EXEMPT_PREFIXES already carries
// this exact path -- 9Router forwards the user's own sk-... OpenAI bearer here, not our local
// install token, so this route is intentionally auth-exempt on BOTH sides, unlike anthropic-proxy.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { engineFetch } from '../../net/http';

const OPENAI_UPSTREAM = 'https://api.openai.com/v1';

// Mirrors anthropic_proxy.py's/requestScrub.ts's GPT-5 matcher; duplicated (not imported) because
// the Python original duplicates it too, "to avoid the cross-module dep" per its own comment.
const GPT5_PREFIXES: readonly string[] = ['gpt-5'];
const MODEL_ROUTE_PREFIXES: readonly string[] = ['openai/', 'cx/', 'openrouter/', 'or:openai/', 'cp/', 'cp-'];

const HOP_HEADERS: ReadonlySet<string> = new Set([
  'host', 'content-length', 'connection', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

function isGpt5(model: string | null | undefined): boolean {
  let m = (model ?? '').trim().toLowerCase();
  if (!m) return false;
  for (const prefix of MODEL_ROUTE_PREFIXES) {
    if (m.startsWith(prefix)) { m = m.slice(prefix.length); break; }
  }
  return GPT5_PREFIXES.some((p) => m.startsWith(p));
}

// GPT-5 reasoning models reject sampling knobs: temperature must be the default (only 1 is
// allowed), and top_p / penalties / logprobs are unsupported outright. 9Router 0.3.60 is pinned
// and forwards whatever the user's picked model carried, so we strip them at this last hop before
// OpenAI or the whole request 400s.
const GPT5_UNSUPPORTED_PARAMS: readonly string[] = ['top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'logprobs', 'top_logprobs', 'logit_bias'];

// Our OpenAI lane's 9Router node prefix; 0.3.60 intermittently forwards the model WITH it
// (cp-openai/gpt-5.5) so OpenAI 400s "invalid model ID", and as the last hop we strip it to the
// bare id.
const CP_OPENAI_PREFIX = 'cp-openai/';

// GPT-5 burns 8-30K hidden reasoning tokens before output and OpenAI 400s "max_tokens reached"
// under that; the 9router_gpt5 patch's floor never fires on our lane (9Router calls this
// passthrough, not api.openai.com), so floor it here, only raising.
const GPT5_MIN_COMPLETION_TOKENS = 32768;

type JsonRecord = Record<string, unknown>;

/** Prep an OpenAI chat body: normalize the model id (drop a leaked `cp-openai/` routing prefix)
 * and, for GPT-5, rename max_tokens->max_completion_tokens and drop the sampling params the
 * reasoning models reject. Bytes in/out, never throws. This is the function the ticket's own
 * gate item 2 exercises: "the max_tokens rename provably fires for a GPT-5-class model id". */
export function scrubGpt5Params(body: Buffer): Buffer {
  if (body.length === 0) return body;
  let parsed: JsonRecord;
  try {
    const p: unknown = JSON.parse(body.toString('utf8'));
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return body;
    parsed = p as JsonRecord;
  } catch {
    return body;
  }
  let mutated = false;
  let model = String(parsed.model ?? '');
  if (model.startsWith(CP_OPENAI_PREFIX)) {
    model = model.slice(CP_OPENAI_PREFIX.length);
    parsed.model = model;
    mutated = true;
  }
  if (!isGpt5(model)) {
    return mutated ? Buffer.from(JSON.stringify(parsed), 'utf8') : body;
  }
  if ('max_tokens' in parsed) {
    if (!('max_completion_tokens' in parsed)) {
      parsed.max_completion_tokens = parsed.max_tokens;
    }
    delete parsed.max_tokens;
    mutated = true;
  }
  const mct = parsed.max_completion_tokens;
  if (typeof mct === 'number' && !Number.isNaN(mct) && mct < GPT5_MIN_COMPLETION_TOKENS) {
    parsed.max_completion_tokens = GPT5_MIN_COMPLETION_TOKENS;
    mutated = true;
  }
  if ('temperature' in parsed && parsed.temperature !== 1) {
    delete parsed.temperature;
    mutated = true;
  }
  for (const k of GPT5_UNSUPPORTED_PARAMS) {
    if (k in parsed) { delete parsed[k]; mutated = true; }
  }
  // OpenAI started rejecting reasoning_effort + function tools together on /chat/completions
  // (live-confirmed 2026-07-08, all gpt-5.x); dropping effort loses thinking but the turn
  // completes. Real fix = /v1/responses migration.
  if ('tools' in parsed && 'reasoning_effort' in parsed) {
    delete parsed.reasoning_effort;
    mutated = true;
  }
  return mutated ? Buffer.from(JSON.stringify(parsed), 'utf8') : body;
}

function headerMapToPlain(headers: FastifyRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (HOP_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/** Handles every method on /api/openai-passthrough/v1/{rest}; returns false (reply left
 * untouched) for any other path so the caller can fall back to proxying at Python. `fetchImpl`
 * defaults to the real, allowlist-checked engineFetch; a caller may inject a fake for tests. */
export async function handleOpenaiPassthroughHttpRequest(
  pathname: string,
  request: FastifyRequest,
  reply: FastifyReply,
  fetchImpl: typeof engineFetch = engineFetch,
): Promise<boolean> {
  const match = /^\/api\/openai-passthrough\/v1\/(.*)$/.exec(pathname);
  if (!match) return false;
  const rest = match[1];

  const rawBody = (request.body as Buffer | undefined) ?? Buffer.alloc(0);
  const body = scrubGpt5Params(rawBody);

  const rawUrl = request.raw.url ?? '';
  const queryIdx = rawUrl.indexOf('?');
  const query = queryIdx === -1 ? '' : rawUrl.slice(queryIdx);
  const upstreamUrl = `${OPENAI_UPSTREAM}/${rest}${query}`;

  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, { method: request.method, headers: headerMapToPlain(request.headers), body: body.length > 0 ? body : undefined }, { passthroughLane: 'openai-passthrough' });
  } catch (err) {
    reply.code(502).send({ error: { message: err instanceof Error ? err.message : String(err), type: 'upstream_error' } });
    return true;
  }

  if (upstream.status >= 400) {
    const raw = Buffer.from(await upstream.arrayBuffer());
    reply.code(upstream.status);
    reply.header('content-type', upstream.headers.get('content-type') ?? 'application/json');
    reply.send(raw);
    return true;
  }

  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    if (!HOP_HEADERS.has(k.toLowerCase())) responseHeaders[k] = v;
  });

  reply.hijack();
  reply.raw.writeHead(upstream.status, responseHeaders);
  if (upstream.body) {
    Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(reply.raw);
  } else {
    reply.raw.end();
  }
  return true;
}
