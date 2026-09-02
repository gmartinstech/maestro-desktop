// engine/src/agents/proxy/requestScrub.test.ts -- ports the matching cases from backend/tests/
// test_v2_invariants.py (scrub_request_for_gemini / scrub_request_for_openai_gpt5 /
// inject_openrouter_file_parser / the model-family classifiers), case-for-case.

import { describe, expect, test } from 'vitest';
import {
  injectOpenrouterFileParser,
  isClaudeModel,
  isGeminiModel,
  isOpenaiMaxCompletionTokensModel,
  isOpenrouterModel,
  scrubRequestForGemini,
  scrubRequestForOpenaiGpt5,
} from './requestScrub';

function j(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}
function parse(buf: Buffer): any {
  return JSON.parse(buf.toString('utf8'));
}

describe('model-family classifiers', () => {
  test('isClaudeModel matches every documented prefix', () => {
    for (const m of ['claude-3-5-sonnet', 'claude/opus', 'sonnet-4', 'opus-4', 'haiku-3', 'cc/claude-3-5-sonnet']) {
      expect(isClaudeModel(m)).toBe(true);
    }
    expect(isClaudeModel('gpt-5')).toBe(false);
    expect(isClaudeModel('')).toBe(false);
    expect(isClaudeModel(null)).toBe(false);
  });

  test('isGeminiModel matches prefixed and bare own-key names, excludes slash-bearing bare names', () => {
    expect(isGeminiModel('gemini/gemini-3-pro')).toBe(true);
    expect(isGeminiModel('gc/gemini-3-pro')).toBe(true);
    expect(isGeminiModel('ag/gemini-3-pro')).toBe(true);
    expect(isGeminiModel('gemini-3.5-flash-api')).toBe(true); // own-key, bare
    expect(isGeminiModel('openrouter/gemini-3-pro')).toBe(false); // has "/", not a recognized prefix
    expect(isGeminiModel('gpt-5')).toBe(false);
  });

  test('isOpenaiMaxCompletionTokensModel matches every routing shape a GPT-5 id can arrive in', () => {
    for (const m of ['gpt-5', 'gpt-5.5', 'openai/gpt-5', 'cx/gpt-5.5', 'openrouter/gpt-5', 'or:openai/gpt-5', 'cp/gpt-5']) {
      expect(isOpenaiMaxCompletionTokensModel(m)).toBe(true);
    }
    expect(isOpenaiMaxCompletionTokensModel('gpt-4o')).toBe(false);
    expect(isOpenaiMaxCompletionTokensModel('')).toBe(false);
    // A stray "cp-" strip only ever removes ONE layer (mirrors the Python original exactly): after
    // stripping "cp-" this becomes "openai/gpt-5.5", which does NOT itself start with "gpt-5" --
    // the "cp-openai/" double-prefix is only unwrapped by openaiPassthrough.ts's own separate,
    // explicit P_CP_OPENAI_PREFIX strip, not by this classifier.
    expect(isOpenaiMaxCompletionTokensModel('cp-openai/gpt-5.5')).toBe(false);
  });

  test('isOpenrouterModel matches both documented prefixes', () => {
    expect(isOpenrouterModel('openrouter/qwen/qwen-2.5-72b-instruct')).toBe(true);
    expect(isOpenrouterModel('or:openai/gpt-5')).toBe(true);
    expect(isOpenrouterModel('gpt-5')).toBe(false);
  });
});

describe('scrubRequestForGemini', () => {
  test('rewrites a document block to OpenAI image_url shape for 9router', () => {
    const body = j({
      model: 'gemini-3.1-pro-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } },
        ],
      }],
    });
    const out = parse(scrubRequestForGemini(body));
    const blocks = out.messages[0].content;
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('image_url');
    expect(blocks[1].image_url.url).toBe('data:application/pdf;base64,JVBERi0xLjQK');
  });

  test('also rewrites plain Anthropic image blocks to image_url', () => {
    const body = j({
      model: 'gemini-3-pro-preview',
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] }],
    });
    const out = parse(scrubRequestForGemini(body));
    const block = out.messages[0].content[0];
    expect(block.type).toBe('image_url');
    expect(block.image_url.url).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  test('is defensive on malformed blocks (missing data, wrong source.type) -- passes through untouched', () => {
    const body = j({
      model: 'gemini-3.1-pro-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'document' },
          { type: 'document', source: {} },
          { type: 'document', source: { type: 'url' } },
          { type: 'document', source: { type: 'base64' } },
        ],
      }],
    });
    const out = parse(scrubRequestForGemini(body));
    for (const b of out.messages[0].content) expect(b.type).toBe('document');
  });

  test('end to end on a tool schema: no Gemini-rejected key survives', () => {
    const FORBIDDEN = new Set(['$schema', '$ref', 'additionalProperties', 'title', 'default', '$comment', 'format', 'pattern', 'minLength', 'maxLength', 'anyOf', 'oneOf', 'allOf', 'const']);
    const body = j({
      model: 'gemini-3.1-pro-preview',
      tools: [{
        name: 'q',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          $schema: 'x',
          properties: {
            filter: { anyOf: [{ type: 'object', properties: { q: { type: 'string' } } }, { type: 'null' }] },
            size: { type: ['integer', 'null'], minimum: 1, default: 10 },
            url: { type: 'string', format: 'uri', $comment: 'c' },
          },
          required: ['filter'],
        },
      }],
    });
    const schema = parse(scrubRequestForGemini(body)).tools[0].input_schema;
    const seen = new Set<string>();
    const stack: unknown[] = [schema];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) stack.push(...n);
      else if (typeof n === 'object' && n !== null) {
        for (const k of Object.keys(n as Record<string, unknown>)) seen.add(k);
        stack.push(...Object.values(n as Record<string, unknown>));
      }
    }
    for (const k of FORBIDDEN) expect(seen.has(k)).toBe(false);
  });
});

