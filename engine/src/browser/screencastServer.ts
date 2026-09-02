// engine/src/browser/screencastServer.ts -- BRW-4: wires BRW-1's launcher.ts + BRW-3's
// screencast.ts into a WS endpoint the canvas browser card (BrowserCanvasCdp.tsx, in frontend/)
// connects to when MAESTRO_BROWSER_ENGINE=cdp. screencast.ts's own header flags this exact wiring
// as "a later ticket" with no consumer yet ("whoever wires this into engine/src/server.ts") --
// this file, plus its call site in server.ts's upgrade handler (gated on the same env var), is
// that ticket.
//
// One launched external browser per `browserId` (a dashboard "browser card"), kept alive across
// reconnects -- a frontend page reload or a dashboard-switch-and-back must not relaunch the
// remote browser and lose its navigation state. Concurrent connections racing for the same
// browserId (a fast reconnect) share one in-flight launch. Torn down via close()/closeAll() --
// wired to engine shutdown in main.ts; per-card teardown (the card's own close/remove action) is
// left for a follow-up ticket, same as this ticket's scope being the render path, not full
// lifecycle plumbing.
//
// Deliberate scope cut (flagged, not an oversight, same convention as cdp.ts/screencast.ts's own
// header comments): one CDP page target per browserId, not per tab -- screencast.ts's
// findPageTargetWsUrl always attaches to the FIRST "page" target the launched browser reports.
// Multiple tabs opened in one card today share that single live remote page; giving each tab its
// own CDP target (via /json/new) is a bigger change than this ticket's "canvas browser card"
// scope covers.
//
// Extends BRW-3's own wire protocol with one new client->server message, `browser:navigate`, so
// the URL bar can drive the same live page instead of only mouse/keyboard -- handled by a second,
// independent 'message' listener on the same socket (a `ws` WebSocket is a plain EventEmitter and
// supports more than one 'message' listener; screencast.ts's own listener already ignores
// anything that isn't `input:mouse`/`input:key`, see its isScreencastClientEvent), rather than
// editing screencast.ts itself.

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { launchBrowser, type LaunchedBrowser, type ResolveDeps } from './launcher';
import {
  connectCdpSession,
  findPageTargetWsUrl,
  startScreencastSession,
  type CdpSession,
  type ScreencastDeps,
  type UiSocketLike,
} from './screencast';

export interface BrowserScreencastServerDeps {
  launchBrowser: (deps?: ResolveDeps) => Promise<LaunchedBrowser>;
  findPageTargetWsUrl: (cdpPort: number) => Promise<string>;
  connectCdpSession: (wsUrl: string) => Promise<CdpSession>;
}

function defaultDeps(): BrowserScreencastServerDeps {
  return {
    // Always headless for this feature -- see launcher.ts's LaunchOptions doc: a real headed
    // window can go fully invisible to Page.startScreencast the instant it's occluded or
    // minimized (confirmed live during this ticket's own gate, via document.visibilityState),
    // which is exactly the failure mode a canvas-only view must never depend on avoiding.
    launchBrowser: (deps) => launchBrowser(deps, { headless: true }),
    findPageTargetWsUrl,
    connectCdpSession,
  };
}

// Must match frontend/src/app/pages/Dashboard/cards/browser/BrowserCanvasCdp.tsx's
// CDP_VIEWPORT_WIDTH/CDP_VIEWPORT_HEIGHT -- duplicated across the frontend/engine boundary the
// same way the wire-protocol shapes are (see this file's header), kept in sync by convention.
const CDP_SCREEN_WIDTH = 1280;
const CDP_SCREEN_HEIGHT = 900;

interface BrowserSession {
  browser: LaunchedBrowser;
  navCdp: CdpSession | null;
  navCdpPromise: Promise<CdpSession> | null;
  // Resolved ONCE and reused by every later caller for this browserId (the eager viewport-pin
  // connection AND startScreencastSession's own separate connection) -- see resolveTargetWsUrl's
  // doc for why calling screencast.ts's findPageTargetWsUrl fresh each time is unsafe on a real
  // browser profile.
  targetWsUrlPromise: Promise<string> | null;
}

// Owns the browserId -> launched-browser mapping for one engine process. A class, not module
// state, so tests get a fresh, isolated registry instead of leaking launched browsers between
// test cases (getSharedBrowserScreencastRegistry() below is the one real process-wide instance).
export class BrowserScreencastRegistry {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly launching = new Map<string, Promise<BrowserSession>>();

  // Public: wireConnection() reuses the same findPageTargetWsUrl/connectCdpSession fakes when
  // constructing startScreencastSession's own ScreencastDeps override, so a unit test only ever
  // injects deps in one place (see screencastServer.test.ts).
  constructor(readonly deps: BrowserScreencastServerDeps = defaultDeps()) {}

