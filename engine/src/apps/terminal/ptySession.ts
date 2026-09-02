// engine/src/apps/terminal/ptySession.ts -- port of backend/apps/terminal/pty_session.py.
//
// One live shell plus the scrollback needed to survive a reconnect. Buffers raw byte chunks (not
// decoded lines/strings) for the same reason the Python original does: line-splitting corrupts the
// ANSI/cursor-control sequences a real TTY emits. On Windows, @lydell/node-pty (like pywinpty)
// always decodes the ConPTY pipe as UTF-8 internally and hands onData() a `string` -- there is no
// "give me raw bytes" option on this platform (windowsTerminal.js hardcodes `setEncoding('utf8')`
// and only warns, never errors, if a caller tries to override it). Re-encoding that string back to
// a UTF-8 Buffer here is therefore the exact byte-for-byte equivalent of pty_backend.py's
// ConPtyBackend.read(), which does the identical decode-then-re-encode round trip in Python
// (`chunk.encode("utf-8", errors="replace")`), not a lossy shortcut.
//
// Deliberate architectural difference from the Python original, not a scope cut: pywinpty's read()
// blocks a thread, so pty_session.py needs an explicit asyncio.create_task() "pump" loop hopping
// through an executor. node-pty's spawn() is event-driven (onData/onExit fire directly off the
// underlying pipe), so there is no pump loop to write here -- start() just wires the two listeners.
//
// A REAL, verified Windows node-pty quirk `waitForExit()` exists to cover: `IPty.kill()` is
// fire-and-forget, but its actual Windows implementation is NOT synchronous -- internally it forks
// a helper process (`conpty_console_list_agent.js`) to enumerate the console's process list before
// the real native kill runs, and that helper can fail outright ("AttachConsole failed", observed
// repeatedly on this machine under concurrent load); when it does, node-pty falls back to its own
// internal 5-second timeout before actually killing the process. Confirmed empirically (spawn N
// real shells, kill() all, log onExit's own timestamp): onExit reliably fires, but sometimes ~4s
// after kill() was called, never instantly. A caller that fires kill() and then immediately lets
// the OWNING PROCESS exit (main.ts's shutdown() calling process.exit(), or a test runner tearing
// down) can race that delay and leak a real orphaned pwsh.exe -- reproduced for real while writing
// this file's tests (two orphaned `pwsh.exe -NoLogo` processes, parents already gone, found via
// Get-CimInstance well after the test run that spawned them had exited). waitForExit() is the fix:
// it resolves once the pty's own onExit has actually fired (proof the real OS process is gone), so
// manager.ts's stopAll() (used by main.ts's shutdown() and by every test's teardown) can await it
// before letting the process exit, bounded by a safety timeout well past the observed worst case.

import * as pty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import { buildTerminalEnv } from './env';
import { resolveShell } from './shell';

// 256 KB of scrollback. A terminal's reconnect contract is intentionally weaker than the agent
// channel's: anything older than this is gone, exactly as in any terminal emulator.
const RING_BUFFER_MAX_BYTES = 262144;

// Comfortably past node-pty's own observed worst case (~4-4.5s under 9-way concurrent kill()) --
// see this file's header. waitForExit() gives up and warns past this rather than blocking forever,
// so a genuinely stuck kill() can never hang a shutdown indefinitely.
const P_EXIT_CONFIRM_TIMEOUT_MS = 8000;

export type OutputSubscriber = (chunk: Buffer) => void;

/** A pseudo-terminal bound to one workspace card, outliving the sockets that watch it. */
export class PtySession {
  readonly workspaceId: string;
  readonly instance: number;
  private readonly p_cwd: string;
  private readonly p_argv: string[];
  private p_proc: IPty | null = null;
  private readonly p_buffer: Buffer[] = [];
  private p_bufferBytes = 0;
  private readonly p_subscribers = new Set<OutputSubscriber>();
  private p_running = false;
  private p_exitCode: number | null = null;
  private p_exited = false;
  private p_exitWaiters: Array<() => void> = [];

  constructor(workspaceId: string, instance: number, cwd: string) {
    this.workspaceId = workspaceId;
    this.instance = instance;
    this.p_cwd = cwd;
    this.p_argv = resolveShell();
  }

  get running(): boolean {
    return this.p_running;
  }

  get exitCode(): number | null {
    return this.p_exitCode;
  }

  get shell(): string {
    return this.p_argv[0];
  }

