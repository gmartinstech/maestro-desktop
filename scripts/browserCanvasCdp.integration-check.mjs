// BRW-4's real-integration gate for the ACTUAL REACT COMPONENT, not a stand-in. Run with:
//   node scripts/browserCanvasCdp.integration-check.mjs
//
// screencastServer.integration-check.ts (engine/src/browser/) already proves the engine-side wire
// end to end with a plain `ws` test client standing in for the UI. This script proves the other
// half: the REAL frontend/src/app/pages/Dashboard/cards/browser/BrowserCanvasCdp.tsx component --
// exactly what BrowserCard.tsx renders under MAESTRO_BROWSER_ENGINE=cdp -- actually renders live
// screencast frames on its <canvas> and actually turns a real mouse click into a change on the
// real remote page, with nothing faked in between.
//
// How: (1) spawns the REAL engine (engine/src/main.ts) as a child process, MAESTRO_BROWSER_ENGINE=cdp,
// pointed at an isolated MAESTRO_DATA_ROOT so it never touches a real dev/user token file.
// (2) builds BrowserCanvasCdp.tsx + browserScreencastClient.ts through webpack
// (frontend/webpack.harness.config.js) -- the same babel/TS pipeline as the real app build, just a
// different entry point that skips Redux/i18n/MUI bootstrap (this component depends on none of
// them). (3) serves that bundle over plain HTTP and loads it in a real headless Chromium via
// Playwright. (4) reads live canvas pixels to confirm frames are actually arriving and changing.
// (5) sends a REAL Playwright mouse click on the <canvas> DOM element (dispatches real
// mousedown/mouseup the component's own onMouseDown/onMouseUp handlers receive) and confirms,
// again via live canvas pixels, that the remote page's own background actually changed color --
// proof the click reached the real remote browser and repainted, round-tripped all the way back
// through a real screencast frame.
//
// Cleanup: SIGTERM to the engine child (main.ts's own shutdown handler closes the launched remote
// browser, the same path production shutdown takes), Playwright browser close, static server close.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(REPO_ROOT, 'engine');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const HARNESS_DIST = path.join(FRONTEND_DIR, '.gate-harness-dist');
const DATA_ROOT = path.join(REPO_ROOT, '.gate-brw4-data'); // isolated -- never the real dev backend/data

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const TEST_PAGE_HTML = `<!doctype html><html><body style="margin:0;background:#202020;overflow:hidden">
<button id="target" style="position:absolute;left:80px;top:80px;width:240px;height:90px;font-size:22px">Click me</button>
<div id="status" style="position:absolute;left:80px;top:200px;color:white;font-size:20px">not clicked</div>
<div id="anim" style="position:absolute;top:400px;left:600px;width:50px;height:50px;background:#3388ff;border-radius:50%"></div>
<script>
document.getElementById('target').addEventListener('click', () => {
  document.getElementById('status').textContent = 'clicked 1 time(s)';
  document.body.style.background = '#12d94a';
});
const anim = document.getElementById('anim');
function tick(t) { anim.style.top = (400 + 200 * Math.sin(t / 300)) + 'px'; requestAnimationFrame(tick); }
requestAnimationFrame(tick);
</script>
</body></html>`;

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startStaticServer(rootDir, port) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = req.url === '/' ? '/index.html' : req.url;
        const filePath = path.join(rootDir, decodeURIComponent(urlPath));
        if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
        const body = await readFile(filePath);
        const ext = path.extname(filePath);
        const type = ext === '.js' ? 'application/javascript' : ext === '.html' ? 'text/html' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(body);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err));
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function spawnEngine(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/main.ts'], {
      cwd: ENGINE_DIR,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let settled = false;
    const onData = (buf) => {
      out += buf.toString();
      process.stdout.write(`[engine-child] ${buf}`);
      if (!settled && out.includes('[engine] listening on')) {
        settled = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (buf) => process.stderr.write(`[engine-child:stderr] ${buf}`));
    child.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    child.on('exit', (code) => {
      if (!settled) { settled = true; reject(new Error(`engine child exited early with code ${code}`)); }
    });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('engine child did not report "listening" within 20s')); } }, 20000);
  });
}

