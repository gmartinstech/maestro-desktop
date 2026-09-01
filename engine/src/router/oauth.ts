// engine/src/router/oauth.ts -- ENG-6, a faithful TypeScript port of
// backend/apps/nine_router/oauth.py: 9Router OAuth flow (start/poll/exchange) plus the Codex 1455
// callback listener. Talks to the already-running 9Router over HTTP; never spawns the subprocess
// (that's process.ts's job).
//
// NOT in scope here: WHO ultimately owns this loopback callback listener long-term is ENG-5's
// question ("move loopback off 9Router"), explicitly out of scope for ENG-6. This file is a
// mechanical translation of oauth.py as it stands today, including its own in-memory
// pending-OAuth-state bookkeeping (backend/apps/oauth_state.py has no engine-side port yet --
// that state store's own ownership is tied up in the same ENG-5 question), so ENG-5 has a
// like-for-like starting point rather than nothing. One deliberate implementation adaptation:
// Python hand-rolls the HTTP request line/header parsing over a raw asyncio.start_server socket;
// this port uses Node's built-in http module for the same single-endpoint responder, which is the
// idiomatic Node equivalent of "answer one GET path, 404 everything else" and changes no
// observable behavior.

import { createServer, type Server } from 'node:http';
import * as proc from './process';
// ENG-7: every fetch() below targets 9Router's own loopback port (proc.NINE_ROUTER_*) or the
// authorizeUrl built from it -- always-allowed by the provider-egress allowlist -- routed through
// engineFetch like every other outbound call in engine/src. The createServer import above is a
// SEPARATE, narrower exemption (see engine/eslint.config.mjs's oauth.ts override): it stands up
// this file's own local OAuth-callback LISTENER (an inbound socket accepting the browser's
// redirect), not an outbound call, so it's outside what the provider-egress policy governs at all.
import { engineFetch } from '../net/http';

// OpenAI's Codex OAuth client is registered with a fixed redirect URI `http://localhost:1455/auth/callback` and rejects any other with `unknown_error`. Anthropic and Google's clients accept arbitrary localhost callbacks (we use 9Router's 20128 callback page). For Codex we spawn a one-shot listener on 1455 that serves the same postMessage/BroadcastChannel/localStorage relay so the frontend's existing popup + msgHandler flow works unchanged.

