// engine/src/apps/web/grounded.ts -- SUB-8's port of backend/apps/web/web.py's LLM-grounded
// search/fetch tiers: Gemini's googleSearch/urlContext grounding and OpenAI's web_search_preview,
// each reachable two ways -- with the user's own AI-Studio/OpenAI API key (native), or through the
// user's existing 9Router subscription (Gemini CLI / Antigravity / Codex) so no separate key is
// needed. Also carries the settings-key resolvers and the two result formatters shared by both
// endpoints' cascades.

import { engineFetch } from '../../net/http';
import { loadSettings } from '../../settings/store';
import { refresh9rConnected } from './nineRouter';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_GROUNDING_MODEL = 'gemini-2.5-flash'; // cheapest + fastest for grounded calls

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const OPENAI_SEARCH_MODEL = 'gpt-5-mini'; // cheapest model that supports web_search_preview

const NINE_ROUTER_MESSAGES_URL = 'http://localhost:20128/v1/messages';

export interface GroundedResult {
  text: string;
  chunks: Array<[title: string, uri: string]>;
  queries?: string[];
}

export function resolveGeminiApiKey(): string | null {
  try {
    return loadSettings().settings.google_api_key || null;
  } catch {
    return null;
  }
}

export function resolveOpenaiApiKey(): string | null {
  try {
    return loadSettings().settings.openai_api_key || null;
  } catch {
    return null;
  }
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; url?: string; title?: string } }>;
    webSearchQueries?: string[];
  };
}

/** Calls Gemini with googleSearch (+ optionally urlContext) grounding, using the user's own
 * AI-Studio key. Mirrors web.py's p_gemini_grounded_call(). */
export async function geminiGroundedCall(
  apiKey: string,
  prompt: string,
  useUrlContext: boolean,
  fetchImpl: typeof engineFetch = engineFetch,
): Promise<GroundedResult> {
  const tools: Array<Record<string, unknown>> = [{ googleSearch: {} }];
  if (useUrlContext) tools.push({ urlContext: {} });
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools,
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };
  const url = `${GEMINI_API_BASE}/models/${GEMINI_GROUNDING_MODEL}:generateContent`;
  const resp = await fetchImpl(
    url,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { passthroughLane: 'gemini-passthrough' },
  );
  if (!resp.ok) throw new Error(`Gemini grounded call HTTP ${resp.status}`);
  const data = (await resp.json()) as { candidates?: GeminiCandidate[] };
  const cand = (data.candidates ?? [])[0] ?? {};
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const gm = cand.groundingMetadata ?? {};
  const chunks: Array<[string, string]> = [];
  for (const gc of gm.groundingChunks ?? []) {
    const web = gc?.web ?? {};
    const uri = web.uri || web.url || '';
    const title = web.title || uri;
    if (uri) chunks.push([title, uri]);
  }
  return { text, chunks, queries: gm.webSearchQueries ?? [] };
}

/** Formats Gemini grounding output to match WebSearchTool's text shape. Mirrors
 * p_format_grounded_as_search_results(). */
export function formatGroundedAsSearchResults(grounded: GroundedResult, query: string): string {
  const lines: string[] = [];
  for (const [i, [title, uri]] of grounded.chunks.slice(0, 10).entries()) {
    lines.push(`[${i + 1}] ${title}\n    ${uri}`);
  }
  if (grounded.text) lines.push(`\n${grounded.text}`);
  if (lines.length === 0) return `No search results found for: ${query}`;
  return lines.join('\n\n');
}

/** Formats Gemini urlContext output to match WebFetchTool's text shape. Mirrors
 * p_format_grounded_as_fetch(). */
export function formatGroundedAsFetch(grounded: GroundedResult, url: string): string {
  const parts = [`Contents of ${url}:`, ''];
  if (grounded.text) parts.push(grounded.text);
  if (grounded.chunks.length > 0) {
    parts.push('\nCited sources:');
    for (const [i, [title, uri]] of grounded.chunks.slice(0, 5).entries()) {
      parts.push(`  [${i + 1}] ${title}; ${uri}`);
    }
  }
  return parts.join('\n');
}

interface NineRouterMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

