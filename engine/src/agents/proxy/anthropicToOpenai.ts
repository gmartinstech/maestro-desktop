// engine/src/agents/proxy/anthropicToOpenai.ts -- AGT-7, ports backend/apps/agents/proxy/
// anthropic_to_openai.py's OpenAI-direct half: an Anthropic Messages API <-> OpenAI Chat
// Completions translator used to bypass 9Router for GPT-5.x requests carrying a PDF document
// block (9Router 0.3.60's content-block filter strips anything that isn't `text`/`image_url`, so
// a native OpenAI `type:file` block never reaches the model). Scope: PDFs + images + text; no
// tool-use translation (matches the Python original -- the PDF-attach flow doesn't need tools in
// the same turn, and a request with both tools and documents falls through to the normal 9Router
// path instead of this bypass).
//
// NOT ported: the OpenRouter-direct half (should_bypass_9router_for_openrouter /
// forward_to_openrouter) -- see requestScrub.ts's module doc for why (no openrouter.ai entry on
// engine/src/net/http.ts's provider-egress allowlist).

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { engineFetch } from '../../net/http';

export const OPENAI_UPSTREAM = 'https://api.openai.com/v1';

// Concurrency cap for bypass-route requests -- each in-flight request holds the base64'd PDF
// (raw_bytes * 1.33) in memory across the fetch pipeline + the SSE translator's chunk buffer +
// the response body. Mirrors anthropic_to_openai.py's BYPASS_CONCURRENCY=2 (see that file's
// comment for the observed OOM this guards against).
const BYPASS_CONCURRENCY = 2;

// Hard per-request body size ceiling -- refuse anything over 40MB raw (~53MB base64) before
// building the request body at all. Mirrors P_BYPASS_MAX_RAW_BYTES.
const BYPASS_MAX_RAW_BYTES = 40 * 1024 * 1024;

// A tiny counting semaphore -- Node has no stdlib equivalent of asyncio.Semaphore.
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  constructor(count: number) { this.available = count; }
  async acquire(): Promise<void> {
    if (this.available > 0) { this.available -= 1; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available += 1;
  }
}
const bypassSema = new Semaphore(BYPASS_CONCURRENCY);

type JsonRecord = Record<string, unknown>;

function contentList(msg: unknown): JsonRecord[] | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const content = (msg as JsonRecord).content;
  return Array.isArray(content) ? (content as JsonRecord[]) : null;
}

export function hasDocumentBlock(parsed: JsonRecord): boolean {
  const msgs = parsed.messages;
  if (!Array.isArray(msgs)) return false;
  for (const m of msgs) {
    const content = contentList(m);
    if (!content) continue;
    if (content.some((b) => b.type === 'document')) return true;
  }
  return false;
}

/** True iff request is a GPT-5.x Chat Completions with at least one document block AND the user
 * has an OpenAI API key. Anything else falls through to the normal 9Router path. */
export function shouldBypass9router(parsed: JsonRecord, apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const model = String(parsed.model ?? '').toLowerCase();
  if (!['gpt-5', 'openai/gpt-5', 'cp-openai/gpt-5'].some((p) => model.startsWith(p))) return false;
  if (model.includes('codex')) return false;
  if (parsed.tools) return false;
  return hasDocumentBlock(parsed);
}

/** Convert Anthropic content blocks -> OpenAI Chat Completions parts. */
export function contentBlocksToOpenai(content: unknown): JsonRecord[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content) }];
  const out: JsonRecord[] = [];
  let fileCounter = 0;
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as JsonRecord;
    const btype = b.type;
    if (btype === 'text') {
      const txt = (b.text as string | undefined) || '';
      if (txt) out.push({ type: 'text', text: txt });
    } else if (btype === 'image') {
      const src = (b.source ?? {}) as JsonRecord;
      if (src.type === 'base64' && src.data) {
        const mt = (src.media_type as string | undefined) || 'image/png';
        out.push({ type: 'image_url', image_url: { url: `data:${mt};base64,${src.data as string}` } });
      }
    } else if (btype === 'document') {
      const src = (b.source ?? {}) as JsonRecord;
      if (src.type === 'base64' && src.data) {
        fileCounter += 1;
        const mt = (src.media_type as string | undefined) || 'application/pdf';
        out.push({ type: 'file', file: { filename: `attachment_${fileCounter}.pdf`, file_data: `data:${mt};base64,${src.data as string}` } });
      }
    }
  }
  if (out.length === 0) out.push({ type: 'text', text: '' });
  return out;
}

