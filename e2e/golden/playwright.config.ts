import { defineConfig } from '@playwright/test';

// Golden smoke config — DEV layout (not the packaged artifact the tests/ suite uses).
// The packaged golden E2E requires a full electron-builder artifact + a stable
// agent-turn UX; until that exists this smoke drives the real app in dev mode
// (webpack dev server + backend from backend/.venv) and asserts the load-bearing
// invariants we CAN verify deterministically: the app boots, the renderer mounts,
// and the window↔backend bridge comes up. See fixtures.ts for the launch details.
//
// Prereqs (provisioned once): `cd frontend && npm ci`, `cd electron && npm ci`
// (downloads the Electron binary), and a `backend/.venv` with backend deps
// (`python -m venv backend/.venv` + `pip install -r backend/requirements.txt`).
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  retries: 0,
  // Playwright starts (and tears down) the frontend dev server; reused if already up.
  webServer: {
    command: 'npm --prefix ../../frontend run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 150_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
