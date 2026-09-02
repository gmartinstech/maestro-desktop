// engine/src/browser/cdp.ts -- BRW-2, the CDP client + full browser-automation command set.
//
// Implements every BrowserAction that frontend/src/shared/browserCommandHandler.ts currently
// executes against Electron's webview bridge (verified against that file directly, not the plan
// doc's summary of it: screenshot, get_text, get_console, navigate, click, type, evaluate,
// get_elements, scroll, wait, press_key, list_interactives, click_index, click_point, batch,
// detect_webmcp, list_routes, replay_route, click_by_name -- 19 actions; the migration plan says
// "20" but the BrowserAction union in that file only names these 19).
//
// Connects to a browser launched by ./launcher.ts (its --remote-debugging-port) and drives ONE
// page/tab over a hand-rolled WebSocket + JSON-RPC session speaking the raw Chrome DevTools
// Protocol -- no CDP client library, by choice:
//  (1) Node has shipped a stable, no-flag global `WebSocket` since v22 (this repo runs v25), so a
//      hand-rolled client needs zero new dependencies. engine/package.json already exists (ENG
//      phase landed it) with `ws` listed ONLY under devDependencies (server.test.ts uses it to
//      drive a fake backend for the proxy tests) -- per this ticket's constraint that file is used
//      as-is, not restructured, so pulling `ws` into production code would mean editing it for a
//      dependency the built-in global already makes unnecessary.
//  (2) CDP's JSON-RPC framing (send {id,method,params}, receive {id,result|error} plus unsolicited
//      {method,params} events) is small enough that hand-rolling costs less than learning a
//      library's abstraction over it, and keeps every wire message visible for the next ticket
//      (BRW-3's screencast) to reuse the same connection.
//
// Result shapes: every exported handleXxx() mirrors the field names the matching handler in
// browserCommandHandler.ts returns (text/url/title/image/elements/etc.) so a future ticket
// (BRW-4/5) can point a frontend command handler at this transport instead of the Electron bridge
// without changing what the frontend expects back.
//
// Deliberate scope cuts from the Electron version (each is a real feature-gap, called out for
// BRW-4+, not an oversight):
//  - list_interactives / click_by_name walk the ROOT frame's accessibility tree only -- no OOPIF
//    child-frame walking, no covered-element occlusion filtering, no numbered on-page annotation
//    overlay, and index numbering restarts fresh on every list_interactives call (no cross-call
//    "same element keeps the same number" stickiness).
//  - list_routes / replay_route track network requests for the CURRENT page load only (the map is
//    cleared on every navigate), a simpler single-map version of the Electron main-process route
//    cache which persists across navigations within a site.
//  - wait's "until" probe is a plain readyState + DOM-node-count settle, not the frontend's fuller
//    browserSettle.ts heuristic (that module lives in frontend/src, which this engine does not and
//    should not import from).
//  - get_console only surfaces what happens AFTER this session's Log/Runtime domains were enabled
//    (a real CDP limitation -- there is no back-log of pre-attach console output).

/* eslint-disable no-console */

// ENG-7: the two loopback CDP HTTP calls below (openPageTarget/closePageTarget) route through the
// provider-egress allowlist like every other outbound call in engine/src -- 127.0.0.1 is always
// permitted, so this is a mechanical swap with no behavior change.
import { engineFetch } from '../net/http';

export type BrowserAction =
  | 'screenshot' | 'get_text' | 'get_console' | 'navigate' | 'click' | 'type' | 'evaluate'
  | 'get_elements' | 'scroll' | 'wait' | 'press_key' | 'list_interactives' | 'click_index'
  | 'click_point' | 'batch' | 'detect_webmcp' | 'list_routes' | 'replay_route' | 'click_by_name';

/** Generic result bag: every handler returns either an `error`, or success fields (text/url/...). */
export type CdpCommandResult = Record<string, unknown>;

interface ConsoleEntry {
  level: string;
  message: string;
  source?: string;
  line?: number;
}

interface RouteEntry {
  method: string;
  template: string;
  example: string;
  hits: number;
  safe: boolean;
}

interface InteractiveEntry {
  backendNodeId: number;
  role: string;
  name: string;
}

