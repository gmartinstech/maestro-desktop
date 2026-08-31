// e2e/golden/fixtures.ts
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { packagedAppPath } from '../helpers/launch';
import { closePackagedApp } from '../helpers/processTree';

// A static opaque credential (`mtok_...` shape, but any non-JWT string classifies the same way —
// see backend/apps/settings/maestro_token_status.py token_looks_like_jwt) reads as `state: "opaque"`,
// which the app treats as always-usable and never dead. Seeding it directly into the isolated data
// root's settings.json is how this suite gets an authenticated boot WITHOUT driving any UI: the old
// paste-a-JWT dialog is gone, and the real flow opens the system browser to Keycloak, which this
// suite must never do. Field name `provedor_ia_token` is unchanged on the backend.
function seedOpaqueMaestroToken(dataRoot: string): void {
  const settingsDir = join(dataRoot, 'settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ provedor_ia_token: 'mtok_e2e_fake_opaque_token' }, null, 2));
}

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
  // THREE roots need redirecting, not one. A packaged build ignored the old bare DATA_ROOT and
  // resolved %APPDATA%\Maestro Studio\data, so this smoke was reading and writing the developer's
  // real sessions, dashboards and settings. MAESTRO_DATA_ROOT covers backend state,
  // MAESTRO_STATE_HOME covers ~/.maestro (workspaces, caches, tool reports), and --user-data-dir
  // covers Electron's own userData, which holds localStorage and the settings main.js reads.
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-data-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'maestro-e2e-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'maestro-e2e-userdata-'));
  // Seed BEFORE launch so the token-status check on boot reads "opaque" immediately: the gate's
  // auto-login effect fires as soon as the first status lands, and a real Keycloak browser-open
  // must never race this suite.
  seedOpaqueMaestroToken(dataRoot);
  const app = await electron.launch({
    executablePath: packagedAppPath(),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      MAESTRO_MOCK_AGENT: '1',
      MAESTRO_DISABLE_PREFLIGHT: '1',
      MAESTRO_DATA_ROOT: dataRoot,
      MAESTRO_STATE_HOME: stateHome,
    },
  });
  const win = await mainWindow(app);
  await win.waitForLoadState('domcontentloaded');
  // domcontentloaded fires on the shell HTML: #root is still empty and stays that way for ~15s
  // while the backend boots. Waiting for React to actually mount is the difference between
  // driving the app and driving a blank page that merely has the right title.
  await win.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, undefined, { timeout: 120_000 });
  return { app, win, dataRoot, stateHome, userData, close: () => closePackagedApp(app) };
}
