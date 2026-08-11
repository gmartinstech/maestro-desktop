// e2e/golden/golden-path.spec.ts
import { test, expect } from '@playwright/test';
import { launchMaestro } from './fixtures';
test('golden path: launch → create agent → run turn → stream renders', async () => {
  const { app, win } = await launchMaestro();
  await expect(win).toHaveTitle(/Maestro Studio/);
  await win.getByRole('button', { name: /new agent|create/i }).first().click();
  // The composer is a contenteditable div, not an <input>; target it by test id rather than by
  // role or placeholder text, both of which move under localization.
  await win.getByTestId('chat-input').first().fill('say hello');
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('assistant-message').first()).toBeVisible({ timeout: 30_000 });
  await app.close();
});