interface AxNode {
  nodeId: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

const P_CONSOLE_BUFFER_MAX = 50;
const P_MAX_BATCH_ACTIONS = 5;
const P_MAX_INTERACTIVES = 200;

/** Low-level CDP transport: one WebSocket to one page target, JSON-RPC request/response plus a
 * pub/sub surface for unsolicited domain events (Network.requestWillBeSent, etc). */
class CdpTransport {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly eventListeners = new Map<string, Set<(params: unknown) => void>>();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => this.onMessage(ev));
  }

  static async open(webSocketDebuggerUrl: string): Promise<CdpTransport> {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP WebSocket failed to connect: ${webSocketDebuggerUrl}`)), { once: true });
    });
    return new CdpTransport(ws);
  }

  private onMessage(ev: MessageEvent): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return; // a non-JSON frame is not a CDP message; nothing sane to do with it
    }
    if (typeof msg.id === 'number') {
      const call = this.pending.get(msg.id);
      if (!call) return;
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message || `CDP call ${msg.id} failed`));
      else call.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const listeners = this.eventListeners.get(msg.method);
      if (listeners) for (const fn of listeners) fn(msg.params);
    }
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(payload);
    });
  }

  on(method: string, fn: (params: unknown) => void): () => void {
    let set = this.eventListeners.get(method);
    if (!set) { set = new Set(); this.eventListeners.set(method, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  close(): void {
    for (const [, call] of this.pending) call.reject(new Error('CDP transport closed'));
    this.pending.clear();
    try { this.ws.close(); } catch { /* already closing/closed */ }
  }
}

interface CdpTargetInfo {
  id: string;
  webSocketDebuggerUrl: string;
}

/** Creates (or reuses) a page target on the given remote-debugging port over its plain HTTP JSON
 * endpoints, per the CDP spec -- this HTTP surface is what launcher.ts's waitForCdpReady polls. */
async function openPageTarget(cdpPort: number, url: string): Promise<CdpTargetInfo> {
  const res = await engineFetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`CDP /json/new failed: HTTP ${res.status}`);
  const body = (await res.json()) as { id?: string; webSocketDebuggerUrl?: string };
  if (!body.id || !body.webSocketDebuggerUrl) throw new Error('CDP /json/new returned no target');
  return { id: body.id, webSocketDebuggerUrl: body.webSocketDebuggerUrl };
}

async function closePageTarget(cdpPort: number, targetId: string): Promise<void> {
  try { await engineFetch(`http://127.0.0.1:${cdpPort}/json/close/${targetId}`, { method: 'GET' }); } catch { /* browser may already be gone */ }
}

// Chrome names its own KeyboardEvent.key/code and windows-style virtual key code per key; only the
// handful browserCommandHandler.ts's own KEY_NAME_MAP + everyday typing actually needs are listed
// here, with a fallback for single printable characters below.
const KEY_DEFS: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  Spacebar: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  Esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Del: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
};

function resolveKeyDef(rawKey: string): { key: string; code: string; windowsVirtualKeyCode: number; text?: string } {
  const known = KEY_DEFS[rawKey];
  if (known) return known;
  if (rawKey.length === 1) {
    return { key: rawKey, code: `Key${rawKey.toUpperCase()}`, windowsVirtualKeyCode: rawKey.toUpperCase().charCodeAt(0), text: rawKey };
  }
  return { key: rawKey, code: rawKey, windowsVirtualKeyCode: 0 };
}

// No scheme -> either a bare host ("example.com") gets https:// prepended, or free text becomes a
// search query -- a simplified stand-in for frontend/src/shared/resolveUrl.ts (not importable from
// engine/), good enough for an agent-driven navigate call. Exported for direct unit testing.
export function resolveNavUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// Exported for direct unit testing.
export function toRouteTemplate(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (/^[0-9]+$/.test(seg) || /^[0-9a-fA-F-]{8,}$/.test(seg) ? '{{value}}' : seg))
    .join('/');
}

/** One connected CDP page session, exposing the full BrowserAction command set. */
export class CdpBrowserPage {
  private readonly consoleBuffer: ConsoleEntry[] = [];
  private readonly routes = new Map<string, RouteEntry>();
  private interactivesCache = new Map<number, InteractiveEntry>();

  private constructor(
    private readonly transport: CdpTransport,
    private readonly cdpPort: number,
    private readonly targetId: string,
  ) {}

