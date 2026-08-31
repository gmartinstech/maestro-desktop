import { _electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedAppPath, waitForMainWindow } from '../helpers/launch';

export const seededSettings = () => ({
  user_id: 'e2e-fake-user',
  user_email: 'e2e@maestro.test',
  language: 'en',
});

type ProcessInfo = { pid: number; parentPid: number };

export function descendantPids(rootPid: number, processes: ProcessInfo[]): number[] {
  const found = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (found.has(process.parentPid) && !found.has(process.pid)) {
        found.add(process.pid);
        changed = true;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

function runningProcesses(): ProcessInfo[] {
  try {
    if (process.platform === 'win32') {
      const raw = execFileSync('pwsh', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { encoding: 'utf8' });
      const rows = JSON.parse(raw || '[]');
      return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ pid: row.ProcessId, parentPid: row.ParentProcessId }));
    }
    const raw = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    return raw.split('\n').flatMap((line) => {
      const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
      return Number.isFinite(pid) && Number.isFinite(parentPid) ? [{ pid, parentPid }] : [];
    });
  } catch {
    return [];
  }
}

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
      const rootPid = app.process()?.pid;
      const descendants = rootPid ? descendantPids(rootPid, runningProcesses()).filter((pid) => pid !== rootPid) : [];
      await app.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      for (const pid of descendants) {
        try { process.kill(pid); } catch {}
      }
      for (const root of [dataRoot, stateHome, userData]) rmSync(root, { recursive: true, force: true });
    }
  },
});

export { expect };