async function nineRouterMessages(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof engineFetch,
): Promise<GroundedResult> {
  const body = { model, max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
  const resp = await fetchImpl(NINE_ROUTER_MESSAGES_URL, {
    method: 'POST',
    headers: { 'x-api-key': '9router', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (resp.status !== 200) return { text: '', chunks: [] };
  const data = (await resp.json()) as NineRouterMessageResponse;
  let text = '';
  for (const block of data.content ?? []) {
    if (block && block.type === 'text') text += block.text ?? '';
  }
  // 9Router doesn't surface citations as a structured field uniformly across providers, so this
  // hands back text-only and lets the formatter do its thing -- same as the Python original.
  return { text, chunks: [] };
}

/** Calls 9Router's /v1/messages endpoint with a Gemini model so the user's OAuth subscription
 * (Gemini CLI or Antigravity) covers the search/fetch call instead of needing a separate AI Studio
 * key. Mirrors p_gemini_grounded_via_9router(). Returns {} (falsy text) when neither is connected. */
export async function geminiGroundedVia9Router(
  prompt: string,
  useUrlContext: boolean,
  fetchImpl: typeof engineFetch = engineFetch,
): Promise<GroundedResult> {
  const connected = await refresh9rConnected();
  let model: string;
  if (connected.has('gemini-cli')) model = 'gc/gemini-2.5-flash';
  else if (connected.has('antigravity')) model = 'ag/gemini-3-flash';
  else return { text: '', chunks: [] };

  const sysPrompt = useUrlContext
    ? 'You fetch URLs and return concise summaries with citations.'
    : 'You search the web and return concise grounded answers with source citations. Always cite the URLs you used.';
  return nineRouterMessages(model, sysPrompt, prompt, fetchImpl);
}

/** Same idea, but for OpenAI's web_search_preview through Codex's 9Router connection. Mirrors
 * p_openai_websearch_via_9router(). */
export async function openaiWebsearchVia9Router(query: string, fetchImpl: typeof engineFetch = engineFetch): Promise<GroundedResult> {
  const connected = await refresh9rConnected();
  if (!connected.has('codex')) return { text: '', chunks: [] };
  const sysPrompt = 'You search the web and return concise grounded answers with source citations. Always cite the URLs you used.';
  return nineRouterMessages('cx/gpt-5.4-mini', sysPrompt, `Search the web for: ${query}`, fetchImpl);
}

interface OpenaiOutputContent {
  type?: string;
  text?: string;
  annotations?: Array<{ type?: string; url?: string; title?: string }>;
}
interface OpenaiOutputItem {
  content?: OpenaiOutputContent[];
}
interface OpenaiResponsesBody {
  output?: OpenaiOutputItem[];
}

function parseOpenaiResponses(data: OpenaiResponsesBody, queries: string[]): GroundedResult {
  const textParts: string[] = [];
  const chunks: Array<[string, string]> = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text') textParts.push(content.text ?? '');
      for (const ann of content.annotations ?? []) {
        if (ann.type === 'url_citation' && ann.url) {
          chunks.push([ann.title || ann.url, ann.url]);
        }
      }
    }
  }
  return { text: textParts.join(''), chunks, queries };
}

/** Calls OpenAI Responses API with the web_search_preview tool, using the user's own key. Mirrors
 * p_openai_websearch(). */
export async function openaiWebsearch(apiKey: string, query: string, fetchImpl: typeof engineFetch = engineFetch): Promise<GroundedResult> {
  const body = {
    model: OPENAI_SEARCH_MODEL,
    input: `Search the web for: ${query}\n\nReturn a concise summary. Cite sources.`,
    tools: [{ type: 'web_search_preview' }],
  };
  const resp = await fetchImpl(
    `${OPENAI_API_BASE}/responses`,
    { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { passthroughLane: 'openai-passthrough' },
  );
  if (!resp.ok) throw new Error(`OpenAI websearch HTTP ${resp.status}`);
  const data = (await resp.json()) as OpenaiResponsesBody;
  return parseOpenaiResponses(data, [query]);
}

/** Uses OpenAI's web_search_preview to fetch/summarize a specific URL, using the user's own key.
 * Mirrors p_openai_urlfetch(). */
export async function openaiUrlfetch(
  apiKey: string,
  url: string,
  prompt: string | null,
  fetchImpl: typeof engineFetch = engineFetch,
): Promise<GroundedResult> {
  let promptText = `Fetch and summarize the content at: ${url}`;
  if (prompt) promptText += `\n\nFocus on: ${prompt}`;
  const body = { model: OPENAI_SEARCH_MODEL, input: promptText, tools: [{ type: 'web_search_preview' }] };
  const resp = await fetchImpl(
    `${OPENAI_API_BASE}/responses`,
    { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { passthroughLane: 'openai-passthrough' },
  );
  if (!resp.ok) throw new Error(`OpenAI urlfetch HTTP ${resp.status}`);
  const data = (await resp.json()) as OpenaiResponsesBody;
  return parseOpenaiResponses(data, []);
}