describe('scrubRequestForOpenaiGpt5', () => {
  test('drops unsupported sampling knobs and renames max_tokens, passing the caller\'s budget through unfloored', () => {
    const dirty = j({
      model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 200, temperature: 0, top_p: 0.9,
      frequency_penalty: 0.5, presence_penalty: 0.1, logprobs: true,
    });
    const out = parse(scrubRequestForOpenaiGpt5(dirty));
    expect(out.max_tokens).toBeUndefined();
    for (const k of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logprobs']) {
      expect(out[k]).toBeUndefined();
    }
    // The proxy lane is intentionally NOT floored (see openaiPassthrough.ts for the lane that is).
    expect(out.max_completion_tokens).toBe(200);
  });

  test('reasoning_effort is dropped only when tools are present in the same request', () => {
    const combo = j({ model: 'gpt-5.4-mini', messages: [], max_tokens: 200, reasoning_effort: 'low', tools: [{ type: 'function', function: { name: 't' } }] });
    const solo = j({ model: 'gpt-5.4-mini', messages: [], max_tokens: 200, reasoning_effort: 'low' });
    const outCombo = parse(scrubRequestForOpenaiGpt5(combo));
    expect(outCombo.reasoning_effort).toBeUndefined();
    expect(outCombo.tools).toBeTruthy();
    expect(parse(scrubRequestForOpenaiGpt5(solo)).reasoning_effort).toBe('low');
  });

  test('rewrites an image block to image_url and still renames max_tokens', () => {
    const body = j({
      model: 'gpt-5.5', max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'text', text: "what's in this image?" },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      ] }],
    });
    const out = parse(scrubRequestForOpenaiGpt5(body));
    const blocks = out.messages[0].content;
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('image_url');
    expect(blocks[1].image_url.url).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(out.max_completion_tokens).toBe(500);
    expect(out.max_tokens).toBeUndefined();
  });

  test('a pure-text turn only gets the max_tokens rename', () => {
    const body = j({ model: 'gpt-5.5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
    const out = parse(scrubRequestForOpenaiGpt5(body));
    expect(out.messages[0].content).toBe('hi');
    expect(out.max_completion_tokens).toBe(100);
  });

  test('malformed document blocks pass through untouched (upstream should error, not us silently dropping the file)', () => {
    const body = j({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: [
        { type: 'document' },
        { type: 'document', source: { type: 'url' } },
        { type: 'document', source: { type: 'base64' } },
      ] }],
    });
    const out = parse(scrubRequestForOpenaiGpt5(body));
    for (const b of out.messages[0].content) expect(b.type).toBe('document');
  });

  test('is a byte-identical no-op on an empty body', () => {
    const empty = Buffer.alloc(0);
    expect(scrubRequestForOpenaiGpt5(empty)).toBe(empty);
  });

  test('non-JSON body passes through unchanged rather than throwing', () => {
    const body = Buffer.from('not json', 'utf8');
    expect(scrubRequestForOpenaiGpt5(body)).toBe(body);
  });
});

describe('injectOpenrouterFileParser', () => {
  test('injects the plugin, exact shape, when a document block is present', () => {
    const body = j({
      model: 'openrouter/qwen/qwen-2.5-72b-instruct',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'summarize' },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } },
      ] }],
    });
    const out = parse(injectOpenrouterFileParser(body));
    const fp = out.plugins.find((p: any) => p.id === 'file-parser');
    expect(fp).toBeTruthy();
    expect(Object.keys(fp).sort()).toEqual(['id', 'pdf']);
    expect(fp.pdf.engine).toBe('pdf-text');
  });

  test('skips injection when no document block is present', () => {
    const body = j({ model: 'openrouter/qwen/qwen-2.5-72b-instruct', messages: [{ role: 'user', content: 'just a question' }] });
    const out = parse(injectOpenrouterFileParser(body));
    expect(out.plugins).toBeUndefined();
  });

  test('does not duplicate an already-present file-parser plugin, caller\'s engine wins', () => {
    const body = j({
      model: 'openrouter/qwen/qwen-2.5-72b-instruct',
      plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' } }] }],
    });
    const out = parse(injectOpenrouterFileParser(body));
    const fps = out.plugins.filter((p: any) => p.id === 'file-parser');
    expect(fps).toHaveLength(1);
    expect(fps[0].pdf.engine).toBe('mistral-ocr');
  });
});
