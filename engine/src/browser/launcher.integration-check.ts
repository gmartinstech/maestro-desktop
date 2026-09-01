// Manual real-integration check for BRW-1's gate (b) — not part of the vitest suite (which stays
// stubbed/mocked per the ticket). Run with: npx tsx src/browser/launcher.integration-check.ts
// Launches a real browser, hits /json/version over HTTP, closes it, and reports the PID so the
// caller can independently confirm via tasklist that nothing was left running.
import { launchBrowser } from './launcher';

async function main(): Promise<void> {
  const launched = await launchBrowser();
  console.log(`[integration-check] resolved source=${launched.source} executablePath=${launched.executablePath}`);
  console.log(`[integration-check] cdpPort=${launched.cdpPort} pid=${launched.pid}`);

  const res = await fetch(`http://127.0.0.1:${launched.cdpPort}/json/version`);
  const body = (await res.json()) as { Browser?: unknown };
  console.log(`[integration-check] /json/version status=${res.status} Browser=${String(body.Browser)}`);
  if (!res.ok || typeof body.Browser !== 'string') {
    throw new Error('CDP /json/version did not return the expected shape');
  }

  await launched.close();
  console.log('[integration-check] close() resolved cleanly');
  console.log(`PID_TO_CHECK=${launched.pid}`);
}

main().catch((err) => {
  console.error('[integration-check] FAILED', err);
  process.exit(1);
});
