import { test, expect } from '../fixtures/packagedApp';

test('opens and closes Settings three times without renderer errors', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  const baselineCrashes = maestro.crashCount();
  for (let round = 0; round < 3; round++) {
    await maestro.page.locator('[data-testid="dashboard-header-settings-button"]').click();
    await expect(maestro.page.getByRole('tab', { name: 'General' })).toBeVisible();
    await maestro.page.locator('[data-testid="settings-close-button"]').click();
    await expect(maestro.page.getByRole('tab', { name: 'General' })).toHaveCount(0);
  }
  expect(maestro.crashCount()).toBe(baselineCrashes);
  maestro.assertNoUnexpectedErrors();
});
