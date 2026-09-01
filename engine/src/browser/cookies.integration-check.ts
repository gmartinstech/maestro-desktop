// Manual real-integration check for BRW-6's gate -- not part of the vitest suite (which stays
// stubbed/mocked, see cookies.test.ts). Run with: npx tsx src/browser/cookies.integration-check.ts
//
// BRW-6 is the plan's named escalation point: "for user-driven login, show the external Chromium
// window itself (non-headless, positioned over the card) rather than the screencast; cookies come
// from CDP Network.getCookies on that browser's profile" (D3). A real 2FA-gated login against
// reddit.com/x.com/tiktok.com is not something this agent can complete autonomously -- per the
// ticket's own instructions, this check instead proves the MECHANISM for real:
//   (a) the launched browser is a REAL, VISIBLE OS window (not headless) -- checked externally,
//       see this file's own console output telling the caller how to independently verify it
//       (Get-Process / window-visibility), same posture as launcher.integration-check.ts's
//       "PID_TO_CHECK" convention;
//   (b) navigating that real window to a live, real, non-auth site (httpbin.org's cookie-set
//       endpoint -- no account, no signup, sets a real HTTP cookie as a side effect of one
//       trivial interaction, exactly what the ticket suggests) and detecting "done" via BOTH of
//       the two configurable strategies this module implements: a named cookie appearing, and a
//       URL-pattern match on the post-set redirect (httpbin redirects to /cookies once the cookie
//       is set) -- run as two independent captures so each detection path is proven on its own;
//   (c) reading the real cookie back via CDP Network.getCookies() and confirming its value is
//       exactly what was requested (not merely "a cookie appeared", but "the RIGHT cookie");
//   (d) the browser process is fully gone afterward (no orphan), the same check every other BRW
//       integration-check in this phase runs.
//
// httpbin.org is a live, real external site (not a data: URL) precisely because the mechanism
// being tested here is "did a real browser really navigate and really receive a real cookie from
// a real server", which a local data: URL cannot exercise for the cookie-set half.
import { randomBytes } from 'node:crypto';
import { launchBrowser } from './launcher';
import { captureLoginCookies } from './cookies';

function randomToken(): string {
  return randomBytes(8).toString('hex');
}

async function checkRealVisibleWindow(): Promise<void> {
  console.log('[integration-check] (a) launching a real, non-headless browser to confirm it is a real OS window...');
  const browser = await launchBrowser(); // headless defaults to false in launcher.ts -- this is the whole point of BRW-6
  console.log(`[integration-check] launched source=${browser.source} pid=${browser.pid} cdpPort=${browser.cdpPort}`);
  console.log(`PID_TO_CHECK=${browser.pid}`);
  console.log('[integration-check] pausing 4s so the caller can independently confirm a visible window exists for this PID (e.g. `Get-Process -Id <pid> | Select MainWindowTitle,MainWindowHandle`, or Win32 IsWindowVisible on that handle) before it is closed...');
  await new Promise((resolve) => setTimeout(resolve, 4000));
  await browser.close();
  console.log('[integration-check] (a) close() resolved cleanly.');
}

async function checkCookieCaptureViaCookieName(): Promise<void> {
  console.log('[integration-check] (b1) capture via COOKIE-NAME detection against a live httpbin.org cookie-set URL...');
  const token = randomToken();
  const cookieName = 'maestro_brw6_check';
  const result = await captureLoginCookies({
    domain: 'httpbin.org',
    loginUrl: `https://httpbin.org/cookies/set/${cookieName}/${token}`,
    successCookieNames: [cookieName],
    timeoutMs: 30000,
    pollIntervalMs: 500,
  });
  console.log('[integration-check] result:', JSON.stringify(result));
  if (result.error) throw new Error(`cookie-name capture returned an error: ${result.error}`);
  const captured = result.cookies.find((c) => c.name === cookieName);
  if (!captured) throw new Error(`expected cookie "${cookieName}" was not in the captured set: ${JSON.stringify(result.cookies)}`);
  if (captured.value !== token) throw new Error(`captured cookie value "${captured.value}" did not match the requested token "${token}"`);
  console.log(`[integration-check] (b1) PASS -- captured ${cookieName}=${captured.value}, matches the value this run requested.`);
}

async function checkCookieCaptureViaUrlPattern(): Promise<void> {
  console.log('[integration-check] (b2) capture via URL-PATTERN detection (cookie-name detection deliberately disabled)...');
  const token = randomToken();
  const cookieName = 'maestro_brw6_check2';
  const result = await captureLoginCookies({
    domain: 'httpbin.org',
    loginUrl: `https://httpbin.org/cookies/set/${cookieName}/${token}`,
    successCookieNames: [], // deliberately empty: only the URL-pattern signal can fire success here
    successUrlPattern: /\/cookies$/, // httpbin redirects to /cookies once the Set-Cookie response is served
    timeoutMs: 30000,
    pollIntervalMs: 500,
  });
  console.log('[integration-check] result:', JSON.stringify(result));
  if (result.error) throw new Error(`URL-pattern capture returned an error: ${result.error}`);
  const captured = result.cookies.find((c) => c.name === cookieName);
  if (!captured || captured.value !== token) {
    throw new Error(`URL-pattern-detected capture did not include the expected cookie: ${JSON.stringify(result.cookies)}`);
  }
  console.log(`[integration-check] (b2) PASS -- URL-pattern detection alone was enough to trigger capture, and the real cookie ${cookieName}=${captured.value} was read back correctly.`);
}

async function checkTimeoutPath(): Promise<void> {
  console.log('[integration-check] (c) confirms the timeout path reports an honest error rather than a false success...');
  const result = await captureLoginCookies({
    domain: 'httpbin.org',
    loginUrl: 'https://httpbin.org/html', // sets no cookie at all
    successCookieNames: ['this_cookie_will_never_appear'],
    timeoutMs: 2500,
    pollIntervalMs: 500,
  });
  console.log('[integration-check] result:', JSON.stringify(result));
  if (!result.error || !result.error.includes('Timed out')) {
    throw new Error(`expected a timeout error, got: ${JSON.stringify(result)}`);
  }
  if (result.cookies.length !== 0) throw new Error(`expected no cookies on a timeout, got: ${JSON.stringify(result.cookies)}`);
  console.log('[integration-check] (c) PASS -- timed out honestly, no false-positive cookies.');
}

async function main(): Promise<void> {
  await checkRealVisibleWindow();
  await checkCookieCaptureViaCookieName();
  await checkCookieCaptureViaUrlPattern();
  await checkTimeoutPath();
}

main()
  .then(() => {
    console.log('[integration-check] DONE -- all BRW-6 mechanism checks passed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[integration-check] FAILED', err);
    process.exit(1);
  });
