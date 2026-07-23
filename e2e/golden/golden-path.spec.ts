// e2e/golden/golden-path.spec.ts
//
// Golden SMOKE (dev layout): asserts the load-bearing invariants we can verify
// deterministically today — the app boots, the renderer mounts, the window↔backend
// bridge is live, the main shell paints, and boot produces no fatal renderer error.
//
// It deliberately does NOT drive an agent turn: the real UI is a react-flow canvas
// where agents are nodes, so the old button→textbox→assistant-message flow does not
// exist. A full turn-through-a-provider E2E is a separate spec to author once the
// agent-creation UX is stable (BRD reshapes it); this smoke is the regression oracle
// until then. See fixtures.ts for the dev bring-up.
import { test, expect } from '@playwright/test';
import { launchMaestro } from './fixtures';

test('golden smoke: app boots, shell renders, backend bridge is live', async () => {
  const { app, win, cleanup } = await launchMaestro();
  try {
    const fatalErrors: string[] = [];
    win.on('pageerror', (e) => fatalErrors.push(e.message || String(e)));

    // 1. Brand (BRD later narrows this to Maestro Studio only).
    await expect(win).toHaveTitle(/Maestro Studio|Open ?Swarm/);

    // 2. Backend bridge is wired: the preload exposes the port accessor and it
    //    resolves to a real loopback port (proves renderer↔main↔backend plumbing).
    const bridgeOk = await win.evaluate(async () => {
      const ow = (window as any).openswarm;
      if (!ow) return false;
      const p = typeof ow.getBackendPortLive === 'function' ? await ow.getBackendPortLive()
              : typeof ow.getBackendPort === 'function' ? ow.getBackendPort() : null;
      return Number.isInteger(p) && p >= 8324 && p <= 8424;
    });
    expect(bridgeOk, 'window.openswarm backend-port bridge resolves a real port').toBe(true);

    // 3. Main shell painted (not stuck on splash): the dashboards search box is a
    //    stable always-present shell control once the React root mounts.
    await expect(
      win.getByPlaceholder(/search dashboards/i).or(win.getByRole('textbox').first()),
    ).toBeVisible({ timeout: 30_000 });

    // 4. No fatal renderer error surfaced during boot.
    expect(fatalErrors, `renderer pageerror(s): ${fatalErrors.join(' | ')}`).toHaveLength(0);
  } finally {
    await cleanup();
  }
});