  async getOrLaunch(browserId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(browserId);
    if (existing) return existing;
    const inFlight = this.launching.get(browserId);
    if (inFlight) return inFlight;
    const promise = (async (): Promise<BrowserSession> => {
      const browser = await this.deps.launchBrowser();
      const session: BrowserSession = { browser, navCdp: null, navCdpPromise: null, targetWsUrlPromise: null };
      this.sessions.set(browserId, session);
      // Pin the remote page's viewport to a fixed, known size EAGERLY (not lazily on first
      // navigate): launcher.ts's spawn args pass no --window-size, so a freshly launched window
      // has whatever size the OS handed it, and BrowserCanvasCdp.tsx's click math
      // (toCanvasCoords) assumes a fixed CDP_VIEWPORT_WIDTH x CDP_VIEWPORT_HEIGHT space from the
      // very first frame. Without this, mouse coordinates would be silently wrong against
      // whatever the real window size happened to be -- a correctness bug, not just a gate
      // convenience, so it can't wait for a browser:navigate to fix it up after the fact.
      await this.ensureNavCdp(session).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[screencastServer] failed to pin viewport for browserId=${browserId}:`, err);
      });
      return session;
    })();
    this.launching.set(browserId, promise);
    try {
      return await promise;
    } finally {
      this.launching.delete(browserId);
    }
  }

  // Resolved ONCE per browserId and cached, rather than calling screencast.ts's
  // findPageTargetWsUrl fresh every time a CDP connection is needed. A real Chrome/Edge profile
  // can spawn extra "page"-type CDP targets alongside the actual content tab shortly after launch
  // (observed live on this machine: a first-run edge://sync-confirmation-dialog/ toast opens as
  // its own "page" target a beat after the browser starts) -- findPageTargetWsUrl just grabs
  // whichever "page" target /json/list lists first, which is fine for a single independent call,
  // but the eager viewport-pin connection (getOrLaunch, below) and startScreencastSession's own
  // separate connection each call it independently; if the target LIST's order changes between
  // those two calls (exactly what a popping-up dialog does), they silently end up on two
  // DIFFERENT targets -- the pin (and any navigate) lands on one, the screencast watches the
  // other, and the visible result is "0 frames, click never lands" with no error anywhere. Found
  // via the real end-to-end gate (browserCanvasCdp.integration-check.mjs), not reasoned out in
  // advance. Resolving once, as early as possible (right at launch, before a dialog has had a
  // chance to appear) and caching it fixes the inconsistency without changing screencast.ts's own
  // target-selection heuristic.
  private resolveTargetWsUrl(session: BrowserSession): Promise<string> {
    if (!session.targetWsUrlPromise) {
      session.targetWsUrlPromise = this.deps.findPageTargetWsUrl(session.browser.cdpPort);
      session.targetWsUrlPromise.catch(() => { session.targetWsUrlPromise = null; }); // let a failed resolution be retried later instead of poisoning the session forever
    }
    return session.targetWsUrlPromise;
  }

  // A single, lazily-opened CDP session, reused for both the eager viewport pin above (getOrLaunch)
  // and every later browser:navigate -- opening a fresh one per call would be wasteful. Sharing it
  // with startScreencastSession's own connection is safe (CDP targets accept multiple simultaneous
  // debugger clients) but not done here on purpose -- that connection is private to
  // startScreencastSession's closure (see screencast.ts's header on why it keeps its own minimal
  // session rather than exposing one). Takes the already-resolved session (not a browserId) so
  // getOrLaunch's own promise chain, above, can call it without recursing back into getOrLaunch.
  private async ensureNavCdp(session: BrowserSession): Promise<CdpSession> {
    if (session.navCdp) return session.navCdp;
    if (!session.navCdpPromise) {
      session.navCdpPromise = (async () => {
        const wsUrl = await this.resolveTargetWsUrl(session);
        const cdp = await this.deps.connectCdpSession(wsUrl);
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: CDP_SCREEN_WIDTH, height: CDP_SCREEN_HEIGHT, deviceScaleFactor: 1, mobile: false,
        });
        session.navCdp = cdp;
        return cdp;
      })();
    }
    return session.navCdpPromise;
  }

  async navSession(browserId: string): Promise<CdpSession> {
    const session = await this.getOrLaunch(browserId);
    return this.ensureNavCdp(session);
  }

  // Public: wireConnection() needs the SAME cached target url for startScreencastSession's own
  // connection -- see resolveTargetWsUrl's doc on why an independent findPageTargetWsUrl call
  // there would risk a different target.
  async targetWsUrlFor(browserId: string): Promise<string> {
    const session = await this.getOrLaunch(browserId);
    return this.resolveTargetWsUrl(session);
  }

  async close(browserId: string): Promise<void> {
    const session = this.sessions.get(browserId);
    if (!session) return;
    this.sessions.delete(browserId);
    try { session.navCdp?.close(); } catch { /* best-effort */ }
    await session.browser.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  get size(): number {
    return this.sessions.size;
  }
}

const sharedRegistry = new BrowserScreencastRegistry();

// The one process-wide registry real traffic uses (server.ts's upgrade handler defaults to it).
// Tests build their own BrowserScreencastRegistry with injected deps instead of touching this.
export function getSharedBrowserScreencastRegistry(): BrowserScreencastRegistry {
  return sharedRegistry;
}

function parseQuery(url: string | undefined): URLSearchParams {
  try {
    return new URL(url ?? '/', 'http://internal').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

interface NavigateMessage {
  event: 'browser:navigate';
  data: { url: string };
}

function isNavigateMessage(v: unknown): v is NavigateMessage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.event !== 'browser:navigate' || typeof o.data !== 'object' || o.data === null) return false;
  return typeof (o.data as Record<string, unknown>).url === 'string';
}

// Exported for screencastServer.test.ts -- lets the wiring logic be driven with a fake
// UiSocketLike, with no real HTTP upgrade / WebSocketServer.handleUpgrade involved (that plumbing
// is exercised for real by screencastServer.integration-check.ts instead).
export async function wireConnection(ws: WebSocket, browserId: string, registry: BrowserScreencastRegistry): Promise<void> {
  // Registered FIRST, synchronously, before any `await` in this function: BrowserCanvasCdp.tsx
  // sends browser:navigate the INSTANT its connection opens (see its mount effect), which can
  // arrive well before registry.getOrLaunch() resolves (a real browser launch is a few seconds).
  // `ws` frames and emits an incoming message as soon as it's fully received on the wire, with NO
  // buffering for a listener that isn't attached yet -- an emit with zero listeners is simply
  // lost. Found by the real end-to-end gate (browserCanvasCdp.integration-check.mjs), not
  // reasoned out in advance: the engine-only integration-check happened to send its navigate
  // AFTER waiting for screencast:started, which masked this exact race.
  const onNavigateMessage = (raw: RawData): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return; // malformed frame from the UI -- ignore rather than crash the session
    }
    if (!isNavigateMessage(parsed)) return; // not ours -- startScreencastSession's own listener owns input:mouse/input:key
    void (async () => {
      try {
        const cdp = await registry.navSession(browserId);
        await cdp.send('Page.navigate', { url: parsed.data.url });
      } catch (err) {
        try {
          ws.send(JSON.stringify({ event: 'screencast:error', data: { message: `navigate failed: ${err instanceof Error ? err.message : String(err)}` } }));
        } catch { /* socket may already be closing */ }
      }
    })();
  };
  ws.on('message', onNavigateMessage);
  ws.once('close', () => ws.off('message', onNavigateMessage));

  try {
    const session = await registry.getOrLaunch(browserId);

    // A `ws` WebSocket instance already satisfies UiSocketLike's shape (readyState,
    // bufferedAmount, send, on/off('message'), once('close')) -- no adapter needed.
    // findPageTargetWsUrl here is registry.targetWsUrlFor, NOT registry.deps.findPageTargetWsUrl
    // directly -- see resolveTargetWsUrl's doc on why an independent call here could resolve to a
    // different CDP target than the eager viewport-pin connection did.
    const screencastDeps: ScreencastDeps = {
      findPageTargetWsUrl: () => registry.targetWsUrlFor(browserId),
      connectCdpSession: registry.deps.connectCdpSession,
    };
    await startScreencastSession(ws as unknown as UiSocketLike, session.browser.cdpPort, {}, screencastDeps);
  } catch (err) {
    try {
      ws.send(JSON.stringify({ event: 'screencast:error', data: { message: `session setup failed: ${err instanceof Error ? err.message : String(err)}` } }));
    } catch { /* best-effort */ }
    try { ws.close(); } catch { /* already closing */ }
  }
}

// Completes a WS upgrade for `/ws/browser-screencast?browserId=<id>` and wires it to a live
// screencast + input session (BRW-3) against the browser launched (or reused) for that id. The
// caller (server.ts) owns auth + routing; by the time this runs the upgrade is already
// authorized, same division of responsibility as proxyWebSocketUpgrade there.
export async function handleBrowserScreencastUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  registry: BrowserScreencastRegistry = sharedRegistry,
): Promise<void> {
  const browserId = parseQuery(req.url).get('browserId');
  if (!browserId) {
    try { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch { /* socket already gone */ }
    socket.destroy();
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (ws) => {
    void wireConnection(ws, browserId, registry);
  });
}
