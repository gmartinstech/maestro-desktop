import { test, expect } from '../fixtures/packagedApp';

test('clean packaged boot has a local bearer and can create a dashboard', async ({ maestro }) => {
  await expect(maestro.page.locator('#root')).toBeVisible();
  const created = await maestro.api('POST', '/api/dashboards/create', { name: 'E2E Dashboard' });
  expect(created.status).toBe(200);
  const dashboard = await created.json();
  expect(dashboard.id).toMatch(/^[a-f0-9]+$/);
  await maestro.page.goto(`http://127.0.0.1:4173/index.html#/dashboard/${dashboard.id}`);
  await expect(maestro.page).not.toHaveURL(/dashboard\/undefined/);
  maestro.assertNoUnexpectedErrors();
});

test('clean packaged boot applies English settings', async ({ maestro }) => {
  await expect(maestro.page.getByRole('heading', { name: 'Dashboards' })).toBeVisible();
});
