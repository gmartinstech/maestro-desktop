// engine/src/agents/proxy/requestScrub.ts -- AGT-7, ports backend/apps/agents/proxy/
// anthropic_proxy.py's model-family classifiers and the three per-family request-body scrubbers
// (scrub_request_for_openai_gpt5, scrub_request_for_gemini, inject_openrouter_file_parser) plus
// their shared document/image-block rewriters. Pure, bytes-in/bytes-out, never throws -- every
// function here mirrors that contract exactly (a parse failure or unexpected shape returns the
// input Buffer unchanged, same as the Python original's bare `except Exception: return body`).
//
// NOT ported: the direct-to-OpenRouter bypass translator (anthropic_to_openai.py's
// should_bypass_9router_for_openrouter/forward_to_openrouter). engine/src/net/http.ts's
// provider-egress allowlist (ENG-7) only names two passthrough lanes -- api.anthropic.com and
// api.openai.com -- mirroring AGT-1's own deliberate cut of openrouter.py ("no catalog entry uses
// route=openrouter"); openrouter.ai has no allowlist entry to route a direct bypass through
// safely, so that half of anthropic_to_openai.py stays unported here too. The 9Router-routed
// OpenRouter path (inject_openrouter_file_parser, below) is unaffected -- it only edits the JSON
// body sent to the already-allowed loopback 9Router process, never dials openrouter.ai itself.

import { normalizeSchemaForGemini } from './geminiSchema';

export const CLAUDE_MODEL_PREFIXES: readonly string[] = ['claude-', 'claude/', 'sonnet', 'opus', 'haiku', 'cc/'];
export const GEMINI_MODEL_PREFIXES: readonly string[] = ['gemini/', 'gc/', 'ag/'];
// Own-key Gemini ("gemini-3.5-flash-api" etc.) skips the gemini/ prefix; match bare names so the
// $schema scrub still fires.
export const GEMINI_BARE_MODEL_PATTERNS: readonly string[] = ['gemini-'];

export function isClaudeModel(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase();
  return CLAUDE_MODEL_PREFIXES.some((p) => m.startsWith(p));
}

export function isGeminiModel(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase();
  if (GEMINI_MODEL_PREFIXES.some((p) => m.startsWith(p))) return true;
  // Bare-name match for own-key Gemini; excludes anthropic-routed gemini (those carry "/").
  if (m.includes('/')) return false;
  return GEMINI_BARE_MODEL_PATTERNS.some((p) => m.startsWith(p));
}

// GPT-5.x rejects max_tokens; needs max_completion_tokens. Anthropic-format wire still emits
// max_tokens; we rename on the way out.
const OPENAI_MAX_COMPLETION_TOKENS_MODELS: readonly string[] = ['gpt-5'];
const OPENAI_MODEL_ROUTE_PREFIXES: readonly string[] = ['openai/', 'cx/', 'openrouter/', 'or:openai/', 'cp/', 'cp-'];

/** Match every shape a GPT-5 name might arrive in (bare, api-suffixed, openai/-prefixed,
 * cx/-routed). */
export function isOpenaiMaxCompletionTokensModel(model: string | null | undefined): boolean {
  let m = (model ?? '').trim().toLowerCase();
  if (!m) return false;
  for (const prefix of OPENAI_MODEL_ROUTE_PREFIXES) {
    if (m.startsWith(prefix)) {
      m = m.slice(prefix.length);
      break;
    }
  }
  return OPENAI_MAX_COMPLETION_TOKENS_MODELS.some((p) => m.startsWith(p));
}

export const OPENROUTER_MODEL_PREFIXES: readonly string[] = ['openrouter/', 'or:'];

export function isOpenrouterModel(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase();
  return OPENROUTER_MODEL_PREFIXES.some((p) => m.startsWith(p));
}

type JsonRecord = Record<string, unknown>;

function parseJsonObject(body: Buffer): JsonRecord | null {
  if (body.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonRecord) : null;
  } catch {
    return null;
  }
}

function contentBlocks(msg: unknown): JsonRecord[] | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const content = (msg as JsonRecord).content;
  return Array.isArray(content) ? (content as JsonRecord[]) : null;
}

/** In-place: rewrite Anthropic base64 `image` blocks to OpenAI `image_url` (PDFs go via
 * OpenRouter, see the module doc's scope-cut note). */
export function rewriteDocumentToOpenaiFile(parsed: JsonRecord): void {
  const msgs = parsed.messages;
  if (!Array.isArray(msgs)) return;
  for (const m of msgs) {
    const content = contentBlocks(m);
    if (!content) continue;
    for (const block of content) {
      const btype = block.type;
      const src = (block.source ?? {}) as JsonRecord;
      if (typeof src !== 'object' || src === null || src.type !== 'base64') continue;
      const data = src.data;
      if (typeof data !== 'string' || !data) continue;
      const mediaType = (src.media_type as string | undefined) || '';

      // 9router 0.3.60 chunk 318 stringifies ANY non-`text`/`image_url` block. Image blocks →
      // image_url with data: URL. PDFs on OpenAI direct are REFUSED upstream (agent_manager
      // resolveAttachments has openai NOT in supports_pdf) because OpenAI Chat Completions
      // rejects non-image mime types inside image_url with "Invalid MIME type. Only image types
      // are supported." (verified empirically May 2026). The shipping path for OpenAI PDFs is
      // openrouter/openai/gpt-5 which uses OR's file-parser plugin.
      if (btype !== 'image') continue;
      const mt = mediaType || 'image/png';
      for (const k of Object.keys(block)) delete block[k];
      block.type = 'image_url';
      block.image_url = { url: `data:${mt};base64,${data}` };
    }
  }
}

