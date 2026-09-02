// engine/src/agents/proxy/anthropicToOpenai.test.ts -- ports the OpenAI-direct-bypass slice of
// backend/apps/agents/proxy/anthropic_to_openai.py's behavior (translate_request,
// should_bypass_9router, the SSE translator, forward_to_openai).

import { describe, expect, test, vi } from 'vitest';
import {
  contentBlocksToOpenai,
  estimateBodyBytes,
  forwardToOpenai,
  hasDocumentBlock,
  shouldBypass9router,
  sseEvent,
  translateRequest,
  translateResponseStream,
} from './anthropicToOpenai';

describe('hasDocumentBlock / shouldBypass9router', () => {
  const withDoc = { model: 'gpt-5.5', messages: [{ role: 'user', content: [{ type: 'document' }] }] };
  const withoutDoc = { model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }] };

  test('detects a document block anywhere in the message list', () => {
    expect(hasDocumentBlock(withDoc)).toBe(true);
    expect(hasDocumentBlock(withoutDoc)).toBe(false);
  });

  test('bypasses only for GPT-5.x + document + an API key, never codex, never with tools', () => {
    expect(shouldBypass9router(withDoc, 'sk-test')).toBe(true);
    expect(shouldBypass9router(withDoc, null)).toBe(false); // no key
    expect(shouldBypass9router(withoutDoc, 'sk-test')).toBe(false); // no document
    expect(shouldBypass9router({ ...withDoc, model: 'gpt-5.5-codex' }, 'sk-test')).toBe(false);
    expect(shouldBypass9router({ ...withDoc, tools: [{ name: 't' }] }, 'sk-test')).toBe(false);
    expect(shouldBypass9router({ ...withDoc, model: 'gpt-4o' }, 'sk-test')).toBe(false); // not gpt-5
  });
});

describe('contentBlocksToOpenai', () => {
  test('a bare string becomes a single text part', () => {
    expect(contentBlocksToOpenai('hi')).toEqual([{ type: 'text', text: 'hi' }]);
  });

  test('translates text/image/document blocks to OpenAI parts, numbering files', () => {
    const out = contentBlocksToOpenai([
      { type: 'text', text: 'summarize' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA=' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB=' } },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'summarize' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
      { type: 'file', file: { filename: 'attachment_1.pdf', file_data: 'data:application/pdf;base64,BBB=' } },
    ]);
  });

  test('falls back to an empty text part when nothing translates', () => {
    expect(contentBlocksToOpenai([{ type: 'unknown' }])).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('translateRequest', () => {
  test('strips a routing prefix from the model, maps system/messages, renames max_tokens', () => {
    const out = translateRequest({
      model: 'openai/gpt-5.5',
      system: 'be terse',
      max_tokens: 300,
      temperature: 0.4,
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    });
    expect(out.model).toBe('gpt-5.5');
    expect(out.stream).toBe(true);
    expect(out.max_completion_tokens).toBe(300);
    expect(out.max_tokens).toBeUndefined();
    expect(out.temperature).toBe(0.4);
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  test('an array-shaped system prompt is joined from its text blocks', () => {
    const out = translateRequest({ model: 'gpt-5', system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], messages: [] });
    expect(out.messages).toEqual([{ role: 'system', content: 'a\nb' }]);
  });

  test('a non-positive or absent max_tokens is not carried over', () => {
    expect(translateRequest({ model: 'gpt-5', messages: [] }).max_completion_tokens).toBeUndefined();
    expect(translateRequest({ model: 'gpt-5', max_tokens: 0, messages: [] }).max_completion_tokens).toBeUndefined();
  });
});

describe('sseEvent', () => {
  test('encodes an Anthropic-format SSE frame', () => {
    const buf = sseEvent('message_stop', { type: 'message_stop' });
    expect(buf.toString('utf8')).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
});

describe('translateResponseStream', () => {
  async function* fakeOpenAiSse(chunks: string[]): AsyncGenerator<Buffer> {
    for (const c of chunks) yield Buffer.from(c, 'utf8');
  }

  test('converts an OpenAI SSE stream into the full Anthropic event sequence', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}],"usage":null}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const events: any[] = [];
    for await (const buf of translateResponseStream(fakeOpenAiSse(chunks), 'claude-3-5-sonnet')) {
      const text = buf.toString('utf8');
      const m = /^event: (\S+)\ndata: (.+)\n\n$/s.exec(text);
      expect(m).toBeTruthy();
      events.push({ event: m![1], data: JSON.parse(m![2]) });
    }
    expect(events.map((e) => e.event)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop',
    ]);
    expect(events[0].data.message.model).toBe('claude-3-5-sonnet');
    expect(events[2].data.delta.text).toBe('Hel');
    expect(events[3].data.delta.text).toBe('lo');
    expect(events[5].data.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
    expect(events[5].data.delta.stop_reason).toBe('end_turn');
  });

  test('a keep-alive SSE comment is dropped, not treated as an event', async () => {
    const chunks = [': OPENROUTER PROCESSING\n\n', 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'];
    const events: string[] = [];
    for await (const buf of translateResponseStream(fakeOpenAiSse(chunks), 'm')) {
      events.push(/^event: (\S+)/.exec(buf.toString('utf8'))![1]);
    }
    expect(events).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  });
});

describe('estimateBodyBytes', () => {
  test('sums the base64 payload length across image_url and file blocks', () => {
    const body = {
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'file', file: { file_data: 'data:application/pdf;base64,BBBBBB' } },
        { type: 'text', text: 'ignored' },
      ] }],
    };
    expect(estimateBodyBytes(body)).toBe(4 + 6);
  });
});

describe('forwardToOpenai', () => {
  test('sends the translated body to the chat/completions endpoint via the injected fetch, on the openai-passthrough lane', async () => {
    const fakeResponse = new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse);
    const parsed = { model: 'gpt-5.5', max_tokens: 400, messages: [{ role: 'user', content: 'hi' }] };
    const result = await forwardToOpenai(parsed, 'sk-test', fetchImpl as any);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options).toEqual({ passthroughLane: 'openai-passthrough' });
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe('gpt-5.5');
    expect(sentBody.max_completion_tokens).toBe(400);
    expect(sentBody.max_tokens).toBeUndefined();
    expect(result.status).toBe(200);

    // Drain the body so the semaphore this call acquired is released before the test ends.
    for await (const chunk of result.body) { void chunk; }
  });

  test('rejects an oversized attachment before ever calling fetch', async () => {
    const fetchImpl = vi.fn();
    const hugeB64 = 'A'.repeat(60 * 1024 * 1024); // ~60MB base64 => way over the 40MB raw cap
    const parsed = { model: 'gpt-5.5', messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: hugeB64 } }] }] };
    const result = await forwardToOpenai(parsed, 'sk-test', fetchImpl as any);
    expect(result.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
    const chunks: Buffer[] = [];
    for await (const c of result.body) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(payload.error.type).toBe('invalid_request_error');
  });
});