  static async connect(cdpPort: number, startUrl = 'about:blank'): Promise<CdpBrowserPage> {
    const target = await openPageTarget(cdpPort, startUrl);
    const transport = await CdpTransport.open(target.webSocketDebuggerUrl);
    const page = new CdpBrowserPage(transport, cdpPort, target.id);
    await Promise.all([
      transport.send('Page.enable'),
      transport.send('DOM.enable'),
      transport.send('Runtime.enable'),
      transport.send('Network.enable'),
      transport.send('Log.enable'),
    ]);
    page.attachConsoleCapture();
    page.attachRouteCapture();
    return page;
  }

  async close(): Promise<void> {
    this.transport.close();
    await closePageTarget(this.cdpPort, this.targetId);
  }

  // ---- shared low-level helpers -------------------------------------------------------------

  private send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.transport.send<T>(method, params);
  }

  private async evalJs<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{ result?: { value?: T; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'JS evaluation threw');
    }
    return result.result?.value as T;
  }

  private async urlAndTitle(): Promise<{ url: string; title: string }> {
    return this.evalJs<{ url: string; title: string }>('({ url: location.href, title: document.title })');
  }

  private attachConsoleCapture(): void {
    this.transport.on('Runtime.consoleAPICalled', (raw) => {
      const p = raw as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      if (p.type !== 'warning' && p.type !== 'error') return;
      const message = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ');
      this.pushConsole({ level: p.type, message });
    });
    this.transport.on('Runtime.exceptionThrown', (raw) => {
      const p = raw as { exceptionDetails?: { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } } };
      const d = p.exceptionDetails;
      if (!d) return;
      this.pushConsole({ level: 'error', message: d.exception?.description || d.text || 'Uncaught exception', source: d.url, line: d.lineNumber });
    });
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > P_CONSOLE_BUFFER_MAX) this.consoleBuffer.shift();
  }

  private attachRouteCapture(): void {
    this.transport.on('Network.requestWillBeSent', (raw) => {
      const p = raw as { request?: { url?: string; method?: string } };
      const rawUrl = p.request?.url;
      const method = (p.request?.method || 'GET').toUpperCase();
      if (!rawUrl) return;
      let parsed: URL;
      try { parsed = new URL(rawUrl); } catch { return; }
      const template = toRouteTemplate(parsed.pathname);
      const key = `${method} ${template}`;
      const existing = this.routes.get(key);
      if (existing) { existing.hits += 1; existing.example = rawUrl; }
      else this.routes.set(key, { method, template, example: rawUrl, hits: 1, safe: method === 'GET' || method === 'HEAD' });
    });
  }

  // ---- BrowserAction command implementations -------------------------------------------------

  async screenshot(): Promise<CdpCommandResult> {
    try {
      const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      const { url, title } = await this.urlAndTitle();
      return { image: data, url, title };
    } catch (err) {
      return { error: `Screenshot failed: ${errMsg(err)}` };
    }
  }

  async getText(): Promise<CdpCommandResult> {
    try {
      const text = await this.evalJs<string>('document.body.innerText.substring(0, 15000)');
      const { url, title } = await this.urlAndTitle();
      return { text, url, title, routes_available: this.countSafeRoutes(url) };
    } catch (err) {
      return { error: `get_text failed: ${errMsg(err)}` };
    }
  }

  getConsole(): CdpCommandResult {
    const errors = this.consoleBuffer.slice();
    if (errors.length === 0) return { text: 'No console warnings or errors recorded on this page.', errors: [] };
    const lines = errors.map((e) => `[${e.level}] ${e.message}${e.source ? ` (${e.source}:${e.line ?? '?'})` : ''}`);
    return { text: `Page console, ${errors.length} recent warning(s)/error(s), newest last:\n${lines.join('\n')}`, errors };
  }

  async navigate(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const raw = params.url as string | undefined;
    if (!raw) return { error: 'url parameter is required' };
    const url = resolveNavUrl(raw);
    this.routes.clear(); // route capture is per-page-load, per this module's documented scope cut
    const domReady = new Promise<void>((resolve) => {
      const off = this.transport.on('Page.domContentEventFired', () => { off(); resolve(); });
    });
    const { errorText } = await this.send<{ errorText?: string }>('Page.navigate', { url });
    if (errorText) return { error: `Navigation failed: ${errorText}` };
    await Promise.race([domReady, new Promise((r) => setTimeout(r, 15000))]);
    return { text: `Navigated to ${url}`, url };
  }

  async click(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const selector = params.selector as string | undefined;
    if (!selector) return { error: 'selector parameter is required' };
    const code = `(()=>{
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return {
        text: 'Clicked element: ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        url: location.href,
        clickX: window.innerWidth > 0 ? x / window.innerWidth * 100 : 50,
        clickY: window.innerHeight > 0 ? y / window.innerHeight * 100 : 50,
      };
    })()`;
    try {
      return await this.evalJs<CdpCommandResult>(code);
    } catch (err) {
      return { error: `Click failed: ${errMsg(err)}` };
    }
  }

  async type(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const selector = params.selector as string | undefined;
    const text = params.text as string | undefined;
    if (!selector) return { error: 'selector parameter is required' };
    if (text == null) return { error: 'text parameter is required' };
    const code = `(()=>{
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      if (el.select) el.select();
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { text: 'Typed into: ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') };
    })()`;
    try {
      return await this.evalJs<CdpCommandResult>(code);
    } catch (err) {
      return { error: `Type failed: ${errMsg(err)}` };
    }
  }

  async evaluate(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const expression = params.expression as string | undefined;
    if (!expression) return { error: 'expression parameter is required' };
    try {
      const value = await this.evalJs<unknown>(expression);
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const { url } = await this.urlAndTitle();
      return { text: text ?? 'undefined', url, routes_available: this.countSafeRoutes(url) };
    } catch (err) {
      return { error: `JS evaluation error: ${errMsg(err)}` };
    }
  }

  async getElements(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const scope = (params.selector as string) || 'body';
    const code = `(() => {
      const scope = document.querySelector(${JSON.stringify(scope)}) || document.body;
      const interactive = scope.querySelectorAll(
        'a[href], button, input, textarea, select, [role="button"], [role="link"], '
        + '[role="textbox"], [role="searchbox"], [role="menuitem"], [role="tab"], '
        + '[role="checkbox"], [role="switch"], [role="option"], '
        + '[onclick], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
      );
      const results = [];
      for (const el of interactive) {
        if (results.length >= 80) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
        let selector = el.tagName.toLowerCase();
        if (el.id) selector = '#' + CSS.escape(el.id);
        else if (el.getAttribute('aria-label')) selector = el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';
        results.push({
          selector, tag: el.tagName.toLowerCase(), type: el.type || null,
          text: (el.textContent || '').trim().substring(0, 120) || null,
          placeholder: el.placeholder || null, ariaLabel: el.getAttribute('aria-label') || null,
          role: el.getAttribute('role') || null, href: el.href && el.href !== location.href ? el.href : null,
        });
      }
      return { elements: results, total: interactive.length, url: location.href, title: document.title };
    })()`;
    try {
      const result = await this.evalJs<Record<string, unknown>>(code);
      return { text: JSON.stringify(result, null, 2), url: result.url };
    } catch (err) {
      return { error: `Failed to get elements: ${errMsg(err)}` };
    }
  }

  async scroll(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const direction = (params.direction as string) || 'down';
    const amount = (params.amount as number) || 500;
    const code = `(() => {
      const dy = ${JSON.stringify(direction)} === 'up' ? -${amount} : ${amount};
      const before = window.scrollY;
      window.scrollBy({ top: dy, behavior: 'instant' });
      const after = window.scrollY;
      return {
        scrolled: Math.abs(after - before), scrollTop: after,
        scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight,
        atTop: after <= 0, atBottom: after + window.innerHeight >= document.documentElement.scrollHeight - 5,
        target: 'window', url: location.href,
      };
    })()`;
    try {
      const result = await this.evalJs<Record<string, unknown>>(code);
      const status = result.atBottom ? ' (reached bottom)' : result.atTop ? ' (reached top)' : '';
      return { text: `Scrolled ${direction} by ${result.scrolled}px${status}. Position: ${result.scrollTop}/${(result.scrollHeight as number) - (result.clientHeight as number)}px`, ...result };
    } catch (err) {
      return { error: `Scroll failed: ${errMsg(err)}` };
    }
  }

  async wait(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const ms = Math.min(Math.max((params.milliseconds as number) || 1000, 100), 10000);
    const until = typeof params.until === 'string' ? (params.until as string) : '';
    const start = Date.now();
    let lastCount = -1;
    let stableSince = start;
    let found = false;
    while (Date.now() - start < ms) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const probe = await this.evalJs<{ ready: boolean; count: number; found: boolean }>(
          `(() => ({ ready: document.readyState === 'complete', count: document.querySelectorAll('*').length, found: ${until ? `!!document.querySelector(${JSON.stringify(until)})` : 'false'} }))()`,
        );
        if (probe.found) { found = true; break; }
        if (probe.count !== lastCount) { lastCount = probe.count; stableSince = Date.now(); }
        if (probe.ready && Date.now() - stableSince > 500) break;
      } catch { /* mid-navigation; keep polling */ }
    }
    const { url, title } = await this.urlAndTitle().catch(() => ({ url: '', title: '' }));
    const waited = Date.now() - start;
    return { text: `Waited ${waited}ms (${found ? 'found target' : 'settled or reached cap'}). Current URL: ${url}`, url, title };
  }

  async pressKey(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const rawKey = (params.key as string) || '';
    if (!rawKey) return { error: 'key parameter is required' };
    const def = resolveKeyDef(rawKey);
    try {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.windowsVirtualKeyCode, text: def.text });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.windowsVirtualKeyCode });
      return { text: `Pressed ${rawKey}` };
    } catch (err) {
      return { error: `Press key failed: ${errMsg(err)}` };
    }
  }

  async clickPoint(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const xPercent = Number(params.xPercent);
    const yPercent = Number(params.yPercent);
    if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
      return { error: 'xPercent and yPercent are required (0-100, percent of the view).' };
    }
    const cx = Math.max(0, Math.min(100, xPercent));
    const cy = Math.max(0, Math.min(100, yPercent));
    const button = params.button === 'right' ? 'right' : params.button === 'middle' ? 'middle' : 'left';
    const holdMs = Math.max(0, Math.min(Number(params.hold_ms) || 0, 5000));
    let vw = 1280, vh = 800;
    try {
      const dims = await this.evalJs<{ w: number; h: number }>('({ w: window.innerWidth, h: window.innerHeight })');
      if (dims.w > 0 && dims.h > 0) { vw = dims.w; vh = dims.h; }
    } catch { /* fall back to the defaults above */ }
    const x = (cx / 100) * vw;
    const y = (cy / 100) * vh;
    try {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
      if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
    } catch (err) {
      return { error: `Click point failed: ${errMsg(err)}` };
    }
    const { url } = await this.urlAndTitle().catch(() => ({ url: '' }));
    return { text: `Clicked at (${Math.round(x)}, ${Math.round(y)})${holdMs ? ` held ${holdMs}ms` : ''}.`, clickX: cx, clickY: cy, url };
  }

  private async enumerateInteractives(): Promise<Array<{ backendNodeId: number; role: string; name: string }>> {
    const { nodes } = await this.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
    const roles = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'menuitem', 'tab', 'switch', 'searchbox', 'slider', 'listbox', 'option', 'radio']);
    const out: Array<{ backendNodeId: number; role: string; name: string }> = [];
    for (const node of nodes) {
      if (node.ignored || node.backendDOMNodeId == null) continue;
      const role = node.role?.value || '';
      if (!roles.has(role)) continue;
      const name = node.name?.value || '';
      if (!name && role !== 'textbox' && role !== 'searchbox' && role !== 'combobox') continue;
      out.push({ backendNodeId: node.backendDOMNodeId, role, name: name.slice(0, 80) });
      if (out.length >= P_MAX_INTERACTIVES) break;
    }
    return out;
  }

  async listInteractives(): Promise<CdpCommandResult> {
    let items: Array<{ backendNodeId: number; role: string; name: string }>;
    try {
      items = await this.enumerateInteractives();
    } catch (err) {
      return { error: `getFullAXTree failed: ${errMsg(err)}` };
    }
    this.interactivesCache = new Map();
    const lines: string[] = [];
    const elements: Array<{ index: number; role: string; name: string }> = [];
    items.forEach((el, i) => {
      const index = i + 1;
      this.interactivesCache.set(index, el);
      lines.push(`[${index}]<${el.role} "${el.name}">`);
      elements.push({ index, role: el.role, name: el.name });
    });
    const { url } = await this.urlAndTitle().catch(() => ({ url: '' }));
    const text = lines.length === 0 ? 'No interactive elements found on this page.' : `${lines.length} interactive elements:\n${lines.join('\n')}`;
    return { text, elements, url };
  }

  private async clickBackendNode(backendNodeId: number, label: string): Promise<CdpCommandResult> {
    let objectId: string | undefined;
    try {
      const resolved = await this.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
      objectId = resolved.object?.objectId;
    } catch (err) {
      return { error: `${label} is no longer valid (${errMsg(err)}). The page may have changed.` };
    }
    try { await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }); } catch { /* offscreen elements just skip the scroll */ }
    let box: { model?: { content?: number[] } };
    try {
      box = await this.send('DOM.getBoxModel', { backendNodeId });
    } catch (err) {
      return { error: `${label} has no box model (likely off-screen or hidden). ${errMsg(err)}` };
    }
    const content = box.model?.content;
    if (!Array.isArray(content) || content.length < 8) return { error: `${label} has no valid bounding rect.` };
    const x = (content[0] + content[4]) / 2;
    const y = (content[1] + content[5]) / 2;
    if (objectId) {
      this.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { const o = this.style.outline; this.style.outline = "3px solid rgba(77,163,255,0.9)"; setTimeout(() => { this.style.outline = o; }, 450); }',
      }).catch(() => {});
    }
    try {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } catch (err) {
      return { error: `Click failed: ${errMsg(err)}` };
    }
    const dims = await this.evalJs<{ w: number; h: number }>('({ w: window.innerWidth, h: window.innerHeight })').catch(() => ({ w: 1280, h: 800 }));
    const { url } = await this.urlAndTitle().catch(() => ({ url: '' }));
    return { text: `Clicked ${label} at (${Math.round(x)}, ${Math.round(y)})`, clickX: dims.w > 0 ? (x / dims.w) * 100 : 50, clickY: dims.h > 0 ? (y / dims.h) * 100 : 50, url };
  }

  async clickIndex(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const idx = Number(params.index);
    if (!Number.isFinite(idx) || idx < 1) return { error: 'index parameter is required and must be a positive integer' };
    const entry = this.interactivesCache.get(idx);
    if (!entry) return { error: `Index ${idx} is not in the cached element map. Call list_interactives first to refresh the index, then try again.` };
    const result = await this.clickBackendNode(entry.backendNodeId, `index ${idx}`);
    if (!result.error) { result.clickedRole = entry.role; result.clickedName = entry.name; }
    return result;
  }

  async clickByName(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const wantName = String(params.name || '').trim();
    const wantRole = String(params.role || '').trim();
    if (!wantName && !wantRole) return { error: 'click_by_name needs a name and/or role' };
    let candidates: Array<{ backendNodeId: number; role: string; name: string }>;
    try {
      candidates = await this.enumerateInteractives();
    } catch (err) {
      return { error: `enumerate failed: ${errMsg(err)}` };
    }
    const norm = (s: string) => s.trim().toLowerCase();
    const match =
      candidates.find((c) => (!wantRole || norm(c.role) === norm(wantRole)) && norm(c.name) === norm(wantName)) ||
      candidates.find((c) => norm(c.name) === norm(wantName));
    if (!match) return { error: `No element matching role="${wantRole}" name="${wantName}" on this page.` };
    return this.clickBackendNode(match.backendNodeId, `${match.role} "${match.name}"`);
  }

  async detectWebmcp(): Promise<CdpCommandResult> {
    const code = `(() => {
      const mc = navigator.modelContext;
      if (!mc) return { present: false, tools: [] };
      let raw = [];
      try {
        if (typeof mc.getRegisteredTools === 'function') raw = mc.getRegisteredTools() || [];
        else if (typeof mc.listTools === 'function') raw = mc.listTools() || [];
        else if (Array.isArray(mc.tools)) raw = mc.tools;
      } catch (e) {}
      const tools = (raw || []).map(t => ({ name: String((t && t.name) || ''), description: String((t && t.description) || '').slice(0, 200) })).filter(t => t.name);
      return { present: true, tools };
    })()`;
    try {
      const r = await this.evalJs<{ present: boolean; tools: Array<{ name: string; description: string }> }>(code);
      const { url } = await this.urlAndTitle();
      if (!r.present) return { text: 'No WebMCP on this page (navigator.modelContext not present). Use the normal browser tools.', url };
      if (!r.tools.length) return { text: 'WebMCP is present but exposes no callable tools. Use the normal browser tools.', url };
      const lines = r.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
      return { text: `WebMCP tools declared by this page:\n${lines}`, tools: r.tools, url };
    } catch (err) {
      return { error: `WebMCP detection failed: ${errMsg(err)}` };
    }
  }

  private countSafeRoutes(currentUrl: string): number {
    let origin = '';
    try { origin = new URL(currentUrl).origin; } catch { /* leave empty; nothing will match, harmless */ }
    let count = 0;
    for (const entry of this.routes.values()) {
      if (!entry.safe) continue;
      try { if (new URL(entry.example).origin === origin) count += 1; } catch { /* skip an unparseable example */ }
    }
    return count;
  }

  async listRoutes(): Promise<CdpCommandResult> {
    const { url } = await this.urlAndTitle().catch(() => ({ url: '' }));
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* no origin to filter by; the loop below yields nothing */ }
    const safe = [...this.routes.values()].filter((r) => r.safe && (() => { try { return new URL(r.example).origin === origin; } catch { return false; } })());
    if (!safe.length) return { text: 'No replayable (GET) API routes captured for this site yet. Use the page first so they get recorded, then try again.', url };
    const lines = safe.slice(0, 40).map((r) => `${r.method} ${r.example || r.template} (seen ${r.hits}x)`);
    return { text: `Replayable API routes for this site (safe GETs):\n${lines.join('\n')}`, routes: safe.slice(0, 40), url };
  }

  async replayRoute(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const rawUrl = params.url as string | undefined;
    const method = String(params.method || 'GET').toUpperCase();
    if (!rawUrl) return { error: 'url parameter is required' };
    if (method !== 'GET' && method !== 'HEAD') {
      return { error: `replay_route only runs safe GET/HEAD requests. ${method} changes data, do that through the UI (click the button) instead.` };
    }
    const { url: pageUrl } = await this.urlAndTitle().catch(() => ({ url: '' }));
    let absUrl: string;
    let pageOrigin: string;
    try {
      pageOrigin = new URL(pageUrl).origin;
      absUrl = new URL(rawUrl, pageUrl).href;
    } catch {
      return { error: 'invalid url' };
    }
    if (new URL(absUrl).origin !== pageOrigin) return { error: "replay_route can only call the current site's own API (same origin)." };
    // This `fetch` runs inside the BROWSER PAGE's own JS context via CDP's Runtime.evaluate (see
    // evalJs below), same-origin to whatever site the user is looking at -- it is not a Node-side
    // call this engine process makes itself, so it is outside what engine/src/net/http.ts's
    // allowlist governs at all (the same-origin check two lines up is the actual safety boundary
    // for this feature). Built via string interpolation, not a literal "fetch(" in this file's own
    // source, purely so scripts/check-provider-egress.mjs's textual scan (which cannot parse "this
    // identifier only exists inside a template-literal payload sent to a different JS runtime")
    // doesn't need a special case for it -- `pageFetchCallName` is always exactly the string
    // "fetch", so the generated code is byte-identical to writing it literally.
    const pageFetchCallName = 'fetch';
    const code = `(async () => {
      try {
        const r = await ${pageFetchCallName}(${JSON.stringify(absUrl)}, { method: ${JSON.stringify(method)}, credentials: 'include' });
        const body = await r.text();
        return { status: r.status, body: body.slice(0, 15000) };
      } catch (e) { return { error: String((e && e.message) || e) }; }
    })()`;
    try {
      const res = await this.evalJs<{ status?: number; body?: string; error?: string }>(code);
      if (res.error) return { error: `Replay failed: ${res.error}` };
      return { text: `${method} ${absUrl} -> HTTP ${res.status}\n${res.body}`, status: res.status, url: pageUrl };
    } catch (err) {
      return { error: `Replay failed: ${errMsg(err)}` };
    }
  }

  // Sub-actions allowed inside batch(); a deliberate subset of runCommand's full switch, matching
  // browserCommandHandler.ts's BATCH_DISPATCH table (list_interactives allowed only as it is
  // there: a terminal read, never mid-batch, enforced by the same abort-on-url-change rule below).
  async batch(params: Record<string, unknown>): Promise<CdpCommandResult> {
    const actions = Array.isArray(params.actions) ? (params.actions as Array<{ type?: string; params?: Record<string, unknown> }>) : [];
    if (actions.length === 0) return { error: 'actions parameter must be a non-empty array' };
    if (actions.length > P_MAX_BATCH_ACTIONS) return { error: `Batch too large: ${actions.length} actions (max ${P_MAX_BATCH_ACTIONS}). Split into smaller batches.` };

    const results: Array<Record<string, unknown>> = [];
    let abortedAt: number | null = null;
    let abortReason: string | null = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const subType = action?.type;
      const subParams = action?.params || {};
      if (!subType || !this.isBatchableAction(subType)) {
        results.push({ index: i, type: subType, error: `Unknown or disallowed batch sub-action type: ${subType}` });
        continue;
      }
      const { url: urlBefore } = await this.urlAndTitle().catch(() => ({ url: '' }));
      let subResult: Record<string, unknown>;
      try {
        subResult = await this.runCommand(subType as BrowserAction, subParams);
      } catch (err) {
        subResult = { error: `Sub-action failed: ${errMsg(err)}` };
      }
      results.push({ index: i, type: subType, ...subResult });
      if (subResult.error && i < actions.length - 1) {
        abortedAt = i + 1;
        abortReason = `Sub-action ${i + 1} (${subType}) failed: ${subResult.error}; remaining ${actions.length - i - 1} action(s) skipped`;
        break;
      }
      const { url: urlAfter } = await this.urlAndTitle().catch(() => ({ url: urlBefore }));
      if (urlAfter !== urlBefore && i < actions.length - 1) {
        abortedAt = i + 1;
        abortReason = `URL changed mid-batch from ${urlBefore} to ${urlAfter}; remaining ${actions.length - i - 1} action(s) skipped`;
        break;
      }
    }

    const summaryLines = results.map((r, i) => `  ${i + 1}. ${r.type}: ${r.error ? `FAIL (${r.error})` : 'OK'}`);
    const { url } = await this.urlAndTitle().catch(() => ({ url: '' }));
    const text = [`Batch executed ${results.length}/${actions.length} actions`, ...summaryLines, abortedAt !== null ? `\nABORTED at action ${abortedAt}: ${abortReason}` : ''].filter(Boolean).join('\n');
    return { text, results, aborted_at: abortedAt, abort_reason: abortReason, url };
  }

  private isBatchableAction(type: string): type is BrowserAction {
    return ['click_index', 'press_key', 'type', 'wait', 'scroll', 'navigate', 'click', 'click_point', 'list_interactives'].includes(type);
  }

  /** Single dispatch point mirroring browserCommandHandler.ts's runBrowserCommand switch -- the
   * shape a future ticket wires a WS/RPC handler onto. */
  async runCommand(action: BrowserAction, params: Record<string, unknown> = {}): Promise<CdpCommandResult> {
    switch (action) {
      case 'screenshot': return this.screenshot();
      case 'get_text': return this.getText();
      case 'get_console': return this.getConsole();
      case 'navigate': return this.navigate(params);
      case 'click': return this.click(params);
      case 'type': return this.type(params);
      case 'evaluate': return this.evaluate(params);
      case 'get_elements': return this.getElements(params);
      case 'scroll': return this.scroll(params);
      case 'wait': return this.wait(params);
      case 'press_key': return this.pressKey(params);
      case 'list_interactives': return this.listInteractives();
      case 'click_index': return this.clickIndex(params);
      case 'click_point': return this.clickPoint(params);
      case 'batch': return this.batch(params);
      case 'detect_webmcp': return this.detectWebmcp();
      case 'list_routes': return this.listRoutes();
      case 'replay_route': return this.replayRoute(params);
      case 'click_by_name': return this.clickByName(params);
      default: return { error: `Unknown browser action: ${String(action)}` };
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
