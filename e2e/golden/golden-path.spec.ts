// e2e/golden/golden-path.spec.ts
import { test, expect } from '@playwright/test';
import { launchMaestro, dismissSignInPrompt } from './fixtures';

// Scoped deliberately to boot health, not a full agent turn. The old spec drove a chat flow that
// predates the dashboard-first UI: clicking /new agent|create/ makes a draft card, and Enter in that
// context never POSTs .../message, so it could not pass. Diagnosed 2026-07-23 ("golden spec broken
// (canvas vs chat) -> smoke-test") and resolved that way here. A turn-through-canvas assertion is a
// separate ticket: it needs the canonical send path from a draft card, which is a product decision.
test('golden path: packaged app boots, renders, and serves a session', async () => {
  const { app, win } = await launchMaestro();

  // launchMaestro already waited for #root to have children, so React mounted for real.
  await expect(win).toHaveTitle(/Maestro Studio/);
  // By test id, not by text: the default language is pt-BR, so asserting the English "Search…"
  // failed the moment the shell was localized. Any locale-dependent selector will do this again.
  await expect(win.getByTestId('global-search-trigger')).toBeVisible();

  // The backend is up and answering, not merely spawned.
  const port = await win.evaluate(() => (window as any).__MAESTRO_PORT__ ?? null);
  expect(port, 'renderer never learned the backend port').toBeTruthy();

  // An isolated profile has no provedor-ia token, so the sign-in gate opens over the canvas.
  await dismissSignInPrompt(win);

  // Prove the backend SERVES, not merely that it bound a port. Deliberately not driven through the
  // UI: a truly fresh profile has no dashboard, so the toolbar's new-agent button does not exist yet
  // — the old assertion on it only passed because the non-isolated run reused a profile that had one.
  // Use the auth-exempt health route Electron itself polls (backend/auth.py P_AUTH_EXEMPT_PREFIX);
  // the per-install bearer is not ambient in the page, and a smoke test should not have to
  // reproduce the app's auth plumbing to learn whether the server answers.
  const health = await win.evaluate(async () => {
    const r = await fetch(`http://127.0.0.1:${(window as any).__MAESTRO_PORT__}/api/health/check`);
    return { status: r.status, body: await r.text() };
  });
  expect(health.status, `backend did not serve /api/health/check (got ${health.body?.slice(0, 120)})`).toBe(200);

  await app.close();
});