// OpenAI's Codex OAuth client registers BOTH loopback redirect ports in its Hydra allow-list (1455 default, 1457 fallback) and the official Codex CLI falls back to 1457 for the "another app holds 1455" case (openai/codex PR #19334), so we try them in order and reject anything off the list.
export const CODEX_CALLBACK_PORTS = [1455, 1457] as const;
export const CODEX_CALLBACK_PORT = CODEX_CALLBACK_PORTS[0];
export const CODEX_CALLBACK_PATH = '/auth/callback';
export const CODEX_CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorization Complete</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#111;color:#eee;
text-align:center;padding:60px 20px;margin:0}h1{font-weight:600;margin:0 0 12px}
p{color:#888;margin:0}</style></head><body>
<h1>Authorization Successful</h1>
<p>This window will close automatically...</p>
<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var data = {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
    fullUrl: window.location.href
  };
  if (window.opener) {
    try { window.opener.postMessage({ type: 'oauth_callback', data: data }, '*'); }
    catch (e) { console.log('postMessage failed:', e); }
  }
  try { var ch = new BroadcastChannel('oauth_callback'); ch.postMessage(data); ch.close(); }
  catch (e) {}
  try { localStorage.setItem('oauth_callback', JSON.stringify(Object.assign({}, data, { timestamp: Date.now() }))); }
  catch (e) {}
  setTimeout(function() { try { window.close(); } catch (e) {} }, 1500);
})();
</script>
</body></html>`;

interface PendingOauthEntry {
  provider: string;
  codeVerifier: string;
  redirectUri: string;
}

// In-memory store for pending OAuth flows, mirroring backend/apps/oauth_state.py's shape (see
// this file's header for why it isn't imported from a shared module yet).
const pendingOauth = new Map<string, PendingOauthEntry>();
const completedOauth: string[] = [];
const MAX_COMPLETED_OAUTH = 64;

function markOauthCompleted(state: string): void {
  if (completedOauth.includes(state)) return;
  completedOauth.push(state);
  while (completedOauth.length > MAX_COMPLETED_OAUTH) completedOauth.shift();
}

// Tracks the live Codex callback listener so a fresh connect can reclaim a port from a still-bound prior attempt instead of failing to bind and leaving OpenAI's redirect unanswered.
let codexListenerServer: Server | null = null;

/** Spawn a one-shot HTTP listener on the first free Codex callback port and return it.
 *
 * Tries each of CODEX_CALLBACK_PORTS (1455 then 1457, both on OpenAI's allow-list) and binds the
 * first that's free, returning the bound port so the caller builds the matching redirect_uri.
 * Serves GET /auth/callback with CODEX_CALLBACK_HTML. After serving the callback (or after
 * `timeoutMs` with no callback) the listener closes itself. Returns null only when EVERY
 * allow-listed port is held by another app.
 *
 * Also performs the OAuth exchange server-side before serving the HTML. Relying on the frontend's
 * postMessage path alone breaks on Windows where COOP / popup-opener quirks silently drop the
 * message, leaving the user stuck on "Connecting..." until the timeout fires. Exchanging here
 * makes the connection land in 9Router's DB regardless of whether the UI's postMessage listener
 * ever gets notified; the Settings / OnboardingModal status pollers then pick it up within a
 * couple seconds. */
export async function startCodexCallbackListener(timeoutMs = 300_000): Promise<number | null> {
  // A new connect supersedes any abandoned one: close our own still-bound prior listener first so this attempt can take the port instead of colliding.
  if (codexListenerServer !== null) {
    await new Promise<void>((resolveClose) => codexListenerServer!.close(() => resolveClose()));
    codexListenerServer = null;
  }

  const served = new Promise<void>((resolveServed) => {
    (startCodexCallbackListener as unknown as { _resolveServed?: () => void })._resolveServed = resolveServed;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);
    if (req.method === 'GET' && url.pathname.startsWith(CODEX_CALLBACK_PATH)) {
      void (async () => {
        // Parse code/state out of the query string and exchange server-side before serving the HTML. Duplicate exchanges are harmless (single-use auth codes fail the second call, which we swallow) so racing with the frontend's msgHandler-driven exchange is fine.
        try {
          const code = url.searchParams.get('code') ?? '';
          const state = url.searchParams.get('state') ?? '';
          if (code && state) {
            const pending = pendingOauth.get(state);
            if (pending) {
              pendingOauth.delete(state);
              try {
                await exchangeOauth(pending.provider, code, pending.redirectUri, pending.codeVerifier, state);
                markOauthCompleted(state);
                console.info(`Codex callback: server-side exchange succeeded for state ${state.slice(0, 8)}...`);
              } catch (e) {
                // Put the pending entry back so the frontend's msgHandler retry via /agents/subscriptions/exchange still has a shot. Safe because we only popped it a moment ago.
                pendingOauth.set(state, pending);
                console.debug(`Codex callback: server-side exchange failed (${e}); leaving for frontend retry`);
              }
            }
          }
        } catch (e) {
          console.debug(`Codex callback listener pre-exchange error: ${e}`);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
        res.end(CODEX_CALLBACK_HTML);
        const resolveServed = (startCodexCallbackListener as unknown as { _resolveServed?: () => void })._resolveServed;
        resolveServed?.();
      })();
    } else {
      res.writeHead(404, { 'Content-Length': '0', Connection: 'close' });
      res.end();
    }
  });

  let boundPort: number | null = null;
  for (const port of CODEX_CALLBACK_PORTS) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, '127.0.0.1', () => resolveListen());
      });
      boundPort = port;
      break;
    } catch {
      continue;
    }
  }
  if (boundPort === null) {
    // Every allow-listed port is held by another app; OpenAI accepts only these two redirect ports so we can't pick a third, bail and let the UI tell the user.
    const ports = CODEX_CALLBACK_PORTS.join('/');
    console.warn(
      `Could not start Codex callback listener: ports ${ports} are all in use by another app (Codex CLI / ChatGPT extension). Close it and retry.`,
    );
    return null;
  }
  codexListenerServer = server;

  void (async () => {
    try {
      await Promise.race([served, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
      // Give the served HTML a moment to run its JS (postMessage + window.close) before we close the socket.
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      if (codexListenerServer === server) codexListenerServer = null;
    }
  })();

  console.info(`Started Codex callback listener on http://localhost:${boundPort}${CODEX_CALLBACK_PATH}`);
  return boundPort;
}

// Providers whose OAuth flow MUST run in the user's real browser via shell.openExternal, not the in-Electron window.open popup: - gemini-cli, antigravity: Google's Embedded WebView Restrictions policy uses JS-fingerprint detection that no UA spoof defeats. RFC 8252 and Google's own Desktop-app OAuth guidance both prescribe the system browser. - codex: auth.openai.com renders blank in our popup on some machines (newer embed detection + regional checks); system browser surfaces the real error. - claude: email magic-link opens in the user's default browser, which is a different cookie jar from the embedded popup, so the popup can never receive the auth. Forcing the OAuth flow into the system browser keeps everything in one cookie jar.
export const EXTERNAL_BROWSER_PROVIDERS = new Set(['gemini-cli', 'antigravity', 'codex', 'claude']);

export function shouldUseExternalBrowser(provider: string): boolean {
  return EXTERNAL_BROWSER_PROVIDERS.has(provider);
}

/** Best-effort lookup of the Maestro backend/engine HTTP port. Falls back to 8324 (the default in
 * backend/main.py / engine/src/main.ts) if MAESTRO_PORT hasn't been set yet. */
export function backendPort(): number {
  const parsed = Number(process.env.MAESTRO_PORT ?? '8324');
  return Number.isFinite(parsed) ? parsed : 8324;
}

