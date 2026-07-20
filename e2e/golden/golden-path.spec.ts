// e2e/golden/golden-path.spec.ts
import { test, expect } from '@playwright/test';
import { launchMaestro } from './fixtures';
test('golden path: launch → create agent → run turn → stream renders', async () => {
  const { app, win } = await launchMaestro();
  await expect(win).toHaveTitle(/Maestro Studio|Open ?Swarm/);          // BRD flips this to Maestro Studio-only
  await win.getByRole('button', { name: /new agent|create/i }).first().click();
  await win.getByRole('textbox').first().fill('say hello');
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('assistant-message').first()).toBeVisible({ timeout: 15000 });
  await app.close();
});
