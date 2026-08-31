import { test, expect } from '../fixtures/packagedApp';

test('creates a dashboard from the header and switches back', async ({ maestro }) => {
  await expect.poll(() => maestro.page.url()).toMatch(/\/dashboard\/[^/]+$/);
  const firstUrl = maestro.page.url();
  const firstId = firstUrl.match(/\/dashboard\/([^/?#]+)/)?.[1];
  expect(firstId).toBeTruthy();
  await expect(maestro.page.locator('[data-testid="dashboard-header-toggle"]')).toBeVisible();

  await maestro.page.locator('[data-testid="dashboard-header-toggle"]').click();
  await maestro.page.locator('[data-testid="dashboard-header-new-dashboard"]').click();
  await expect.poll(() => maestro.page.url()).not.toBe(firstUrl);

  await maestro.page.locator('[data-testid="dashboard-header-toggle"]').click();
  await maestro.page.locator(`[data-dashboard-id="${firstId}"]`).click();
  await expect(maestro.page).toHaveURL(firstUrl);
  maestro.assertNoUnexpectedErrors();
});