/** Return the redirect URI to pass to 9Router's authorize endpoint. */
export function callbackUriForProvider(provider: string): string {
  if (provider === 'codex') return `http://localhost:${CODEX_CALLBACK_PORT}${CODEX_CALLBACK_PATH}`;
  // Anthropic's OAuth client only whitelists localhost:20128/callback; 9router_gpt5_patch.js 302-rewrites the hit to the backend handler.
  if (provider === 'claude') return `http://localhost:${proc.NINE_ROUTER_PORT}/callback`;
  if (EXTERNAL_BROWSER_PROVIDERS.has(provider)) return `http://localhost:${backendPort()}/api/subscriptions/callback`;
  return `http://localhost:${proc.NINE_ROUTER_PORT}/callback`;
}

export interface DeviceCodeFlow {
  flow: 'device_code';
  user_code: string;
  verification_uri: string;
  device_code: string;
  code_verifier: string;
  extra_data: Record<string, unknown>;
}

export interface AuthorizationCodeFlow {
  flow: 'authorization_code';
  auth_url: string;
  code_verifier: string;
  state: string;
  redirect_uri: string;
  use_external_browser: boolean;
}

/** Start OAuth flow for a provider.
 *
 * For device_code providers (github, qwen, kiro): returns {user_code, verification_uri, device_code}
 * For authorization_code providers (claude, codex, gemini-cli): returns {authUrl, codeVerifier, state} */
export async function startOauth(provider: string): Promise<DeviceCodeFlow | AuthorizationCodeFlow> {
  const headers = await proc.cliAuthHeaders();
  try {
    const res = await engineFetch(`${proc.NINE_ROUTER_API}/oauth/${provider}/device-code`, { headers });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return {
        flow: 'device_code',
        user_code: (data.user_code as string) ?? '',
        verification_uri: (data.verification_uri as string) ?? (data.verification_uri_complete as string) ?? '',
        device_code: (data.device_code as string) ?? '',
        code_verifier: (data.codeVerifier as string) ?? '',
        extra_data: Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith('_'))),
      };
    }
  } catch {
    // fall through to the authorization_code flow below
  }

  let callbackUrl = callbackUriForProvider(provider);
  if (provider === 'codex') {
    // Codex's redirect must be an OpenAI allow-listed loopback port; bind the first free one (1455 else 1457) and use ITS redirect_uri so authorize + token exchange agree.
    const boundPort = await startCodexCallbackListener();
    if (boundPort === null) {
      throw new Error(
        "Can't start the ChatGPT login: the Codex login ports (1455 and 1457) are both in use by another app (the Codex CLI or its VS Code extension). Quit that app, then try again.",
      );
    }
    callbackUrl = `http://localhost:${boundPort}${CODEX_CALLBACK_PATH}`;
  }

  const authorizeUrl = new URL(`${proc.NINE_ROUTER_API}/oauth/${provider}/authorize`);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  const res = await engineFetch(authorizeUrl, { headers });
  if (!res.ok) throw new Error(`9Router oauth authorize failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    flow: 'authorization_code',
    auth_url: (data.authUrl as string) ?? '',
    code_verifier: (data.codeVerifier as string) ?? '',
    state: (data.state as string) ?? '',
    redirect_uri: callbackUrl,
    use_external_browser: shouldUseExternalBrowser(provider),
  };
}

/** Poll for OAuth completion. Returns: {success: true, connection: {...}} or {success: false, pending: true} */
export async function pollOauth(provider: string, deviceCode: string, codeVerifier?: string, extraData?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { deviceCode };
  if (codeVerifier) body.codeVerifier = codeVerifier;
  if (extraData) body.extraData = extraData;
  const headers = { ...(await proc.cliAuthHeaders()), 'Content-Type': 'application/json' };
  const res = await engineFetch(`${proc.NINE_ROUTER_API}/oauth/${provider}/poll`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`9Router oauth poll failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Exchange OAuth code for tokens via 9Router. */
export async function exchangeOauth(provider: string, code: string, redirectUri: string, codeVerifier: string, state = ''): Promise<Record<string, unknown>> {
  const headers = { ...(await proc.cliAuthHeaders()), 'Content-Type': 'application/json' };
  const res = await engineFetch(`${proc.NINE_ROUTER_API}/oauth/${provider}/exchange`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, redirectUri, codeVerifier, state }),
  });
  if (!res.ok) throw new Error(`9Router oauth exchange failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export interface RouterModel {
  value: string;
  label: string;
  context_window: number;
  provider: string;
}

/** Get all available models from 9Router. */
export async function getModels(): Promise<RouterModel[]> {
  try {
    const res = await engineFetch(`${proc.NINE_ROUTER_V1}/models`);
    if (res.ok) {
      const data = (await res.json()) as { data?: Record<string, unknown>[] };
      return (data.data ?? []).map((m) => {
        const id = (m.id as string) ?? '';
        return {
          value: id,
          label: id.includes('/') ? id.split('/').pop()! : id,
          context_window: 200_000,
          provider: (m.owned_by as string) ?? 'subscription',
        };
      });
    }
  } catch (e) {
    console.debug(`9Router models fetch failed: ${e}`);
  }
  return [];
}
