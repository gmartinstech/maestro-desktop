// engine/src/agents/proxy/openaiPassthrough.test.ts -- ports the matching cases from
// backend/tests/test_v2_invariants.py's test_gpt5_param_scrub_drops_unsupported_sampling_knobs
// (the scrub_gpt5_params half), plus a Fastify-level test of the native handler itself.

import { describe, expect, test, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { handleOpenaiPassthroughHttpRequest, scrubGpt5Params } from './openaiPassthrough';

function j(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}
function parse(buf: Buffer): any {
  return JSON.parse(buf.toString('utf8'));
}

describe('scrubGpt5Params', () => {
  test('drops unsupported sampling knobs, renames max_tokens, and FLOORS the completion budget (unlike the proxy lane)', () => {
    const dirty = j({
      model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 200, temperature: 0, top_p: 0.9,
      frequency_penalty: 0.5, presence_penalty: 0.1, logprobs: true,
    });
    const out = parse(scrubGpt5Params(dirty));
    expect(out.max_tokens).toBeUndefined();
    for (const k of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logprobs']) {
      expect(out[k]).toBeUndefined();
    }
    // GATE: the max_tokens rename provably fires for a GPT-5-class model id.
    expect(out.max_completion_tokens).toBeGreaterThanOrEqual(32768);
  });

  test('temperature==1 is the one allowed value -- not over-stripped', () => {
    expect(parse(scrubGpt5Params(j({ model: 'gpt-5', temperature: 1 }))).temperature).toBe(1);
  });

  test('non-gpt-5 models are left completely untouched', () => {
    const body = j({ model: 'gpt-4o', temperature: 0, top_p: 0.5 });
    expect(parse(scrubGpt5Params(body))).toEqual({ model: 'gpt-4o', temperature: 0, top_p: 0.5 });
  });

  test('reasoning_effort is dropped only alongside tools', () => {
    const combo = j({ model: 'gpt-5.4-mini', messages: [], max_tokens: 200, reasoning_effort: 'low', tools: [{ type: 'function', function: { name: 't' } }] });
    const solo = j({ model: 'gpt-5.4-mini', messages: [], max_tokens: 200, reasoning_effort: 'low' });
    const outCombo = parse(scrubGpt5Params(combo));
    expect(outCombo.reasoning_effort).toBeUndefined();
    expect(outCombo.tools).toBeTruthy();
    expect(parse(scrubGpt5Params(solo)).reasoning_effort).toBe('low');
  });

  test('a leaked cp-openai/ routing prefix is stripped from the model id even for non-GPT-5 models', () => {
    const out = parse(scrubGpt5Params(j({ model: 'cp-openai/gpt-4o' })));
    expect(out.model).toBe('gpt-4o');
  });

  test('a low completion budget under a gpt-5 route prefix is still floored', () => {
    const out = parse(scrubGpt5Params(j({ model: 'cx/gpt-5.5', max_completion_tokens: 10 })));
    expect(out.max_completion_tokens).toBe(32768);
  });

  test('is a byte-identical no-op on an empty body / non-JSON body', () => {
    const empty = Buffer.alloc(0);
    expect(scrubGpt5Params(empty)).toBe(empty);
    const notJson = Buffer.from('not json', 'utf8');
    expect(scrubGpt5Params(notJson)).toBe(notJson);
  });
});

describe('handleOpenaiPassthroughHttpRequest (Fastify-level, real routing + a fake fetch)', () => {
  async function buildTestServer(fetchImpl: any): Promise<FastifyInstance> {
    const fastify = Fastify({ logger: false });
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    fastify.all('*', async (request, reply) => {
      const pathname = (request.raw.url ?? '/').split('?')[0];
      const handled = await handleOpenaiPassthroughHttpRequest(pathname, request, reply, fetchImpl);
      if (!handled) reply.code(404).send({ error: 'not_found' });
    });
    await fastify.ready();
    return fastify;
  }

  test('scrubs the body, forwards to api.openai.com/v1/{rest} on the openai-passthrough lane, and streams the response back', async () => {
    const fakeResponse = new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse);
    const fastify = await buildTestServer(fetchImpl);
    try {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/openai-passthrough/v1/chat/completions',
        payload: JSON.stringify({ model: 'gpt-5', max_tokens: 50, messages: [] }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init, options] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options).toEqual({ passthroughLane: 'openai-passthrough' });
      const sentBody = JSON.parse((init.body as Buffer).toString('utf8'));
      expect(sentBody.max_tokens).toBeUndefined();
      expect(sentBody.max_completion_tokens).toBeGreaterThanOrEqual(32768);
    } finally {
      await fastify.close();
    }
  });

  test('relays an upstream 4xx verbatim instead of hanging or swallowing it', async () => {
    const fakeResponse = new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse);
    const fastify = await buildTestServer(fetchImpl);
    try {
      const res = await fastify.inject({ method: 'POST', url: '/api/openai-passthrough/v1/chat/completions', payload: '{}' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload)).toEqual({ error: 'bad request' });
    } finally {
      await fastify.close();
    }
  });

  test('returns false (falls through) for a path outside its own /v1/ subtree', async () => {
    const fetchImpl = vi.fn();
    const fastify = await buildTestServer(fetchImpl);
    try {
      const res = await fastify.inject({ method: 'GET', url: '/api/openai-passthrough/other' });
      expect(res.statusCode).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await fastify.close();
    }
  });
});
