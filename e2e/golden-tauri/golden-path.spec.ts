// e2e/golden-tauri/golden-path.spec.ts
//
// TAU-6: the Tauri-shell counterpart of e2e/golden/golden-path.spec.ts. Same three assertions
// (title, the search-trigger test id, an in-page fetch to /api/health/check succeeding) against
// the same MockAgent-backed boot -- see that file's header comment for why the assertions are
// scoped to boot health rather than a full agent turn; the reasoning is identical here.
import { test, expect } from '@playwright/test';
import { launchMaestroTauri } from './fixtures';

test('golden path (Tauri): shell boots, renders, and serves a session', async () => {
  const { win, close } = await launchMaestroTauri();

  await expect(win).toHaveTitle(/Maestro Studio/);
  // Same test-id (not text) rationale as the Electron spec: default locale is pt-BR.
  // Given a generous timeout: unlike the Electron shell, this build's main window is created
  // hidden (tauri.conf.json's "visible": false) and only shown once TAU-5's splash->main
  // coordinator sees both the backend AND the first page-load finish, so first paint under a
  // loaded dev machine can trail #root's own mount by longer than the config's default 30s.
  await expect(win.getByTestId('global-search-trigger')).toBeVisible({ timeout: 60_000 });

  // Tauri has no preload-injected window.__MAESTRO_PORT__ (that's an Electron contextBridge
  // concept -- see frontend/src/shared/config.ts); ask the same Rust command tauriShell.ts itself
  // calls (get_backend_port, tauri/src/lib.rs) directly via the low-level Tauri IPC global, so
  // this reads the real bound port the same way the app's own renderer does. Re-queried on every
  // retry below rather than cached once: if the sidecar's restart policy (tauri/src/sidecar.rs)
  // ever re-picks a port, frontend/src/shared/config.ts's own self-heal reloads onto it, and a
  // port captured before that reload would spend the whole retry window on a now-dead one.
  const getPort = () => win.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<number> } }).__TAURI_INTERNALS__;
    return internals ? internals.invoke('get_backend_port') : null;
  });
  const firstPort = await getPort();
  expect(firstPort, 'renderer never resolved the backend port via get_backend_port').toBeTruthy();

  // Prove the backend SERVES, not merely that it bound a port -- same auth-exempt health route
  // the Electron spec uses (backend/auth.py P_AUTH_EXEMPT_PREFIX), fetched the same in-page way.
  // Retried rather than single-shot: this shell's window can finish its first paint (and #root
  // mount) before the backend sidecar's own health poll has resolved -- see
  // tauri/src/sidecar.rs's wait_for_health -- so a cold/loaded machine can race a single fetch.
  const consoleErrors: string[] = [];
  win.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  let health: { status: number; body: string } | null = null;
  let lastPort: number | null = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    lastPort = await getPort();
    health = await win.evaluate(async (p) => {
      try {
        const r = await fetch(`http://127.0.0.1:${p}/api/health/check`);
        return { status: r.status, body: await r.text() };
      } catch (err) {
        return { status: 0, body: String(err) };
      }
    }, lastPort);
    if (health.status === 200) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  expect(
    health?.status,
    `backend did not serve /api/health/check on port ${lastPort} (got ${health?.body?.slice(0, 120)}); recent console errors: ${consoleErrors.slice(-5).join(' | ')}`,
  ).toBe(200);

  await close();
});
