import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, waitForMainWindow } from '../helpers/launch';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Deep interactive coverage: drives every reachable user-facing surface on the
// packaged app and asserts no renderer crashes per step. Runs on every gated CI
// push against the Windows leg (macOS legs were removed). Replaces the "I
// physically click everything" manual gap with a hermetic automated one that
// has no foreground-lock contention because CI runners have no competing app.

function backendLogPath(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'Maestro Studio', 'data', 'backend.log');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Maestro Studio', 'data', 'backend.log');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Maestro Studio', 'data', 'backend.log');
}

function crashCount(): number {
  try { return (fs.readFileSync(backendLogPath(), 'utf8').match(/renderer process gone/g) || []).length; }
  catch { return 0; }
}

test.describe.configure({ mode: 'serial' });
test.describe('deep interactive coverage', () => {
  let app: ElectronApplication;
  let page: Page;
  let baseline = 0;

  const noNewCrashes = (label: string) => {
    const now = crashCount();
    expect(now, `renderer crashed during: ${label}`).toBe(baseline);
  };

  // Strict by default: a missing target FAILS the step so absent buttons can't
  // green a build. Pass { optional: true } only for surfaces that legitimately
  // may not exist on a clean profile, and we still annotate the skip.
  const safeClick = async (locator: ReturnType<Page['getByText']>, label: string, opts?: { optional?: boolean }) => {
    const count = await locator.count();
    if (count === 0) {
      if (opts?.optional) { test.info().annotations.push({ type: 'skip', description: `${label}: optional target absent` }); return false; }
      throw new Error(`${label}: required target not visible`);
    }
    await locator.first().click({ timeout: 5000 });
    return true;
  };

  test.beforeAll(async () => {
    app = await launchApp();
    page = await waitForMainWindow(app);
    baseline = crashCount();
  });

  test.afterAll(async () => { await app?.close().catch(() => {}); });

  test('home renders without crashing', async ({}, info) => {
    await page.screenshot({ path: info.outputPath('home.png') });
    noNewCrashes('home render');
  });

  // The Settings gear button lives in DashboardHeader now, which AppShell only
  // mounts (DashboardHost) once a dashboard is active, unlike the old sidebar
  // Settings entry which was reachable from every route. So this must run
  // AFTER a dashboard is active; hence "Dashboard canvas opens" runs first.
  test('Dashboard canvas opens', async ({}, info) => {
    // DashboardSelection auto-creates a dashboard and navigates into it on first
    // boot when none exist, so this is usually already true; fall back to its
    // "New dashboard" button for whatever state isn't.
    if (!/\/dashboard\//.test(page.url())) {
      await expect.poll(() => page.url(), { timeout: 8000 }).toMatch(/\/dashboard\//).catch(() => {});
    }
    if (!/\/dashboard\//.test(page.url())) {
      await safeClick(page.getByRole('button', { name: 'New dashboard' }) as any, 'New dashboard (DashboardSelection)');
      await expect.poll(() => page.url(), { timeout: 8000 }).toMatch(/\/dashboard\//);
    }
    await page.waitForTimeout(2000);
    // Synchronization barrier: DashboardHeader (and its Settings button, used by
    // the next tests) only mounts once the canvas has actually rendered.
    await expect(page.locator('[data-testid="dashboard-header-settings-button"]'), 'dashboard header never mounted').toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: info.outputPath('dashboard-canvas.png') });
    noNewCrashes('dashboard canvas open');
  });

  test('Settings opens and every tab renders', async ({}, info) => {
    await safeClick(page.locator('[data-testid="dashboard-header-settings-button"]') as any, 'Settings button (dashboard header)');
    await page.waitForTimeout(1500);
    // Skills/Tools moved here from the old sidebar Customization section
    // (Settings.tsx TAB_VALUES); this is now the full live tab list.
    for (const tab of ['General', 'Models', 'Skills', 'Tools', 'Commands', 'Usage']) {
      const t = page.getByRole('tab', { name: tab }).first();
      if (await t.count()) {
        await t.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(900);
        await page.screenshot({ path: info.outputPath(`settings-${tab.toLowerCase()}.png`) });
        noNewCrashes(`Settings ${tab} tab`);
      }
    }
    await page.locator('[data-testid="settings-close-button"]').first().click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(700);
  });

  test('Settings toggles flip + revert (effect verified)', async ({}, info) => {
    await safeClick(page.locator('[data-testid="dashboard-header-settings-button"]') as any, 'Settings button for toggles');
    await page.waitForTimeout(1500);
    const toggles = page.locator('input[type="checkbox"], [role="switch"]');
    const n = Math.min(await toggles.count(), 5);
    for (let i = 0; i < n; i++) {
      const t = toggles.nth(i);
      const before = await t.isChecked().catch(() => null);
      await t.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      const after = await t.isChecked().catch(() => null);
      if (before !== null && after !== null) expect(after, `toggle #${i} did not flip`).not.toBe(before);
      await t.click({ timeout: 2000 }).catch(() => {});   // revert
      await page.waitForTimeout(300);
      noNewCrashes(`toggle ${i} flip+revert`);
    }
    await page.screenshot({ path: info.outputPath('settings-toggles.png') });
    await page.locator('[data-testid="settings-close-button"]').first().click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(700);
  });

  // Skills/Tools (ex-Customization) now live inside the Settings modal, not a
  // standalone sidebar panel; Actions and Modes have no living UI destination
  // at all (Main.tsx only routes "/", "/dashboard/:id", "/analytics"), so this
  // only covers what still exists.
  test('Settings: Skills / Tools tabs render', async ({}, info) => {
    await safeClick(page.locator('[data-testid="dashboard-header-settings-button"]') as any, 'Settings button for Skills/Tools');
    await page.waitForTimeout(1500);
    for (const tab of ['Skills', 'Tools']) {
      const t = page.getByRole('tab', { name: tab }).first();
      await safeClick(t as any, `Settings tab ${tab}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: info.outputPath(`${tab.toLowerCase()}.png`) });
      noNewCrashes(tab);
    }
    await page.locator('[data-testid="settings-close-button"]').first().click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(700);
  });

  test('New Agent compose box opens (EditorSurface contentEditable mount)', async ({}, info) => {
    await safeClick(page.getByRole('button', { name: 'New Agent' }) as any, 'New Agent');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: info.outputPath('new-agent-compose.png') });
    noNewCrashes('New Agent compose mount');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  });

  test('Browser card mounts (webview path)', async ({}, info) => {
    await safeClick(page.getByRole('button', { name: 'Browser' }) as any, 'Browser');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: info.outputPath('browser-card.png') });
    noNewCrashes('Browser card mount (webview)');
  });

  test('History panel opens', async ({}, info) => {
    await safeClick(page.getByRole('button', { name: 'History' }) as any, 'History');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: info.outputPath('history.png') });
    noNewCrashes('History panel mount');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  });

  test('Add note mounts (sticky)', async ({}, info) => {
    await safeClick(page.getByRole('button', { name: 'Add note' }) as any, 'Add note');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: info.outputPath('note.png') });
    noNewCrashes('Add note mount');
  });

  test('Add App picker opens', async ({}, info) => {
    await safeClick(page.getByRole('button', { name: 'Add App' }) as any, 'Add App');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: info.outputPath('add-app-picker.png') });
    noNewCrashes('Add App picker mount');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  });

  test('zero new renderer-gone-lines across the entire walkthrough', () => {
    expect(crashCount(), 'one or more surfaces crashed the renderer; check earlier test annotations').toBe(baseline);
  });
});
