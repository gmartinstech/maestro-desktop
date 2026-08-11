// e2e/golden/fixtures.ts
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { packagedAppPath } from '../helpers/launch';

// firstWindow() returns the SPLASH, which main.js loads as a data: URL and then closes once the
// real window is ready-to-show — so every later action raced a dying page. The splash's <title> is
// also "Maestro Studio", identical to the app's, so a title assertion cannot tell them apart.
// Discriminate on the URL scheme instead and wait for the window that outlives boot.
async function mainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const real = app.windows().find((w) => { const u = w.url(); return !!u && !u.startsWith('data:'); });
    if (real && !real.isClosed()) return real;
    await app.waitForEvent('window', { timeout: 5_000 }).catch(() => undefined);
  }
  throw new Error(`main window never appeared; open windows: ${JSON.stringify(app.windows().map((w) => w.url()))}`);
}

export async function launchMaestro() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-'));
  // Drive the packaged binary, like every other e2e spec. This used to pass args:['.'],
  // which asked Playwright for an `electron` package the repo root does not depend on —
  // and the root package.json has no `main`, so it had no app to open either.
  const app = await electron.launch({
    executablePath: packagedAppPath(),
    env: { ...process.env, MAESTRO_MOCK_AGENT: '1', MAESTRO_DISABLE_PREFLIGHT: '1', DATA_ROOT: dataRoot },
  });
  const win = await mainWindow(app);
  await win.waitForLoadState('domcontentloaded');
  return { app, win, dataRoot };
}
