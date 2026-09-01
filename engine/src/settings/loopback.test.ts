// engine/src/settings/loopback.test.ts -- ENG-5 gate (a): fast vitest coverage of the port-20128
// coexistence decision AND the bind + real-HTTP-request/response cycle, with 9Router's own
// isRunning() and the token-exchange/credential-store path both faked -- no real network, no real
// OS keyring, no dependency on whether 9Router happens to be running on this machine right now.
// The real end-to-end path (a genuine bind, a genuine HTTP hit, a genuine attempt against
// Keycloak's token endpoint with a fake code) is proven separately by
// loopback.integration-check.ts (this ticket's GATE (b) -- see that file for why it's a manual
// script, not part of this suite).

import { afterEach, describe, expect, it } from 'vitest';
import {
  MAESTRO_LOOPBACK_PATH,
  MAESTRO_LOOPBACK_PORT,
  bindMaestroLoopbackListener,
  startMaestroLoopbackListener,
  type LoopbackListener,
} from './loopback';
import type { MaestroCallbackOutcome } from './keycloakAuth';

let listener: LoopbackListener | null = null;
afterEach(async () => {
  if (listener) {
    await listener.close();
    listener = null;
  }
});

describe('startMaestroLoopbackListener: 9Router coexistence', () => {
  it('does not bind when 9Router is already running -- defers to the proxied path', async () => {
    listener = await startMaestroLoopbackListener(5_000, { isNineRouterRunning: async () => true });
    expect(listener).toBeNull();
    // Not-binding is the whole point: a second bind attempt on the real port must still succeed,
    // proving the first call genuinely never touched it.
    const probe = await bindMaestroLoopbackListener(1_000, async () => ({ ok: true, accessToken: 'unused' }));
    listener = probe;
    expect(probe.port).toBe(MAESTRO_LOOPBACK_PORT);
  });

  it('binds when 9Router is not running', async () => {
    listener = await startMaestroLoopbackListener(5_000, { isNineRouterRunning: async () => false }, async () => ({ ok: true, accessToken: 'unused' }));
    expect(listener).not.toBeNull();
    expect(listener?.port).toBe(MAESTRO_LOOPBACK_PORT);
  });
});

describe('the bound listener: request handling', () => {
  async function bindWithOutcome(outcome: MaestroCallbackOutcome): Promise<LoopbackListener> {
    const bound = await bindMaestroLoopbackListener(5_000, async () => outcome);
    listener = bound;
    return bound;
  }

  it('a synthetic callback with a fake code reaches the completion handler and serves success HTML', async () => {
    await bindWithOutcome({ ok: true, accessToken: 'at-fake' });
    const res = await fetch(`http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}${MAESTRO_LOOPBACK_PATH}?code=fake-auth-code&state=fake-state`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Connected');
  });

  it('an exchange_failed outcome (the expected shape for a fake code against real Keycloak) serves a graceful failure page, never a crash', async () => {
    await bindWithOutcome({ ok: false, reason: 'exchange_failed', detail: 'invalid_grant' });
    const res = await fetch(`http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}${MAESTRO_LOOPBACK_PATH}?code=fake-auth-code&state=fake-state`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Connection failed');
  });

  it('an unknown-state outcome serves the session-expired page', async () => {
    await bindWithOutcome({ ok: false, reason: 'unknown_state' });
    const res = await fetch(`http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}${MAESTRO_LOOPBACK_PATH}?code=x&state=never-registered`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Session expired');
  });

  it('any other path 404s without invoking the completion handler', async () => {
    let called = false;
    const bound = await bindMaestroLoopbackListener(5_000, async () => {
      called = true;
      return { ok: true, accessToken: 'x' };
    });
    listener = bound;
    const res = await fetch(`http://127.0.0.1:${MAESTRO_LOOPBACK_PORT}/favicon.ico`);
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});
