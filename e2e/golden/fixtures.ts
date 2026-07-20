// e2e/golden/fixtures.ts
import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
export async function launchMaestro() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, MAESTRO_MOCK_AGENT: '1', OPENSWARM_DISABLE_PREFLIGHT: '1', DATA_ROOT: dataRoot },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, dataRoot };
}
