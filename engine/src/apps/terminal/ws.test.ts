// engine/src/apps/terminal/ws.test.ts -- SUB-6's GATE, run for real: a real WebSocket client talks
// to a real listening engine (buildServer, routes = {terminal: 'native'}, no backend spawned at
// all -- backendPort: null proves 'terminal' never falls through to proxy) which drives a REAL
// spawned PTY (no node-pty mocking anywhere in this file) through the exact wire shape
// contract/ws/terminal.ts pins: term:status on connect, a real "echo hello"-style command round-
// tripping through term:input -> term:output (base64-decoded), term:resize not breaking the
// session, and a real shell exit delivering term:exit with the real exit code. Every session this
// file spawns is killed in afterEach (terminalManager.stopAll()), per this ticket's own
// requirement.
//
// Structurally mirrors server.test.ts's real-listening-engine pattern (ENG-1) and agents/ws.ts's
// upgrade-handler convention (AGT-6) -- 'terminal' has no HTTP surface at all, so there is no
// http.ts sibling to test here, only this WS shape.
//
// Three real things this file works around, discovered writing this suite:
//
// (1) A real pwsh.exe persists every command to the developer's actual PSReadLine history unless
//     APPDATA/USERPROFILE/HOME are sandboxed for the test process -- done in beforeAll/afterAll
//     below (see ptySession.test.ts's header for the fuller story).
// (2) PSReadLine's live keystroke echo means a naive "wait for output containing the marker I just
//     wrote" resolves on the echo of what was typed, not the command's real result -- probeCommand()
//     asks PowerShell to print the marker via string concatenation so the exact contiguous marker
//     text can only appear in real, executed output.
// (3) A real race, not a production bug: term:status arrives from the server essentially in the
//     same tick as the client's 'open' event fires (this engine sends it the instant the upgrade
//     completes). Attaching a 'message' listener only AFTER `await`-ing 'open' can miss it --
//     Node's `ws` is a plain EventEmitter with no replay, so a message emitted before any listener
//     is attached is simply gone, and a test that then waits for exactly that missed frame hangs
//     until its own timeout. Confirmed by writing a standalone script that attaches its listener
//     synchronously at construction (this file's own `connect()` below now does the same, via
//     FrameCollector) and never misses the frame. FrameCollector attaches ONE 'message' listener
//     synchronously when the WebSocket is constructed, before any `await` gives the connection a
//     chance to progress, so no frame -- however fast the server answers -- can arrive unheard.

import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildServer } from '../../server';
import type { RouteMode } from '../../split';
import type { TerminalWsServerEvent } from '../../../../contract/ws/terminal';
import { manager as terminalManager } from './manager';

const P_TEST_TOKEN = 'terminal-ws-gate-test-token-0123456789';
const WORKSPACE_ID = 'ws-gate-test';
const TEST_TIMEOUT_MS = 20000;

let dataRoot: string;
let workspaceDir: string;
let engine: FastifyInstance;
let wsBaseUrl: string;
let sandboxDir: string;
let savedAppData: string | undefined;
let savedUserProfile: string | undefined;
let savedHome: string | undefined;

