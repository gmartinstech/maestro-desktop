import { _electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedAppPath, waitForMainWindow } from '../helpers/launch';
import { closePackagedApp, descendantPids } from '../helpers/processTree';

export { descendantPids } from '../helpers/processTree';

export const seededSettings = () => ({
  user_id: 'e2e-fake-user',
  user_email: 'e2e@maestro.test',
  language: 'en',
  provedor_ia_token: 'mtok_e2e_fake_opaque_token',
});

export type PackagedApp = {
  app: ElectronApplication;
  page: Page;
  dataRoot: string;
  stateHome: string;
  userData: string;
  api: (method: string, path: string, body?: unknown) => Promise<Response>;
  crashCount: () => number;
  assertNoUnexpectedErrors: () => void;
};

export const test = base.extend<{ maestro: PackagedApp }>({
  maestro: async ({}, use) => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-data-'));
    const stateHome = mkdtempSync(join(tmpdir(), 'maestro-e2e-home-'));
    const userData = mkdtempSync(join(tmpdir(), 'maestro-e2e-userdata-'));
    mkdirSync(join(dataRoot, 'settings'), { recursive: true });
    writeFileSync(join(dataRoot, 'settings', 'settings.json'), JSON.stringify(seededSettings()));

    const app = await _electron.launch({
      executablePath: packagedAppPath(),
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        MAESTRO_E2E: '1',
        MAESTRO_MOCK_AGENT: '1',
        MAESTRO_DISABLE_PREFLIGHT: '1',
        MAESTRO_DATA_ROOT: dataRoot,
        MAESTRO_STATE_HOME: stateHome,
        PROVEDOR_IA_TOKEN: '',
        ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_API_KEY: '', OPENROUTER_API_KEY: '',
      },
    });
    const page = await waitForMainWindow(app);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

    const token = await page.evaluate(() => (window as any).maestro.getAuthToken());
    if (!token) throw new Error('packaged test app did not expose a local backend bearer');
    const port = await page.evaluate(() => (window as any).maestro.getBackendPort());
    const api = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const ready = await api('GET', '/api/dashboards/list');
    if (!ready.ok) throw new Error(`packaged backend was not authenticated: ${ready.status}`);
    const crashCount = () => 0;

    try {
      await use({ app, page, dataRoot, stateHome, userData, api, crashCount, assertNoUnexpectedErrors: () => expect(errors).toEqual([]) });
    } finally {
      await closePackagedApp(app);
      for (const root of [dataRoot, stateHome, userData]) rmSync(root, { recursive: true, force: true });
    }
  },
});

export { expect };
