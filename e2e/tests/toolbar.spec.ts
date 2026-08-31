import { test, expect } from '../fixtures/packagedApp';

test('adds a note and opens App and History surfaces', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  await maestro.page.locator('[data-testid="dashboard-toolbar-add-note"]').click();
  await expect(maestro.page.locator('textarea')).toHaveCount(1);

  await maestro.page.getByRole('button', { name: 'Add App' }).click();
  await expect(maestro.page.getByRole('textbox', { name: 'Search apps...' })).toBeVisible();
  await maestro.page.keyboard.press('Escape');

  await maestro.page.getByRole('button', { name: 'History' }).click();
  await expect(maestro.page.getByRole('textbox', { name: 'Search past chats...' })).toBeVisible();
  await maestro.page.keyboard.press('Escape');
  maestro.assertNoUnexpectedErrors();
});

test('opens mock agent compose without a provider', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  await maestro.page.locator('[data-testid="new-agent-button"]').click();
  const editor = maestro.page.locator('[data-testid="chat-input"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await maestro.page.keyboard.type('offline test prompt');
  await expect.poll(async () => (await editor.innerText()).trim()).toContain('offline test prompt');
  await maestro.page.keyboard.press('Escape');
  maestro.assertNoUnexpectedErrors();
});
