// Manual real-integration check for BRW-3's gate -- not part of the vitest suite (which stays
// stubbed/mocked, see screencast.test.ts). Run with:
//   npx tsx src/browser/screencast.integration-check.ts
//
// End to end, for real:
//  1. Launches a real browser via BRW-1's launcher.ts.
//  2. Navigates its one page (via a minimal CDP session) to a self-contained data: URL test page
//     with a big clickable button and a status label -- no network dependency.
//  3. Starts a real `ws.Server` and wires each connection through startScreencastSession().
//  4. Connects a plain `ws` client (the "UI") to that server over a real loopback socket, counts
//     `screencast:frame` messages for a few seconds, and reports the measured fps.
//  5. Sends a synthetic `input:mouse` mousePressed+mouseReleased click through the same socket,
//     then reads the page's DOM (via CDP Runtime.evaluate) to confirm the click actually landed.
//  6. Tears everything down (client, server, browser) and reports PASS/FAIL with real numbers --
//     it does not just assert success.
import { WebSocket, WebSocketServer } from 'ws';
import { launchBrowser } from './launcher';
import { connectCdpSession, startScreencastSession, type ScreencastServerEvent } from './screencast';

// CDP's Page.startScreencast emits a new frame only when the compositor actually repaints --
// it is not a fixed-rate video clock. A perfectly static page therefore produces exactly ONE
// frame and then falls silent, which would make this gate wrongly measure ~0fps regardless of
// how fast the transport itself is. The #anim box's requestAnimationFrame loop keeps the page
// continuously repainting (like a real screencast target -- an interactive app UI, not a static
// document) so the measured fps reflects the transport's real throughput, not the test page's
// lack of motion.
const TEST_PAGE_HTML = `<!doctype html><html><body style="margin:0;background:#222;overflow:hidden">
<button id="target" style="position:absolute;left:50px;top:50px;width:200px;height:80px;font-size:20px">Click me</button>
<div id="status" style="position:absolute;left:50px;top:160px;color:white;font-size:20px">not clicked</div>
<div id="anim" style="position:absolute;top:300px;width:40px;height:40px;background:#0f8;border-radius:50%"></div>
<script>
let n = 0;
document.getElementById('target').addEventListener('click', () => {
  n += 1;
  document.getElementById('status').textContent = 'clicked ' + n + ' time(s)';
});
const anim = document.getElementById('anim');
function tick(t) {
  anim.style.left = (50 + 400 * (0.5 + 0.5 * Math.sin(t / 300))) + 'px';
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script>
</body></html>`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('[screencast-check] launching browser...');
  const browser = await launchBrowser();
  console.log(`[screencast-check] browser launched: source=${browser.source} cdpPort=${browser.cdpPort} pid=${browser.pid}`);

  const res = await fetch(`http://127.0.0.1:${browser.cdpPort}/json/list`);
  const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error('no page target found');
  const navCdp = await connectCdpSession(page.webSocketDebuggerUrl);
  await navCdp.send('Page.enable');
  const dataUrl = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;
  await navCdp.send('Page.navigate', { url: dataUrl });
  await sleep(500); // data: URL navigation is effectively instant; a small settle beats a flaky race
  navCdp.close();
  console.log('[screencast-check] navigated to test page');

  let server: WebSocketServer | null = null;
  let client: WebSocket | null = null;
  let exitCode = 0;

  try {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('could not determine WS server port');
    const wsPort = address.port;
    console.log(`[screencast-check] screencast WS server listening on ws://127.0.0.1:${wsPort}`);

    server.on('connection', (uiSocket) => {
      void startScreencastSession(uiSocket, browser.cdpPort, { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 900 }).catch(
        (err: unknown) => console.error('[screencast-check] server-side session error:', err),
      );
    });

    client = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => resolve());
      client?.once('error', reject);
    });
    console.log('[screencast-check] plain WS test client connected');

    let frameCount = 0;
    let started = false;
    const frameTimestamps: number[] = [];
    client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ScreencastServerEvent;
      if (msg.event === 'screencast:started') started = true;
      if (msg.event === 'screencast:frame') {
        frameCount += 1;
        frameTimestamps.push(Date.now());
      }
    });

    // Warm-up window: let the stream reach a steady rate before measuring.
    await sleep(1000);
    if (!started) throw new Error('did not receive screencast:started within the warm-up window');
    const warmupFrameCount = frameCount;
    const measureStart = Date.now();
    const MEASURE_MS = 3000;
    await sleep(MEASURE_MS);
    const measuredFrames = frameCount - warmupFrameCount;
    const elapsedS = (Date.now() - measureStart) / 1000;
    const fps = measuredFrames / elapsedS;
    console.log(`[screencast-check] measured ${measuredFrames} frames over ${elapsedS.toFixed(2)}s => ~${fps.toFixed(1)} fps`);
    if (fps < 10) {
      console.warn(`[screencast-check] WARNING: measured fps (${fps.toFixed(1)}) is below the ticket's >=10fps target -- reporting real result, not asserting success`);
    } else {
      console.log('[screencast-check] fps target (>=10fps @ 1280x900) MET');
    }

    // Synthetic click round-trip.
    console.log('[screencast-check] sending synthetic mousePressed+mouseReleased at (100, 90)...');
    client.send(JSON.stringify({ event: 'input:mouse', data: { type: 'mousePressed', x: 100, y: 90, button: 'left', clickCount: 1 } }));
    client.send(JSON.stringify({ event: 'input:mouse', data: { type: 'mouseReleased', x: 100, y: 90, button: 'left', clickCount: 1 } }));
    await sleep(300);

    const checkCdp = await connectCdpSession(page.webSocketDebuggerUrl);
    await checkCdp.send('Runtime.enable');
    const evalResult = (await checkCdp.send('Runtime.evaluate', {
      expression: "document.getElementById('status').textContent",
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    checkCdp.close();
    const statusText = evalResult.result?.value;
    console.log(`[screencast-check] page status text after click: "${String(statusText)}"`);

    if (statusText !== 'clicked 1 time(s)') {
      console.error('[screencast-check] FAILED: synthetic click did not reach the page as expected');
      exitCode = 1;
    } else {
      console.log('[screencast-check] synthetic click PASSED: input round-trip confirmed via DOM state');
    }
  } finally {
    client?.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await browser.close();
    console.log('[screencast-check] cleaned up (client, server, browser closed)');
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[screencast-check] FAILED with an uncaught error', err);
  process.exit(1);
});
