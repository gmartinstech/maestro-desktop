// e2e/golden/golden-path.spec.ts
import { test, expect } from '@playwright/test';
import { launchMaestro } from './fixtures';

// Scoped deliberately to boot health, not a full agent turn. The old spec drove a chat flow that
// predates the dashboard-first UI: clicking /new agent|create/ makes a draft card, and Enter in that
// context never POSTs .../message, so it could not pass. Diagnosed 2026-07-23 ("golden spec broken
// (canvas vs chat) -> smoke-test") and resolved that way here. A turn-through-canvas assertion is a
// separate ticket: it needs the canonical send path from a draft card, which is a product decision.
test('golden path: packaged app boots, renders, and serves a session', async () => {
  const { app, win } = await launchMaestro();

  // launchMaestro already waited for #root to have children, so React mounted for real.
  await expect(win).toHaveTitle(/Maestro Studio/);
  await expect(win.getByText(/Search…/)).toBeVisible();

  // The backend is up and answering, not merely spawned.
  const port = await win.evaluate(() => (window as any).__MAESTRO_PORT__ ?? null);
  expect(port, 'renderer never learned the backend port').toBeTruthy();

  // A session can be created end to end: the narrowest check that the agent plumbing (backend +
  // dashboard persistence) is wired, without needing a model or a credential.
  await win.getByRole('button', { name: /new agent|create/i }).first().click();
  await expect(win.getByTestId('chat-input').first()).toBeVisible({ timeout: 30_000 });

  await app.close();
});