/** Anthropic Messages request -> OpenAI Chat Completions request. */
export function translateRequest(parsed: JsonRecord): JsonRecord {
  let model = String(parsed.model ?? '');
  if (model.includes('/')) model = model.split('/', 2)[1];
  const openaiBody: JsonRecord = { model, stream: true };

  const sys = parsed.system;
  const msgsOut: JsonRecord[] = [];
  if (sys) {
    if (typeof sys === 'string') {
      msgsOut.push({ role: 'system', content: sys });
    } else if (Array.isArray(sys)) {
      const sysText = sys
        .filter((b): b is JsonRecord => typeof b === 'object' && b !== null && (b as JsonRecord).type === 'text')
        .map((b) => (b.text as string | undefined) || '')
        .join('\n');
      if (sysText) msgsOut.push({ role: 'system', content: sysText });
    }
  }

  for (const m of (Array.isArray(parsed.messages) ? parsed.messages : [])) {
    if (typeof m !== 'object' || m === null) continue;
    const mm = m as JsonRecord;
    const role = mm.role;
    if (role !== 'user' && role !== 'assistant') continue;
    msgsOut.push({ role, content: contentBlocksToOpenai(mm.content) });
  }

  openaiBody.messages = msgsOut;
  const mt = parsed.max_tokens;
  if (typeof mt === 'number' && Number.isInteger(mt) && mt > 0) {
    openaiBody.max_completion_tokens = mt;
  }
  if (typeof parsed.temperature === 'number') {
    openaiBody.temperature = parsed.temperature;
  }
  // OpenAI omits usage from streamed chunks unless explicitly asked. Without this, our Anthropic
  // message_delta would always report 0 tokens, breaking cost tracking + the context meter for
  // bypass-route turns. OpenRouter respects the same flag (unused here, see module doc).
  openaiBody.stream_options = { include_usage: true };
  return openaiBody;
}

/** Encode an Anthropic-format SSE event. */
export function sseEvent(event: string, data: JsonRecord): Buffer {
  return Buffer.from(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, 'utf8');
}

/** Convert an OpenAI Chat Completions SSE byte stream -> Anthropic Messages SSE bytes.
 * Emits message_start, content_block_start (text block at index 0), content_block_delta per
 * chunk, then content_block_stop + message_delta + message_stop on completion. */
export async function* translateResponseStream(body: AsyncIterable<Buffer>, model: string): AsyncGenerator<Buffer> {
  const msgId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  let started = false;
  let blockOpened = false;
  let outputTokens = 0;
  let inputTokens = 0;
  let stopReason = 'end_turn';

  let buffer = Buffer.alloc(0);
  try {
    for await (const chunk of body) {
      if (!chunk || chunk.length === 0) continue;
      buffer = Buffer.concat([buffer, chunk]);
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.subarray(0, sepIdx);
        buffer = buffer.subarray(sepIdx + 2);
        const line = rawEvent.toString('utf8').trim();
        if (!line) continue;
        for (const ln of line.split('\n')) {
          // SSE comments (`:` prefix) are keep-alives, e.g. OpenRouter's "processing" pings (not
          // reachable via this OpenAI-only bypass, but harmless to keep dropping). Drop them.
          if (ln.startsWith(':')) continue;
          if (!ln.startsWith('data:')) continue;
          const payload = ln.slice(5).trim();
          if (payload === '[DONE]') continue;
          let ev: JsonRecord;
          try {
            ev = JSON.parse(payload) as JsonRecord;
          } catch {
            continue;
          }
          if (!started) {
            const usage = (ev.usage ?? {}) as JsonRecord;
            inputTokens = Number(usage.prompt_tokens ?? 0);
            yield sseEvent('message_start', {
              type: 'message_start',
              message: {
                id: msgId, type: 'message', role: 'assistant', content: [],
                model, stop_reason: null, stop_sequence: null,
                usage: { input_tokens: inputTokens, output_tokens: 0 },
              },
            });
            started = true;
          }
          const choices = (ev.choices as JsonRecord[] | undefined) ?? [];
          if (choices.length === 0) {
            const usage = (ev.usage ?? {}) as JsonRecord;
            if (usage && Object.keys(usage).length > 0) {
              outputTokens = Number(usage.completion_tokens ?? outputTokens);
              inputTokens = Number(usage.prompt_tokens ?? inputTokens);
            }
            continue;
          }
          const choice = choices[0];
          const delta = (choice.delta ?? {}) as JsonRecord;
          const deltaText = delta.content;
          if (typeof deltaText === 'string' && deltaText) {
            if (!blockOpened) {
              yield sseEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
              blockOpened = true;
            }
            yield sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: deltaText } });
          }
          const finish = choice.finish_reason;
          if (finish) {
            if (finish === 'length') stopReason = 'max_tokens';
            else if (finish === 'tool_calls') stopReason = 'tool_use';
            else stopReason = 'end_turn';
          }
        }
      }
    }
  } finally {
    if (started) {
      if (blockOpened) yield sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
      yield sseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: inputTokens, output_tokens: outputTokens } });
      yield sseEvent('message_stop', { type: 'message_stop' });
    }
  }
}