  get cwd(): string {
    return this.p_cwd;
  }

  /** Spawn the shell and begin pumping its output. Idempotent, mirroring pty_session.py's start(). */
  start(): void {
    if (this.p_running) return;
    const [file, ...args] = this.p_argv;
    this.p_proc = pty.spawn(file, args, {
      cwd: this.p_cwd,
      env: buildTerminalEnv(),
      cols: 80,
      rows: 24,
    });
    this.p_running = true;
    this.p_proc.onData((data: string) => {
      const chunk = Buffer.from(data, 'utf8');
      this.p_append(chunk);
      this.p_broadcast(chunk);
    });
    this.p_proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.p_running = false;
      this.p_exitCode = exitCode;
      this.p_exited = true;
      // Empty chunk is the sentinel the WS route (ws.ts) turns into term:exit, same contract as
      // pty_session.py's p_pump() finally-block broadcast.
      this.p_broadcast(Buffer.alloc(0));
      const waiters = this.p_exitWaiters;
      this.p_exitWaiters = [];
      for (const resolve of waiters) resolve();
    });
  }

  /** Push a chunk into the ring buffer, evicting whole chunks from the front past the cap. */
  private p_append(chunk: Buffer): void {
    this.p_buffer.push(chunk);
    this.p_bufferBytes += chunk.length;
    while (this.p_bufferBytes > RING_BUFFER_MAX_BYTES && this.p_buffer.length > 0) {
      const dropped = this.p_buffer.shift();
      this.p_bufferBytes -= dropped?.length ?? 0;
    }
  }

  /** Fan out over a snapshot, because a callback may unsubscribe itself mid-dispatch. */
  private p_broadcast(chunk: Buffer): void {
    for (const callback of [...this.p_subscribers]) {
      try {
        callback(chunk);
      } catch (err) {
        console.error(`[terminal] subscriber failed for ${this.workspaceId}/${this.instance}:`, err);
      }
    }
  }

  /** Replay the buffer synchronously, then stream. Returns the unsubscribe function. */
  subscribe(callback: OutputSubscriber): () => void {
    for (const chunk of this.p_buffer) {
      try {
        callback(chunk);
      } catch (err) {
        console.error(`[terminal] replay failed for ${this.workspaceId}/${this.instance}:`, err);
      }
    }
    this.p_subscribers.add(callback);
    return () => {
      this.p_subscribers.delete(callback);
    };
  }

  write(data: Buffer): void {
    if (this.p_proc === null) return;
    this.p_proc.write(data.toString('utf8'));
  }

  resize(cols: number, rows: number): void {
    if (this.p_proc === null) return;
    this.p_proc.resize(cols, rows);
  }

  /** Kill the shell. Safe to call twice. Unlike pty_session.py's stop() there is no reader task to
   * cancel-and-await -- see this file's header for why node-pty has none. Fire-and-forget on
   * purpose (matches the Python original's own synchronous call shape) -- callers that need
   * confirmation the real OS process actually died (manager.ts's stopAll(), used by shutdown
   * paths and test teardown) call waitForExit() afterward instead of relying on this returning. */
  stop(): void {
    this.p_running = false;
    if (this.p_proc !== null) {
      try {
        this.p_proc.kill();
      } catch {
        // already dead -- matches pty_backend.py's ConPtyBackend.kill() swallowing this
      }
    }
    this.p_subscribers.clear();
  }

  /** Resolves once the real OS process has actually exited (onExit fired) -- immediately if it
   * already has (including "never started"). See this file's header for why this is NOT the same
   * moment stop() returns on Windows. Bounded by P_EXIT_CONFIRM_TIMEOUT_MS so a caller can never
   * hang forever on a stuck kill(); logs a warning rather than silently giving up unnoticed. */
  waitForExit(timeoutMs = P_EXIT_CONFIRM_TIMEOUT_MS): Promise<void> {
    if (this.p_exited || this.p_proc === null) return Promise.resolve();
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        console.error(`[terminal] ${this.workspaceId}/${this.instance}: real process exit not confirmed within ${timeoutMs}ms of stop() -- node-pty's Windows kill() can be delayed (see this file's header); giving up waiting so the caller is not blocked forever. The OS process may still die shortly after.`);
        resolvePromise();
      }, timeoutMs);
      timer.unref?.();
      this.p_exitWaiters.push(() => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }
}
