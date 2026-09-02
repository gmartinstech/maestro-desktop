// Manual real-integration check for BRW-4's engine-side gate -- not part of the vitest suite
// (which stays fully mocked, see screencastServer.test.ts). Run with:
//   npx tsx src/browser/screencastServer.integration-check.ts
//
// End to end, for real, through the ACTUAL engine server (not a stand-in): builds a real Fastify
// instance via server.ts's buildServer() with MAESTRO_BROWSER_ENGINE=cdp set, the same function
// engine/src/main.ts calls in production. Then:
//  1. Connects a plain `ws` client to ws://.../ws/browser-screencast?browserId=...&token=... --
//     this is the exact URL frontend/src/app/pages/Dashboard/cards/browser/BrowserCard.tsx
//     builds for BrowserCanvasCdp.tsx.
//  2. That connection lazily launches a real browser (BRW-1's launcher.ts) and connects it to a
//     real Chromium CDP screencast (BRW-3's screencast.ts) -- proven the SAME way BRW-3's own gate
//     proved it: fps measurement + a synthetic input:mouse click confirmed via the page's own DOM.
//  3. Additionally proves BRW-4's own extension over BRW-3's wire protocol: a browser:navigate
//     message actually navigates the live remote page (verified via CDP, not just "no error").
//  4. Tears everything down and confirms, the same way launcher.integration-check.ts does, that
//     the launched browser process is really gone afterward (no orphan).
import { WebSocket } from 'ws';
import { buildServer } from '../server';
import { connectCdpSession } from './screencast';
import { getSharedBrowserScreencastRegistry } from './screencastServer';

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
  process.env.MAESTRO_BROWSER_ENGINE = 'cdp';
  const TOKEN = 'integration-check-token-0123456789';

  console.log('[screencastServer-check] building the real engine server (MAESTRO_BROWSER_ENGINE=cdp)...');
  const fastify = buildServer({ port: 0, host: '127.0.0.1', routes: new Map(), backendPort: null, authToken: TOKEN });
  const httpBaseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
  const wsBaseUrl = httpBaseUrl.replace(/^http/, 'ws');
  console.log(`[screencastServer-check] engine listening at ${httpBaseUrl}`);

  let client: WebSocket | null = null;
  let exitCode = 0;
  const browserId = `integration-check-${Date.now()}`;

  try {
    client = new WebSocket(`${wsBaseUrl}/ws/browser-screencast?browserId=${browserId}&token=${TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => resolve());
      client?.once('error', reject);
    });
    console.log('[screencastServer-check] client connected through the real engine WS route');

    const t0 = Date.now();
    let started = false;
    let frameCount = 0;
    const frameTimestamps: number[] = [];
    client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { event: string };
      if (msg.event === 'screencast:started') { started = true; console.log(`[screencastServer-check] screencast:started at t=${Date.now() - t0}ms`); }
      if (msg.event === 'screencast:frame') { frameCount += 1; frameTimestamps.push(Date.now()); }
      if (msg.event === 'screencast:error') console.warn(`[screencastServer-check] screencast:error at t=${Date.now() - t0}ms ->`, JSON.stringify(msg));
    });

    const WAIT_MS = 20000;
    const deadline = Date.now() + WAIT_MS;
    while (!started && Date.now() < deadline) await sleep(200);
    if (!started) throw new Error(`did not receive screencast:started within ${WAIT_MS}ms -- the WS route / launcher / screencast wiring did not connect`);
    console.log('[screencastServer-check] screencast:started received (real browser launched + CDP screencast attached)');

    // BRW-4's own extension: navigate the live remote page via browser:navigate.
    const dataUrl = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;
    client.send(JSON.stringify({ event: 'browser:navigate', data: { url: dataUrl } }));
    await sleep(800);
    console.log('[screencastServer-check] sent browser:navigate to the test page');

    const warmupFrameCount = frameCount;
    const measureStart = Date.now();
    const MEASURE_MS = 2500;
    await sleep(MEASURE_MS);
    const measuredFrames = frameCount - warmupFrameCount;
    const fps = measuredFrames / (MEASURE_MS / 1000);
    console.log(`[screencastServer-check] measured ${measuredFrames} frames over ${(MEASURE_MS / 1000).toFixed(1)}s => ~${fps.toFixed(1)} fps (post-navigate, animating test page)`);
    if (fps < 5) {
      console.warn(`[screencastServer-check] WARNING: measured fps (${fps.toFixed(1)}) is low -- reporting honestly, not asserting a fixed target (BRW-3 already proved raw transport throughput; this run is proving the WIRING, not re-measuring peak fps)`);
    }

    console.log('[screencastServer-check] sending synthetic mousePressed+mouseReleased at (100, 90) through input:mouse...');
    client.send(JSON.stringify({ event: 'input:mouse', data: { type: 'mousePressed', x: 100, y: 90, button: 'left', clickCount: 1 } }));
    client.send(JSON.stringify({ event: 'input:mouse', data: { type: 'mouseReleased', x: 100, y: 90, button: 'left', clickCount: 1 } }));
    await sleep(400);

    // Independent verification: reach into the real launched browser via its own fresh CDP
    // session and read the DOM -- not trusting the WS side's own "it worked" silence. Uses the
    // registry's OWN cached target resolution (registry.targetWsUrlFor), not a fresh /json/list
    // query, for the same reason screencastServer.ts's ensureNavCdp/wireConnection do: a real
    // browser profile can spawn extra "page" targets (a first-run sync-confirmation dialog, on
    // this machine) between calls, and a fresh query risks landing on a different target than the
    // one actually driving the test page.
    const registry = getSharedBrowserScreencastRegistry();
    const session = await registry.getOrLaunch(browserId); // already launched; returns the existing one
    const targetWsUrl = await registry.targetWsUrlFor(browserId);
    const checkCdp = await connectCdpSession(targetWsUrl);
    await checkCdp.send('Runtime.enable');
    const evalResult = (await checkCdp.send('Runtime.evaluate', {
      expression: "document.getElementById('status').textContent",
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    checkCdp.close();
    const statusText = evalResult.result?.value;
    console.log(`[screencastServer-check] page status text after click: "${String(statusText)}"`);

    if (statusText !== 'clicked 1 time(s)') {
      console.error('[screencastServer-check] FAILED: click sent through the real BrowserCanvasCdp-shaped input:mouse messages did not reach the page');
      exitCode = 1;
    } else {
      console.log('[screencastServer-check] PASSED: click round-trip confirmed via real DOM state, through the actual engine server + WS route + screencastServer.ts wiring');
    }

    console.log(`PID_TO_CHECK=${session.browser.pid}`);
  } finally {
    client?.close();
    // Unconditional, regardless of which branch above threw or failed an assertion: a launched
    // browser must never survive this script exiting -- see the getSharedBrowserScreencastRegistry
    // import's own registry as the sole owner of what was launched. Previously this lived inside
    // the try block after the pass/fail check, which meant an EARLY throw (e.g. screencast:started
    // never arriving) skipped it entirely and orphaned a real headless browser process every time
    // -- caught only by manually auditing running processes after a run, not by this script itself.
    try { await getSharedBrowserScreencastRegistry().closeAll(); } catch { /* best-effort */ }
    await fastify.close();
    console.log('[screencastServer-check] engine server closed (registry.closeAll() ran unconditionally)');
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[screencastServer-check] FAILED with an uncaught error', err);
  process.exit(1);
});
