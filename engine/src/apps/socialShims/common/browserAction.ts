// engine/src/apps/socialShims/common/browserAction.ts -- SUB-9, a full port of
// backend/apps/social_shims/browser_action.py.
//
// Delegate a write to the user's own live browser card via the engine's action bridge
// (`/api/browser-session/action`). For sites that sign every request (TikTok, X), a shim can't POST
// writes over HTTP without tripping anti-bot. Instead it asks the backend to drive the user's
// already-open, logged-in card: navigate it to the target URL, then run a small click/type script.
// Same trust posture as the cookie bridge (auth token + domain allowlist + only a card the user
// already has open).
//
// Scope note (documented, not silently dropped): BRW-6's own ledger row names `/api/browser-session/
// action` as "still falls through to the old [Python/Electron] proxy path even under cdp mode -- a
// documented gap for whoever picks up that surface later." This module is a pure HTTP client of that
// one fixed URL, same as sessionSource.ts is for `/cookies` -- it needs no changes and gets no
// benefit from a native `/action` handler existing or not; whichever process answers that path
// today (always Python's existing implementation, proxied through under every browser-engine mode)
// is exactly who answered it before this port. Building the CDP-native equivalent of that bridge is
// out of SUB-9's own scope, per the ticket's own text and BRW-6's row.

import { requestJson } from './httpJson';

export class BrowserActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserActionError';
  }
}

export interface BrowserActionStep {
  op: 'navigate' | 'wait' | 'evaluate';
  url?: string;
  ms?: number;
  expression?: string;
}

function actionUrl(): string {
  const port = process.env.MAESTRO_PORT || '8324';
  return `http://127.0.0.1:${port}/api/browser-session/action`;
}

/** Run a navigate/evaluate/wait step sequence against the user's live <domain> card. */
export async function perform(domain: string, steps: readonly BrowserActionStep[]): Promise<Record<string, unknown>> {
  const authToken = process.env.MAESTRO_AUTH_TOKEN || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let result;
  try {
    result = await requestJson({
      method: 'POST',
      url: actionUrl(),
      headers,
      body: JSON.stringify({ domain, steps }),
      timeoutMs: 45_000,
    });
  } catch (e) {
    throw new BrowserActionError(`Browser bridge unreachable: ${e instanceof Error ? e.message : String(e)}. Is the Maestro dashboard open?`);
  }
  if (result.status >= 400) {
    const bodyText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    throw new BrowserActionError(`Browser bridge HTTP ${result.status}: ${bodyText.slice(0, 200)}`);
  }
  const data = (typeof result.body === 'object' && result.body !== null ? result.body : {}) as Record<string, unknown>;
  if (data.error) throw new BrowserActionError(String(data.error));
  return data;
}

/** Pull the JSON the final evaluate step returned (the browser-action bridge wraps it in .text). */
export function lastJson(result: Record<string, unknown>): Record<string, unknown> {
  const results = Array.isArray(result.results) ? result.results : [];
  for (let i = results.length - 1; i >= 0; i--) {
    const r: unknown = results[i];
    if (r && typeof r === 'object' && 'text' in r && (r as { text?: unknown }).text) {
      const text = (r as { text: unknown }).text;
      try {
        return JSON.parse(String(text)) as Record<string, unknown>;
      } catch {
        return { raw: text };
      }
    }
  }
  return result;
}
