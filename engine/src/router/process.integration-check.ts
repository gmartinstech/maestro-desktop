// Manual real-integration check for ENG-6's gate (b) -- not part of the vitest suite (which stays
// stubbed/mocked per the ticket, see process.test.ts / process.security.test.ts). Run with:
// npx tsx src/router/process.integration-check.ts
//
// Starts the REAL ported 9Router supervisor (a live `node app/server.js` child process, dev-mode
// npm-cache path), confirms it actually answers on :20128, then kills the child out from under
// the supervisor (simulating a crash) and confirms the death-watcher notices and respawns it with
// a NEW pid -- the same style of live verification TAU-3 used for the Rust backend sidecar
// (tauri/src/sidecar.rs: spawn for real, taskkill the child, confirm a fresh pid takes over).
import * as proc from './process';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(label: string, predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main(): Promise<void> {
  console.log('[integration-check] calling ensureRunning() -- this spawns the real 9router npm package (dev cache)');
  await proc.ensureRunning();

  const up = await proc.isRunning();
  console.log(`[integration-check] isRunning() after ensureRunning() = ${up}`);
  if (!up) throw new Error('9Router did not report running after ensureRunning()');

  const firstPid = proc.routerState.process?.pid;
  console.log(`[integration-check] spawned pid=${firstPid}`);
  if (!firstPid) throw new Error('routerState.process has no pid after a successful ensureRunning()');

  const modelsRes = await fetch(`${proc.NINE_ROUTER_V1}/models`);
  console.log(`[integration-check] GET /v1/models status=${modelsRes.status}`);
  if (!modelsRes.ok) throw new Error(`/v1/models did not return ok: ${modelsRes.status}`);

  console.log(`[integration-check] killing pid=${firstPid} to simulate a crash (death-watcher should revive it)`);
  process.kill(firstPid, 'SIGKILL');

  // The death-watcher (armed by ensureRunning() above, since the router is running) should notice
  // the exit near-instantly and call ensureRunning() again on our behalf -- no manual re-call here.
  await waitUntil(
    'a NEW pid to replace the killed one',
    async () => {
      const pid = proc.routerState.process?.pid;
      return typeof pid === 'number' && pid !== firstPid && proc.routerState.process?.exitCode === null;
    },
    30_000,
  );
  const secondPid = proc.routerState.process?.pid;
  console.log(`[integration-check] death-watcher revived with a new pid=${secondPid}`);

  await waitUntil('isRunning() to report true again after the revive', () => proc.isRunning(), 30_000);
  console.log('[integration-check] isRunning() confirms the revived process is answering');

  const modelsRes2 = await fetch(`${proc.NINE_ROUTER_V1}/models`);
  console.log(`[integration-check] GET /v1/models status=${modelsRes2.status} (against the revived process)`);
  if (!modelsRes2.ok) throw new Error(`/v1/models did not return ok after revive: ${modelsRes2.status}`);

  console.log('[integration-check] stop() -- tearing down for real');
  await proc.stop();
  console.log(`PID_FIRST=${firstPid}`);
  console.log(`PID_SECOND=${secondPid}`);
  console.log('[integration-check] PASSED');
}

main().catch((err) => {
  console.error('[integration-check] FAILED', err);
  void proc.stop().finally(() => process.exit(1));
});
