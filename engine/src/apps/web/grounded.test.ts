// engine/src/apps/web/grounded.test.ts -- SUB-8's vitest twin of web.py's LLM-grounded
// search/fetch helpers (p_gemini_grounded_call, p_openai_websearch, the 9Router-subscription
// variants, and both formatters).

import { describe, expect, test, vi } from 'vitest';
import * as storeModule from '../../settings/store';
import * as nineRouterModule from './nineRouter';
import {
  formatGroundedAsFetch,
  formatGroundedAsSearchResults,
  geminiGroundedCall,
  geminiGroundedVia9Router,
  openaiUrlfetch,
  openaiWebsearch,
  openaiWebsearchVia9Router,
  resolveGeminiApiKey,
  resolveOpenaiApiKey,
} from './grounded';

describe('resolveGeminiApiKey / resolveOpenaiApiKey', () => {
  test('reads the configured keys from settings', () => {
    vi.spyOn(storeModule, 'loadSettings').mockReturnValue({
      settings: { google_api_key: 'gk', openai_api_key: 'ok' } as never,
      droppedFields: [],
    });
    expect(resolveGeminiApiKey()).toBe('gk');
    expect(resolveOpenaiApiKey()).toBe('ok');
    vi.restoreAllMocks();
  });

  test('returns null when unset or on any error', () => {
    vi.spyOn(storeModule, 'loadSettings').mockReturnValue({ settings: {} as never, droppedFields: [] });
    expect(resolveGeminiApiKey()).toBeNull();
    vi.spyOn(storeModule, 'loadSettings').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(resolveOpenaiApiKey()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('geminiGroundedCall', () => {
  test('passes the gemini-passthrough lane and parses candidates/grounding chunks', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'The answer.' }] },
              groundingMetadata: {
                groundingChunks: [{ web: { uri: 'https://a.example.com', title: 'A' } }],
                webSearchQueries: ['q'],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await geminiGroundedCall('key123', 'prompt text', false, fetchImpl as never);
    expect(result.text).toBe('The answer.');
    expect(result.chunks).toEqual([['A', 'https://a.example.com']]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({ method: 'POST' }),
      { passthroughLane: 'gemini-passthrough' },
    );
  });

  test('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(geminiGroundedCall('k', 'p', false, fetchImpl as never)).rejects.toThrow();
  });
});

describe('openaiWebsearch / openaiUrlfetch', () => {
  test('parses output_text + url_citation annotations, uses the openai-passthrough lane', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: 'output_text', text: 'Summary text.' },
                { type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://b.example.com', title: 'B' }] },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await openaiWebsearch('sk-test', 'my query', fetchImpl as never);
    expect(result.text).toBe('Summary text.');
    expect(result.chunks).toEqual([['B', 'https://b.example.com']]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('api.openai.com'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }) }),
      { passthroughLane: 'openai-passthrough' },
    );
  });

  test('openaiUrlfetch focuses the prompt when given a hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [] }), { status: 200 }));
    await openaiUrlfetch('sk-test', 'https://x.example.com', 'pricing details', fetchImpl as never);
    const sentBody = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(sentBody.input).toContain('https://x.example.com');
    expect(sentBody.input).toContain('pricing details');
  });
});

describe('9Router-subscription grounded calls', () => {
  test('geminiGroundedVia9Router prefers gemini-cli, returns empty when neither is connected', async () => {
    vi.spyOn(nineRouterModule, 'refresh9rConnected').mockResolvedValue(new Set());
    const result = await geminiGroundedVia9Router('prompt', false);
    expect(result).toEqual({ text: '', chunks: [] });
    vi.restoreAllMocks();
  });

  test('geminiGroundedVia9Router calls 9Router with the gemini-cli model when connected', async () => {
    vi.spyOn(nineRouterModule, 'refresh9rConnected').mockResolvedValue(new Set(['gemini-cli']));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'grounded answer' }] }), { status: 200 }),
    );
    const result = await geminiGroundedVia9Router('prompt', false, fetchImpl as never);
    expect(result.text).toBe('grounded answer');
    const sentBody = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(sentBody.model).toBe('gc/gemini-2.5-flash');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:20128/v1/messages');
    vi.restoreAllMocks();
  });

  test('openaiWebsearchVia9Router returns empty when codex is not connected', async () => {
    vi.spyOn(nineRouterModule, 'refresh9rConnected').mockResolvedValue(new Set(['gemini-cli']));
    const result = await openaiWebsearchVia9Router('query');
    expect(result).toEqual({ text: '', chunks: [] });
    vi.restoreAllMocks();
  });

  test('openaiWebsearchVia9Router calls 9Router with the codex model when connected', async () => {
    vi.spyOn(nineRouterModule, 'refresh9rConnected').mockResolvedValue(new Set(['codex']));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'codex answer' }] }), { status: 200 }),
    );
    const result = await openaiWebsearchVia9Router('query', fetchImpl as never);
    expect(result.text).toBe('codex answer');
    const sentBody = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(sentBody.model).toBe('cx/gpt-5.4-mini');
    vi.restoreAllMocks();
  });
});

describe('formatters', () => {
  test('formatGroundedAsSearchResults numbers chunks and appends the grounded text', () => {
    const out = formatGroundedAsSearchResults({ text: 'Summary.', chunks: [['Title', 'https://x.example.com']] }, 'q');
    // Mirrors web.py's own p_format_grounded_as_search_results exactly, including its "\n" +
    // text then "\n\n".join(...) quirk that leaves a blank line before the grounded text.
    expect(out).toBe('[1] Title\n    https://x.example.com\n\n\nSummary.');
  });

  test('formatGroundedAsSearchResults reports no-results when both text and chunks are empty', () => {
    expect(formatGroundedAsSearchResults({ text: '', chunks: [] }, 'my query')).toBe('No search results found for: my query');
  });

  test('formatGroundedAsFetch includes a cited-sources section', () => {
    const out = formatGroundedAsFetch({ text: 'Page summary.', chunks: [['Src', 'https://s.example.com']] }, 'https://x.example.com');
    expect(out).toContain('Contents of https://x.example.com:');
    expect(out).toContain('Page summary.');
    expect(out).toContain('[1] Src; https://s.example.com');
  });
});
