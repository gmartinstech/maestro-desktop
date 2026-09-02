// Manual real-integration check for BRW-2's gate -- not part of the vitest suite (which stays
// mocked-transport per the ticket, see cdp.test.ts). Run with:
//   npx tsx src/browser/cdp.integration-check.ts
// Launches a real browser via launcher.ts, connects this CDP client to it, navigates to a
// constructed data: URL, then runs navigate, get_text, evaluate, screenshot, and click, asserting
// each result is sane and correctly shaped. Closes the browser cleanly afterward either way.
import { launchBrowser } from './launcher';
import { CdpBrowserPage } from './cdp';

const TEST_PAGE = `data:text/html,${encodeURIComponent(
  '<!doctype html><html><body>'
  + '<h1 id="heading">Hello CDP</h1>'
  + '<button id="btn" onclick="document.getElementById(\'result\').textContent = \'clicked\'">Click me</button>'
  + '<div id="result">not clicked</div>'
  + '</body></html>',
)}`;

function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  const launched = await launchBrowser();
  console.log(`[cdp-integration-check] launched source=${launched.source} cdpPort=${launched.cdpPort} pid=${launched.pid}`);

  let page: CdpBrowserPage | undefined;
  try {
    page = await CdpBrowserPage.connect(launched.cdpPort, 'about:blank');
    console.log('[cdp-integration-check] connected CdpBrowserPage');

    const navResult = await page.runCommand('navigate', { url: TEST_PAGE });
    console.log('[cdp-integration-check] navigate ->', JSON.stringify(navResult).slice(0, 200));
    assertTrue(!navResult.error, `navigate returned an error: ${navResult.error}`);
    assertTrue(typeof navResult.url === 'string' && (navResult.url as string).startsWith('data:'), 'navigate result.url should echo the data: URL');

    const textResult = await page.runCommand('get_text');
    console.log('[cdp-integration-check] get_text ->', JSON.stringify(textResult).slice(0, 200));
    assertTrue(!textResult.error, `get_text returned an error: ${textResult.error}`);
    assertTrue(typeof textResult.text === 'string' && (textResult.text as string).includes('Hello CDP'), 'get_text should include the page body text');

    const evalResult = await page.runCommand('evaluate', { expression: 'document.getElementById("heading").textContent' });
    console.log('[cdp-integration-check] evaluate ->', JSON.stringify(evalResult).slice(0, 200));
    assertTrue(!evalResult.error, `evaluate returned an error: ${evalResult.error}`);
    assertTrue(evalResult.text === 'Hello CDP', `evaluate should return the heading text, got: ${evalResult.text}`);

    const screenshotResult = await page.runCommand('screenshot');
    console.log('[cdp-integration-check] screenshot -> image length =', typeof screenshotResult.image === 'string' ? (screenshotResult.image as string).length : screenshotResult.error);
    assertTrue(!screenshotResult.error, `screenshot returned an error: ${screenshotResult.error}`);
    assertTrue(typeof screenshotResult.image === 'string' && (screenshotResult.image as string).length > 100, 'screenshot result.image should be a non-trivial base64 string');

    const clickResult = await page.runCommand('click', { selector: '#btn' });
    console.log('[cdp-integration-check] click ->', JSON.stringify(clickResult).slice(0, 200));
    assertTrue(!clickResult.error, `click returned an error: ${clickResult.error}`);

    const afterClickResult = await page.runCommand('evaluate', { expression: 'document.getElementById("result").textContent' });
    console.log('[cdp-integration-check] evaluate after click ->', JSON.stringify(afterClickResult).slice(0, 200));
    assertTrue(afterClickResult.text === 'clicked', `click should have updated the result div, got: ${afterClickResult.text}`);

    console.log('[cdp-integration-check] ALL ASSERTIONS PASSED (navigate, get_text, evaluate, screenshot, click)');
  } finally {
    if (page) await page.close();
    await launched.close();
    console.log('[cdp-integration-check] browser closed cleanly');
  }
  console.log(`PID_TO_CHECK=${launched.pid}`);
}

main().catch((err) => {
  console.error('[cdp-integration-check] FAILED', err);
  process.exit(1);
});