/** Sum the base64 payload bytes across content blocks -- a cheap pre-flight check before the
 * body is actually serialized/sent. */
export function estimateBodyBytes(bodyJson: JsonRecord): number {
  let total = 0;
  for (const m of (Array.isArray(bodyJson.messages) ? (bodyJson.messages as JsonRecord[]) : [])) {
    const content = contentList(m);
    if (!content) continue;
    for (const block of content) {
      if (block.type === 'image_url') {
        const url = ((block.image_url as JsonRecord | undefined)?.url as string | undefined) ?? '';
        const comma = url.indexOf(',');
        if (comma !== -1) total += url.length - comma - 1;
      } else if (block.type === 'file') {
        const fd = ((block.file as JsonRecord | undefined)?.file_data as string | undefined) ?? '';
        const comma = fd.indexOf(',');
        if (comma !== -1) total += fd.length - comma - 1;
      }
    }
  }
  return total;
}

export interface ForwardResult {
  status: number;
  /** The raw response bytes, already translated to Anthropic SSE on a successful (< 400) status;
   * the verbatim upstream error body otherwise. */
  body: AsyncIterable<Buffer>;
  headers: Readonly<Record<string, string>>;
}

async function* singleChunk(buf: Buffer): AsyncGenerator<Buffer> {
  yield buf;
}

async function forward(bodyJson: JsonRecord, apiKey: string, url: string, fetchImpl: typeof engineFetch): Promise<ForwardResult> {
  // Pre-flight size check. base64 expands ~4/3 so 40MB raw -> ~53MB b64.
  const rawEstimate = Math.floor(estimateBodyBytes(bodyJson) * 0.75);
  if (rawEstimate > BYPASS_MAX_RAW_BYTES) {
    const payload = Buffer.from(JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Attached files total ~${Math.floor(rawEstimate / (1024 * 1024))} MB, over the ${Math.floor(BYPASS_MAX_RAW_BYTES / (1024 * 1024))} MB per-request cap on this provider lane. Detach a file or split across separate turns.`,
      },
    }), 'utf8');
    return { status: 413, body: singleChunk(payload), headers: { 'content-type': 'application/json' } };
  }

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' };

  // Acquire the bypass-concurrency semaphore before opening a streaming connection -- see the
  // module doc for the OOM this guards against.
  await bypassSema.acquire();
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(bodyJson) }, { passthroughLane: 'openai-passthrough' });
  } catch (err) {
    bypassSema.release();
    throw err;
  }

  async function* streamer(): AsyncGenerator<Buffer> {
    try {
      if (upstream.status >= 400) {
        const raw = Buffer.from(await upstream.arrayBuffer());
        yield raw;
        return;
      }
      const nodeBody = upstream.body ? Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]) : Readable.from([]);
      // Echo the REQUESTED model, never upstream's: the gateway substitutes freely, so a
      // request/response comparison here would flag healthy traffic as an error.
      yield* translateResponseStream(nodeBody, String(bodyJson.model));
    } finally {
      bypassSema.release();
    }
  }

  return {
    status: upstream.status,
    body: streamer(),
    headers: { 'content-type': upstream.status < 400 ? 'text/event-stream' : 'application/json' },
  };
}

/** Translate + forward an Anthropic request to OpenAI Chat Completions. `fetchImpl` defaults to
 * the real, allowlist-checked engineFetch (net/http.ts); a caller may inject a fake for tests. */
export async function forwardToOpenai(parsed: JsonRecord, apiKey: string, fetchImpl: typeof engineFetch = engineFetch): Promise<ForwardResult> {
  const openaiBody = translateRequest(parsed);
  return forward(openaiBody, apiKey, `${OPENAI_UPSTREAM}/chat/completions`, fetchImpl);
}