/** Rename max_tokens→max_completion_tokens for GPT-5 AND rewrite any Anthropic document blocks to
 * OpenAI type:file shape so PDFs flow natively on GPT-5.x vision models. Bytes in/out, never
 * throws. */
export function scrubRequestForOpenaiGpt5(body: Buffer): Buffer {
  if (body.length === 0) return body;
  const parsed = parseJsonObject(body);
  if (parsed === null) return body;
  let mutated = false;
  if ('max_tokens' in parsed && !('max_completion_tokens' in parsed)) {
    parsed.max_completion_tokens = parsed.max_tokens;
    delete parsed.max_tokens;
    mutated = true;
  } else if ('max_tokens' in parsed && 'max_completion_tokens' in parsed) {
    delete parsed.max_tokens;
    mutated = true;
  }
  // GPT-5 reasoning models reject sampling knobs (temperature must be 1, top_p and penalties
  // unsupported); the wire carries them for the user's picked model.
  if ('temperature' in parsed && parsed.temperature !== 1) {
    delete parsed.temperature;
    mutated = true;
  }
  for (const k of ['top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'logprobs', 'top_logprobs', 'logit_bias']) {
    if (k in parsed) {
      delete parsed[k];
      mutated = true;
    }
  }
  // OpenAI started rejecting reasoning_effort + function tools together on /chat/completions
  // (live-confirmed 2026-07-08, all gpt-5.x); dropping effort loses thinking but the turn
  // completes.
  if ('tools' in parsed && 'reasoning_effort' in parsed) {
    delete parsed.reasoning_effort;
    mutated = true;
  }
  try {
    const before = 'messages' in parsed ? JSON.stringify(parsed.messages) : '';
    rewriteDocumentToOpenaiFile(parsed);
    const after = 'messages' in parsed ? JSON.stringify(parsed.messages) : '';
    if (before !== after) mutated = true;
  } catch { /* never raise, same as the Python original's bare except */ }
  return mutated ? Buffer.from(JSON.stringify(parsed), 'utf8') : body;
}

/** In-place: rewrite Anthropic `document` (PDF) AND `image` content blocks → OpenAI `image_url`
 * shape with a `data:` URL. Critical fix for 9router 0.3.60 which **only translates `image_url`
 * blocks** to Gemini's `inlineData`. Strictly defensive: rewrite only when source.type='base64'
 * and data is present. Unknown shapes pass through untouched. */
export function rewriteDocumentToImage(parsed: JsonRecord): void {
  const msgs = parsed.messages;
  if (!Array.isArray(msgs)) return;
  for (const m of msgs) {
    const content = contentBlocks(m);
    if (!content) continue;
    for (const block of content) {
      const btype = block.type;
      if (btype !== 'document' && btype !== 'image') continue;
      const src = (block.source ?? {}) as JsonRecord;
      if (typeof src !== 'object' || src === null || src.type !== 'base64') continue;
      const data = src.data;
      if (typeof data !== 'string' || !data) continue;
      const mediaType = btype === 'document'
        ? (src.media_type as string | undefined) || 'application/pdf'
        : (src.media_type as string | undefined) || 'image/png';
      for (const k of Object.keys(block)) delete block[k];
      block.type = 'image_url';
      block.image_url = { url: `data:${mediaType};base64,${data}` };
    }
  }
}

/** When the request has document blocks AND is bound for OpenRouter (via the loopback 9Router
 * process, not a direct dial -- see the module doc), inject the file-parser plugin so OR's
 * universal PDF support kicks in on any model. Bytes-in/out, never throws. */
export function injectOpenrouterFileParser(body: Buffer): Buffer {
  if (body.length === 0) return body;
  const parsed = parseJsonObject(body);
  if (parsed === null) return body;
  const msgs = parsed.messages;
  if (!Array.isArray(msgs)) return body;
  let hasDoc = false;
  for (const m of msgs) {
    const content = contentBlocks(m);
    if (!content) continue;
    if (content.some((b) => b.type === 'document')) {
      hasDoc = true;
      break;
    }
  }
  if (!hasDoc) return body;
  const existing = parsed.plugins;
  const plugins: JsonRecord[] = Array.isArray(existing) ? (existing as JsonRecord[]) : [];
  if (!plugins.some((p) => p.id === 'file-parser')) {
    plugins.push({ id: 'file-parser', pdf: { engine: 'pdf-text' } });
  }
  parsed.plugins = plugins;
  return Buffer.from(JSON.stringify(parsed), 'utf8');
}

/** Strip Gemini-incompatible schema keys from request tools AND rewrite Anthropic document blocks
 * to image-shape so 9router's inline_data translator picks them up. Bytes-in/out, never throws. */
export function scrubRequestForGemini(body: Buffer): Buffer {
  if (body.length === 0) return body;
  const parsed = parseJsonObject(body);
  if (parsed === null) return body;
  const tools = parsed.tools;
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (typeof t !== 'object' || t === null) continue;
      const tool = t as JsonRecord;
      if (typeof tool.input_schema === 'object' && tool.input_schema !== null) {
        tool.input_schema = normalizeSchemaForGemini(tool.input_schema);
      }
      if (typeof tool.parameters === 'object' && tool.parameters !== null) {
        tool.parameters = normalizeSchemaForGemini(tool.parameters);
      }
    }
  }
  try {
    rewriteDocumentToImage(parsed);
  } catch { /* never raise, same as the Python original's bare except */ }
  return Buffer.from(JSON.stringify(parsed), 'utf8');
}