beforeAll(async () => {
  // Real OUTPUTS_WORKSPACE_DIR-shaped directory so workspaceCwd.ts's real resolution (not a
  // fallback to homedir()) is what the gate exercises -- MAESTRO_DATA_ROOT is how both the real
  // backend and this engine agree on that root (auth/token.ts's resolveDataRoot()).
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-terminal-ws-gate-'));
  workspaceDir = join(dataRoot, 'outputs_workspace', WORKSPACE_ID);
  mkdirSync(workspaceDir, { recursive: true });
  process.env.MAESTRO_DATA_ROOT = dataRoot;

  // See this file's header, point (1) -- sandbox the real shells this suite spawns away from the
  // developer's actual PowerShell profile/history.
  sandboxDir = mkdtempSync(join(tmpdir(), 'maestro-terminal-ws-shellenv-'));
  savedAppData = process.env.APPDATA;
  savedUserProfile = process.env.USERPROFILE;
  savedHome = process.env.HOME;
  process.env.APPDATA = sandboxDir;
  process.env.USERPROFILE = sandboxDir;
  process.env.HOME = sandboxDir;

  const routes = new Map<string, RouteMode>([['terminal', 'native']]);
  engine = buildServer({ port: 0, host: '127.0.0.1', routes, backendPort: null, authToken: P_TEST_TOKEN });
  const address = await engine.listen({ port: 0, host: '127.0.0.1' });
  wsBaseUrl = address.replace(/^http/, 'ws');
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await engine.close();
  delete process.env.MAESTRO_DATA_ROOT;
  // maxRetries/retryDelay: workspaceDir IS the real spawned shells' cwd, and node-pty's Windows
  // kill() path can take up to ~5s to actually release it when its own internal console-process-
  // list helper fails (a real, observed "AttachConsole failed" crash in that helper -- harmless,
  // node-pty's fallback still kills the real process after its own 5s timeout) -- budget well past
  // that worst case rather than a flaky EPERM. fs.rmSync's own retry options are unreliable on
  // Windows (confirmed empirically: identical EPERM failures at maxRetries 10 and 20 alike, no
  // observable extra delay) -- the async fs/promises `rm` is the one that actually retries.
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  // See the dataRoot cleanup above for why this is the async `rm`, not `rmSync`.
  await rm(sandboxDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}, 30000);

afterEach(async () => {
  // Awaited: stopAll() now waits for each real OS process to confirm exit (bounded) -- see
  // ptySession.ts's header on why fire-and-forget can leak a real orphaned pwsh.exe on Windows.
  const killed = await terminalManager.stopAll();
  if (killed > 0) console.log(`[test] ws.test.ts afterEach: killed ${killed} real shells`);
}, 15000);

/** A PowerShell fragment that PRINTS `marker` without it ever appearing as a contiguous substring
 * in the command text itself -- see this file's header, point (2). */
function probeCommand(marker: string): string {
  const mid = Math.floor(marker.length / 2) || 1;
  return `Write-Output ("${marker.slice(0, mid)}" + "${marker.slice(mid)}")`;
}

/** Wraps a WebSocket and attaches its 'message' listener SYNCHRONOUSLY at construction, so no
 * frame can ever be missed regardless of how fast the server answers -- see this file's header,
 * point (3). Every already-collected frame is checked first; only a not-yet-seen predicate waits
 * on a fresh listener. */
class FrameCollector {
  readonly ws: WebSocket;
  private readonly frames: TerminalWsServerEvent[] = [];
  private waiters: Array<{ predicate: (frame: TerminalWsServerEvent) => boolean; resolve: (frames: TerminalWsServerEvent[]) => void }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as TerminalWsServerEvent;
      this.frames.push(frame);
      const remaining: typeof this.waiters = [];
      for (const waiter of this.waiters) {
        if (waiter.predicate(frame)) waiter.resolve([...this.frames]);
        else remaining.push(waiter);
      }
      this.waiters = remaining;
    });
  }

  open(): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      this.ws.once('open', () => resolvePromise());
      this.ws.once('error', reject);
    });
  }

  waitFor(predicate: (frame: TerminalWsServerEvent) => boolean, timeoutMs = TEST_TIMEOUT_MS): Promise<TerminalWsServerEvent[]> {
    const already = this.frames.find(predicate);
    if (already) return Promise.resolve([...this.frames]);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for a matching frame; got ${JSON.stringify(this.frames)}`)),
        timeoutMs,
      );
      this.waiters.push({ predicate, resolve: (frames) => { clearTimeout(timer); resolvePromise(frames); } });
    });
  }

  send(payload: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.ws.close();
  }

  waitForClose(): Promise<void> {
    return new Promise((resolvePromise) => this.ws.once('close', () => resolvePromise()));
  }
}

function connect(instance: number): FrameCollector {
  return new FrameCollector(`${wsBaseUrl}/ws/terminal/${WORKSPACE_ID}?token=${P_TEST_TOKEN}&instance=${instance}`);
}

function decodedOutputText(frames: TerminalWsServerEvent[]): string {
  return frames
    .filter((f) => f.event === 'term:output')
    .map((f) => Buffer.from((f as { data: { data: string } }).data.data, 'base64').toString('utf8'))
    .join('');
}

function sendInput(client: FrameCollector, text: string): void {
  client.send({ event: 'term:input', data: { data: Buffer.from(text, 'utf8').toString('base64') } });
}

describe('handleTerminalWsUpgrade -- the real gate (spawn -> echo -> resize -> exit -> kill)', () => {
  test('term:status arrives first, reflecting the real resolved shell and the real resolved workspace cwd', async () => {
    const client = connect(1);
    await client.open();
    const frames = await client.waitFor((f) => f.event === 'term:status');
    const status = frames.find((f) => f.event === 'term:status');
    expect(status).toBeDefined();
    if (status && status.event === 'term:status') {
      expect(status.data.running).toBe(true);
      expect(status.data.shell.length).toBeGreaterThan(0);
      expect(status.data.cwd).toBe(workspaceDir);
    }
    client.close();
  }, TEST_TIMEOUT_MS);

  test('a real command round-trips: term:input in, term:output out, base64-decoded to the real executed result', async () => {
    const client = connect(2);
    await client.open();
    await client.waitFor((f) => f.event === 'term:status');

    const marker = 'hello-through-the-real-ws-gate';
    const outputPromise = client.waitFor((f) => f.event === 'term:output' && Buffer.from((f as { data: { data: string } }).data.data, 'base64').toString('utf8').includes(marker));
    sendInput(client, `${probeCommand(marker)}\r\n`);
    const frames = await outputPromise;
    expect(decodedOutputText(frames)).toContain(marker);
    client.close();
  }, TEST_TIMEOUT_MS);

  test('term:resize does not break the session -- a command sent afterward still round-trips', async () => {
    const client = connect(3);
    await client.open();
    await client.waitFor((f) => f.event === 'term:status');

    client.send({ event: 'term:resize', data: { cols: 120, rows: 40 } });

    const marker = 'after-real-resize-marker';
    const outputPromise = client.waitFor((f) => f.event === 'term:output' && Buffer.from((f as { data: { data: string } }).data.data, 'base64').toString('utf8').includes(marker));
    sendInput(client, `${probeCommand(marker)}\r\n`);
    const frames = await outputPromise;
    expect(decodedOutputText(frames)).toContain(marker);
    expect(terminalManager.get(WORKSPACE_ID, 3)?.running).toBe(true);
    client.close();
  }, TEST_TIMEOUT_MS);

  test('exiting the real shell delivers term:exit with the real exit code', async () => {
    const client = connect(4);
    await client.open();
    await client.waitFor((f) => f.event === 'term:status');

    const exitPromise = client.waitFor((f) => f.event === 'term:exit');
    sendInput(client, 'exit 0\r\n');
    const frames = await exitPromise;
    const exitFrame = frames.find((f) => f.event === 'term:exit');
    expect(exitFrame && exitFrame.event === 'term:exit' ? exitFrame.data.code : undefined).toBe(0);
    expect(terminalManager.get(WORKSPACE_ID, 4)?.running).toBe(false);
    client.close();
  }, TEST_TIMEOUT_MS);

  test('closing the socket detaches but does NOT kill the shell -- reconnecting resumes the same session', async () => {
    const first = connect(5);
    await first.open();
    await first.waitFor((f) => f.event === 'term:status');
    const session = terminalManager.get(WORKSPACE_ID, 5);
    expect(session?.running).toBe(true);

    const closed = first.waitForClose();
    first.close();
    await closed;
    expect(session?.running).toBe(true); // detach must not stop it

    const second = connect(5);
    await second.open();
    const frames = await second.waitFor((f) => f.event === 'term:status');
    const status = frames.find((f) => f.event === 'term:status');
    expect(status && status.event === 'term:status' ? status.data.running : false).toBe(true);
    expect(terminalManager.get(WORKSPACE_ID, 5)).toBe(session); // same session, not respawned
    second.close();
  }, TEST_TIMEOUT_MS);
});
