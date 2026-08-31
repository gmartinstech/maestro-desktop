import { test, expect } from '../fixtures/packagedApp';

test('opens Settings, activates every tab, and closes', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  await maestro.page.locator('[data-testid="dashboard-header-settings-button"]').click();
  await expect(maestro.page.getByText('Settings', { exact: true }).first()).toBeVisible();

  for (const tab of ['General', 'Models', 'Skills', 'Tools', 'Commands', 'Usage']) {
    const locator = maestro.page.getByRole('tab', { name: tab });
    await locator.click();
    await expect(locator).toHaveAttribute('aria-selected', 'true');
  }

  await maestro.page.locator('[data-testid="settings-close-button"]').click();
  await expect(maestro.page.getByRole('tab', { name: 'General' })).toHaveCount(0);
  maestro.assertNoUnexpectedErrors();
});

test('saves and reverts the selected theme', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  await maestro.page.locator('[data-testid="dashboard-header-settings-button"]').click();
  await maestro.page.getByRole('tab', { name: 'General' }).click();
  const readMode = () => maestro.page.evaluate(() => localStorage.getItem('maestro-theme-mode'));
  const before = await readMode();
  const target = before === 'dark' ? 'Light' : 'Dark';
  await maestro.page.getByRole('button', { name: target }).click();
  await expect.poll(readMode).not.toBe(before);
  await maestro.page.getByRole('button', { name: before === 'dark' ? 'Dark' : 'Light' }).click();
  await expect.poll(readMode).toBe(before);
  maestro.assertNoUnexpectedErrors();
});
