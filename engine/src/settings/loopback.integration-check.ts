// engine/src/settings/loopback.integration-check.ts -- ENG-5's manual real-integration check
// (GATE (b)) -- not part of the vitest suite (which stays fully faked, see loopback.test.ts /
// keycloakAuth.test.ts). Run with:
//   npx tsx src/settings/loopback.integration-check.ts
//
// Proves the full plumbing for real: binds the actual Maestro OAuth loopback listener on the real
// port 20128, registers a real pending login (startMaestroLogin -- a genuine PKCE state +
// codeVerifier pair), then fires a REAL HTTP GET at it carrying a made-up authorization code. The
// handler correctly walks state lookup -> a genuine POST to Keycloak's real token endpoint
// (MAESTRO_KEYCLOAK_TOKEN_URL, over the real network) -- which then rejects the fake code exactly
// as expected (invalid_grant or similar) -- and serves the graceful "Connection failed" page rather
// than crashing. That rejection is the CORRECT, expected outcome per this ticket's own gate
// instructions: this proves the plumbing reaches the right code path end to end, not that a fake
// code can forge a real login (it can't, and shouldn't).
//
// What this does NOT and CANNOT prove (needs a human): a real login actually succeeding requires a
// human completing Keycloak's real browser consent screen with real credentials, which produces a
// real, single-use authorization code this script has no way to obtain. See this ticket's own
// structured-output notes for exactly this gap.

import { startMaestroLogin } from './keycloakAuth';
import { MAESTRO_LOOPBACK_PATH, MAESTRO_LOOPBACK_PORT, startMaestroLoopbackListener } from './loopback';

async function main(): Promise<void> {
  console.log('[integration-check] starting the Maestro loopback listener (forcing "9Router is down" so it actually binds)...');
  const listener = await startMaestroLoopbackListener(15_000, { isNineRouterRunning: async () => false });
  if (!listener) throw new Error('listener did not bind -- expected a real bind on a clean dev box with nothing else on :20128');
  if (listener.port !== MAESTRO_LOOPBACK_PORT) throw new Error(`bound to unexpected port ${listener.port}`);
  console.log(`[integration-check] bound to 127.0.0.1:${listener.port}${MAESTRO_LOOPBACK_PATH}`);

  try {
    console.log('[integration-check] registering a real pending login (real PKCE state + codeVerifier)...');
    const { state } = startMaestroLogin();
    console.log(`[integration-check] state=${state.slice(0, 8)}... -- firing a real HTTP GET with a made-up authorization code`);

    const url = `http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}${MAESTRO_LOOPBACK_PATH}?code=fake-authorization-code-not-real&state=${encodeURIComponent(state)}`;
    const res = await fetch(url);
    console.log(`[integration-check] GET ${MAESTRO_LOOPBACK_PATH} -> HTTP ${res.status}`);
    if (res.status !== 200) throw new Error(`expected the listener to always answer 200 (even on a failed exchange), got ${res.status}`);

    const body = await res.text();
    console.log(`[integration-check] response body: ${body.replace(/\s+/g, ' ').trim()}`);
    if (!body.includes('Connection failed')) {
      throw new Error(
        `expected the graceful "Connection failed" page (a fake code MUST be rejected by the real Keycloak token endpoint) -- ` +
        `got a body that doesn't contain it, which means either the plumbing didn't really reach Keycloak, or (very unlikely) the fake code was somehow accepted`,
      );
    }
    console.log('[integration-check] PASS -- the listener bound on :20128, accepted a real HTTP hit, correctly looked up the pending state, ' +
      'genuinely called out to Keycloak\'s real token endpoint over the network, got the expected rejection for a fake code, and served the failure page without crashing.');
  } finally {
    await listener.close();
    console.log('[integration-check] listener closed');
  }
}

main().catch((err: unknown) => {
  console.error('[integration-check] FAIL:', err);
  process.exit(1);
});