async function readAuthToken() {
  const tokenPath = path.join(DATA_ROOT, 'auth.token');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (existsSync(tokenPath)) {
      const raw = (await readFile(tokenPath, 'utf8')).trim();
      if (raw) return raw;
    }
    await sleep(100);
  }
  throw new Error(`auth token file never appeared at ${tokenPath}`);
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))));
    child.on('error', reject);
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  let engineChild = null;
  let staticServer = null;
  let browser = null;
  let exitCode = 0;

  try {
    console.log('[gate] building the harness bundle (real BrowserCanvasCdp.tsx + browserScreencastClient.ts)...');
    await run('npx', ['webpack', '--config', 'webpack.harness.config.js'], { cwd: FRONTEND_DIR });
    const distFiles = await readdir(HARNESS_DIST);
    assert(distFiles.includes('index.html') && distFiles.includes('harness.bundle.js'), `harness dist missing expected files, got: ${distFiles.join(', ')}`);
    console.log('[gate] harness bundle built:', distFiles.join(', '));

    const enginePort = await getFreePort();
    console.log(`[gate] spawning the real engine (MAESTRO_BROWSER_ENGINE=cdp) on port ${enginePort}...`);
    engineChild = await spawnEngine({
      MAESTRO_ENGINE_PORT: String(enginePort),
      MAESTRO_ENGINE_HOST: '127.0.0.1',
      MAESTRO_BROWSER_ENGINE: 'cdp',
      MAESTRO_ENGINE_SKIP_BACKEND: '1',
      MAESTRO_DATA_ROOT: DATA_ROOT,
    });
    console.log('[gate] engine is listening');

    const token = await readAuthToken();
    console.log('[gate] read the engine-minted auth token from the isolated data root');

    const staticPort = await getFreePort();
    staticServer = await startStaticServer(HARNESS_DIST, staticPort);
    console.log(`[gate] serving the harness bundle at http://127.0.0.1:${staticPort}`);

    const browserId = `gate-${Date.now()}`;
    const dataUrl = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;
    const wsUrl = `ws://127.0.0.1:${enginePort}/ws/browser-screencast?browserId=${browserId}&token=${encodeURIComponent(token)}`;

    console.log('[gate] launching a real headless Chromium (Playwright) to load the REAL BrowserCanvasCdp component...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
    page.on('console', (msg) => console.log(`[page-console:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.error('[page-error]', err));
    await page.addInitScript(([props]) => { window.__HARNESS_PROPS__ = props; }, [{ browserId, wsUrl, url: dataUrl }]);
    await page.goto(`http://127.0.0.1:${staticPort}/index.html`);

    const canvas = page.locator('[data-testid="browser-canvas-cdp"]');
    await canvas.waitFor({ state: 'attached', timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="browser-canvas-cdp"]')?.getAttribute('data-connected') === '1',
      null,
      { timeout: 15000 },
    );
    console.log('[gate] canvas mounted and BrowserScreencastClient reports connected -- through the REAL component, not a mock');

    // Live-frame proof: sample the same canvas pixel twice with a gap; the test page's own
    // continuous requestAnimationFrame animation guarantees it changes if real frames are
    // actually arriving and being drawn (a frozen/blank canvas would sample identically both times).
    const samplePixel = (x, y) => page.evaluate(([sx, sy]) => {
      const c = document.querySelector('[data-testid="browser-canvas-cdp"]');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(sx, sy, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);

    await sleep(800);
    const animSampleA = await samplePixel(620, 500); // inside the anim circle's vertical sweep range
    await sleep(400);
    const animSampleB = await samplePixel(620, 500);
    const bgSampleBefore = await samplePixel(1150, 850); // far from button/status/anim -- plain background
    console.log(`[gate] anim-region samples (proves live frames, not a static image): A=${JSON.stringify(animSampleA)} B=${JSON.stringify(animSampleB)}`);
    console.log(`[gate] background sample before click: ${JSON.stringify(bgSampleBefore)}`);
    const framesAreLive = animSampleA.some((v, i) => Math.abs(v - animSampleB[i]) > 8);
    if (!framesAreLive) {
      console.warn('[gate] WARNING: the two anim-region samples did not differ -- the animation may have been between the same phase both times; not treated as fatal since the click round-trip below is the load-bearing assertion');
    } else {
      console.log('[gate] PASSED: canvas is receiving live, changing screencast frames from the real remote page');
    }

    console.log('[gate] sending a REAL Playwright mouse click on the <canvas> DOM element at the button\'s position...');
    await canvas.click({ position: { x: 200, y: 125 }, force: true }); // button center: left 80 + 240/2, top 80 + 90/2

    // Give the click time to: reach the component's onMouseDown/onMouseUp -> WS input:mouse ->
    // engine -> CDP Input.dispatchMouseEvent -> real page repaint -> next screencast frame -> canvas draw.
    let bgSampleAfter = bgSampleBefore;
    let clickLanded = false;
    for (let attempt = 0; attempt < 10 && !clickLanded; attempt += 1) {
      await sleep(300);
      bgSampleAfter = await samplePixel(1150, 850);
      // #12d94a ~ (18, 217, 74) -- a real, bright, unmistakable green; #202020 is near-black.
      clickLanded = bgSampleAfter[1] > 120 && bgSampleAfter[0] < 100;
    }
    console.log(`[gate] background sample after click: ${JSON.stringify(bgSampleAfter)}`);

    if (!clickLanded) {
      console.error('[gate] FAILED: a real click on the <canvas> element did not turn into a visible change on the remote page, observed back through the canvas itself');
      exitCode = 1;
    } else {
      console.log('[gate] PASSED: a real Playwright mouse click on the ACTUAL BrowserCanvasCdp.tsx <canvas> reached the real remote browser and repainted -- confirmed via live canvas pixels, the same thing a person would see');
    }
  } catch (err) {
    console.error('[gate] FAILED with an uncaught error:', err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (engineChild && engineChild.exitCode === null) {
      console.log('[gate] sending SIGTERM to the engine child (its own shutdown handler closes the launched remote browser)...');
      engineChild.kill('SIGTERM');
      const exited = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 5000);
        engineChild.once('exit', () => { clearTimeout(t); resolve(true); });
      });
      // SIGTERM was sent to `npx tsx src/main.ts`, spawned with shell:true -- on Windows that's a
      // shell -> npx -> tsx -> node process CHAIN, and killing only the top of that chain does
      // NOT reliably terminate the real node process underneath (Windows has no POSIX process
      // groups; Node's child.kill() only signals the direct child). If that real process survives,
      // main.ts's own SIGTERM handler (which closes the launched remote browser via
      // registry.closeAll()) never runs, and BOTH an orphaned engine process AND an orphaned
      // headless browser process are left running -- reproduced live while building this gate.
      // taskkill /T kills the WHOLE tree rooted at the wrapper's own PID regardless of how many
      // layers are in between, same tool launcher.ts's own killProcessTree already uses for this
      // exact reason. Always run it, even after a clean exit -- idempotent against an
      // already-dead tree, and a guaranteed backstop against a graceful shutdown that raced or
      // partially failed.
      if (!exited) console.warn('[gate] engine child did not exit within 5s after SIGTERM; force-killing its whole process tree');
      if (engineChild.pid && process.platform === 'win32') {
        await new Promise((resolve) => {
          const tk = spawn('taskkill', ['/PID', String(engineChild.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
          tk.on('exit', resolve);
          tk.on('error', resolve);
        });
      }
    }
    // Belt-and-suspenders, not merely defensive: verified live while building this gate that
    // taskkill /T on the wrapper's own PID can still miss the real browser process tree (some
    // npm-CLI wrappers, e.g. npx on Windows, spawn their real work in a way that doesn't always
    // stay a direct, walkable descendant of the PID we hold -- the exact mechanism wasn't worth
    // chasing further; a name+command-line fingerprint sweep is unambiguous and doesn't depend on
    // getting that process-tree relationship right). Matches this exact browser launch by the
    // unique --user-data-dir launcher.ts always gives it (maestro-cdp-browser-<random>) --
    // nothing else on the machine can coincidentally match that string.
    if (process.platform === 'win32') {
      const sweepScript = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*maestro-cdp-browser-*" -and ($_.Name -eq "msedge.exe" -or $_.Name -eq "chrome.exe") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
      // shell:false -- powershell.exe is a real binary found via PATH, and passing args as a real
      // array (no shell:true re-parsing in between) is what keeps this nested double-quoted
      // PowerShell script intact; an earlier version used shell:true here and the sweep silently
      // matched nothing, because cmd.exe's own re-parsing of the -Command string mangled the
      // quoting before PowerShell ever saw it.
      await new Promise((resolve) => {
        const sweep = spawn('powershell.exe', ['-NoProfile', '-Command', sweepScript], { shell: false, stdio: 'ignore' });
        sweep.on('exit', resolve);
        sweep.on('error', resolve);
      });
    }
    if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
    console.log('[gate] cleaned up (browser, engine child, static server)');
  }

  process.exit(exitCode);
}

main();
