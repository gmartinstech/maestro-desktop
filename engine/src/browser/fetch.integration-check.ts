// Manual real-integration check for BRW-5's gate -- not part of the vitest suite (which stays
// stubbed/mocked, see fetch.test.ts). Run with: npx tsx src/browser/fetch.integration-check.ts
//
// Calls fetchPageContent() for real: launches a real system browser (BRW-1's launcher), drives it
// over real CDP (BRW-2's client), and extracts real rendered text. Uses a local `data:` URL rather
// than a live network fetch, per this ticket's own gate instructions ("a local data: URL you
// construct, to avoid any live network dependency in an automated test") -- this still exercises
// the entire real pipeline (real browser process, real CDP WebSocket, real DOM render + read), it
// just doesn't depend on any external site being reachable/stable.
import { fetchPageContent, searchWeb } from './fetch';

const TEST_HTML = `
<!doctype html>
<html>
<head><title>BRW-5 integration check</title></head>
<body>
  <h1>Maestro Engine Fetch Check</h1>
  <p>If you can read this sentence, the CDP-based fetch tier extracted real rendered page text.</p>
  <script>document.title = document.title + ' (script ran)';</script>
</body>
</html>`;
const TEST_URL = `data:text/html,${encodeURIComponent(TEST_HTML)}`;

async function main(): Promise<void> {
  console.log('[integration-check] fetchPageContent() against a local data: URL...');
  const result = await fetchPageContent(TEST_URL, { settleMs: 500 });
  console.log('[integration-check] result:', JSON.stringify(result, null, 2));

  if (result.error) {
    throw new Error(`fetchPageContent returned an error: ${result.error}`);
  }
  if (!result.text.includes('CDP-based fetch tier extracted real rendered page text')) {
    throw new Error(`fetchPageContent text did not contain the expected sentence. Got: ${result.text}`);
  }
  if (!result.title.includes('script ran')) {
    throw new Error(`fetchPageContent title did not reflect the in-page <script> mutation (proves real rendering, not a static parse). Got: ${result.title}`);
  }
  console.log('[integration-check] fetchPageContent: PASS -- real extracted content confirmed, including a script-mutated title.');

  // searchWeb() needs live network (it drives real Google/DDG/Bing) so it can't use a data: URL --
  // exercised here as a secondary, best-effort check: a live network failure here does not fail
  // the gate (fetchPageContent above is BRW-5's actual required gate), but a clean run is reported.
  console.log('[integration-check] searchWeb() against the live network (best-effort, not gate-blocking)...');
  try {
    const search = await searchWeb('maestro studio electron typescript', 3);
    console.log('[integration-check] searchWeb result:', JSON.stringify(search, null, 2));
    if (search.count > 0) {
      console.log(`[integration-check] searchWeb: PASS -- got ${search.count} result(s) from engine="${search.engine}".`);
    } else {
      console.log(`[integration-check] searchWeb: no results (engine="${search.engine}", error="${search.error}") -- not failing the gate, network-dependent.`);
    }
  } catch (err) {
    console.log(`[integration-check] searchWeb threw (not failing the gate, network-dependent): ${String(err)}`);
  }
}

main()
  .then(() => {
    console.log('[integration-check] DONE');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[integration-check] FAILED', err);
    process.exit(1);
  });
