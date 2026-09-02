import { defineConfig } from '@playwright/test';

// Contract tests hit a plain HTTP/WS backend directly (fetch + WebSocket) — no browser, no
// Electron. scripts/run-contract-tests.mjs boots the backend and hands this run its
// CONTRACT_HTTP_URL / CONTRACT_TOKEN before invoking `playwright test` with this config, and
// tears the backend down after.
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // one backend instance, one session-happy-path per test file
  workers: 1,
  reporter: [['list']],
  retries: 0,
});
