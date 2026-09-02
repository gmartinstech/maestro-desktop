// engine/src/apps/outputs/runtime.ts -- SUB-5, a TypeScript port of backend/apps/outputs/
// runtime.py: the per-workspace persistent app runtime (spawns `bash run.sh` / a bare vite / a
// legacy `python -u backend.py`), one AppRuntime per workspace, refcounted by a manager singleton.
//
// Node has no asyncio; AsyncLock (agents/manager/run/clientPool.ts) is this codebase's existing
// `asyncio.Lock`-equivalent, reused here rather than re-invented, same as runtimeProc.ts/
// runtimeLedger.ts reuse the async-primitive conventions the rest of this engine already
// established. Process wait/exit is the Node 'exit' event instead of `await process.wait()`.
//
// See runtimeProc.ts's own header for the Windows signal-semantics stance (suspend/resume no-op on
// Windows, kill_descendant_tree === `taskkill /T /F`) -- this file just calls into that module,
// it does not re-derive any of it.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as pathResolve, sep as pathSep } from 'node:path';
import { createConnection } from 'node:net';
import { AsyncLock } from '../../agents/manager/run/clientPool';
import { stateDir } from '../../agents/manager/statePaths';
import { resolveBackendPythonPath } from '../../pythonBackend';
import { forget as ledgerForget, reclaimPort, recordSpawn } from './runtimeLedger';
import {
  ERROR_PATTERNS,
  FRONTEND_BIND_POLL_INTERVAL_MS,
  FRONTEND_BIND_TIMEOUT_MS,
  LOG_BUFFER_LINES,
  MAX_IDLE_RUNTIMES,
  RECENT_ERRORS_MAX,
  TERMINATE_GRACE_MS,
  ensureForcePortShim,
  findFreePort,
  isNewMode,
  isPortFree,
  killDescendantTree,
  killListenerOnPort,
  killProcessesUnderWorkspace,
  readEnvValue,
  resumeProcessTree,
  spawnOptions,
  suspendProcessTree,
  writeEnvValue,
} from './runtimeProc';

// Module-level lock so only ONE vite optimizeDeps runs at a time; must be acquired before
// manager's own lock to avoid deadlock with attach().
const pViteBootLock = new AsyncLock();

const RESTART_SENTINEL_POLL_MS = 1000;
const RESTART_SENTINEL_NAME = 'restart-requested';

export type LogStream = 'stdout' | 'stderr' | 'runtime' | 'frontend' | 'frontend-warn' | 'frontend-error';

export interface LogLine {
  stream: LogStream;
  text: string;
}

const TERMINAL_LOG_MAX_BYTES = 4 * 1024 * 1024;

const TERMINAL_LOG_PREFIXES: Record<string, string> = {
  stdout: '[BACKEND]',
  stderr: '[BACKEND:stderr]',
  runtime: '[RUNTIME]',
  frontend: '[FRONTEND]',
  'frontend-warn': '[FRONTEND:warn]',
  'frontend-error': '[FRONTEND:error]',
};

export type LogSubscriber = (line: LogLine) => void;

/** Registry key for a workspace instance -- instance 1 keeps the bare workspace_id. */
export function runtimeKey(workspaceId: string, instance: number): string {
  return instance <= 1 ? workspaceId : `${workspaceId}#${instance}`;
}

/** Resolve an invokable bash for `bash run.sh`. Windows: Node's spawn uses the same OS-level
 * CreateProcess PATH search Python's subprocess does, so a bash entry on a POSIX-style PATH
 * segment (Git-for-Windows's own `/mingw64/bin/...` convention) is invisible to it the same way --
 * this ports the exact same manual-PATH-scan + conventional-install-path fallback runtime.py uses,
 * not a different mechanism. */
function pResolveBash(): string {
  const found = pWhichOnPath('bash', process.platform === 'win32' ? ['.exe'] : ['']);
  if (found) return found;
  if (process.platform === 'win32') {
    for (const candidate of [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'bash';
}

function pWhichOnPath(name: string, extensions: string[]): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Not there; keep scanning.
      }
    }
  }
  return null;
}

function pWhichNode(): string | null {
  return pWhichOnPath('node', process.platform === 'win32' ? ['.exe', ''] : ['']);
}

class AppRuntime {
  readonly workspaceId: string;
  workspacePath: string;
  readonly instance: number;
  port: number | null = null;
  frontendPort: number | null = null;
  private frontendReady = false;
  suspended = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private childExited = false;
  private childExitPromise: Promise<void> | null = null;
  private resolveChildExit: (() => void) | null = null;
  readonly logBuffer: LogLine[] = [];
  readonly terminalLogPath: string;
  private terminalLogBytes = 0;
  private readonly subscribers = new Set<LogSubscriber>();
  readonly recentErrors: string[] = [];
  readonly frontendErrors: string[] = [];
  renderState: 'ok' | 'error' | null = null;
  renderErrorText = '';
  private frontendReadyController: AbortController | null = null;
  readonly lock = new AsyncLock();

  constructor(workspaceId: string, workspacePath: string, instance = 1) {
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.instance = Math.max(1, instance);
    const logName = this.instance <= 1 ? 'terminal.log' : `terminal-${this.instance}.log`;
    this.terminalLogPath = stateDir(workspacePath, logName);
  }

  drainErrors(): string[] {
    const out = [...this.recentErrors];
    this.recentErrors.length = 0;
    return out;
  }

  drainFrontendErrors(): string[] {
    const out = [...this.frontendErrors];
    this.frontendErrors.length = 0;
    return out;
  }

  setRenderOk(): void {
    this.renderState = 'ok';
    this.renderErrorText = '';
  }

  setRenderError(text: string): void {
    this.renderState = 'error';
    this.renderErrorText = (text ?? '').trim();
  }

  resetRenderState(): void {
    this.renderState = null;
    this.renderErrorText = '';
  }

  get running(): boolean {
    return this.child !== null && !this.childExited;
  }

  get hasBackendFile(): boolean {
    return existsSync(join(this.workspacePath, 'backend.py'));
  }

  get isNewMode(): boolean {
    return isNewMode(this.workspacePath);
  }

  /** The spawned process's pid, or null before start()/after exit -- exposed so
   * AppRuntimeManager can suspend/resume the OS process without this class widening its public
   * surface any further than this one accessor. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get frontendUrl(): string | null {
    if (this.frontendPort && this.frontendReady && this.running && !this.suspended) {
      return `http://127.0.0.1:${this.frontendPort}/`;
    }
    return null;
  }

  async start(): Promise<boolean> {
    return this.lock.withLock(async () => {
      if (this.running) return true;
      await this.pResetTerminalLog();
      if (this.isNewMode) {
        await pViteBootLock.acquire();
        try {
          const ok = await this.pStartNewMode();
          if (!ok) pViteBootLock.release();
          return ok;
        } catch (err) {
          pViteBootLock.release();
          throw err;
        }
      }
      return this.pStartOldMode();
    });
  }

  private async pStartNewMode(): Promise<boolean> {
    ensureForcePortShim(this.workspacePath);
    const envPath = join(this.workspacePath, '.env');
    const fpRaw = readEnvValue(envPath, 'FRONTEND_PORT');
    const bpRaw = readEnvValue(envPath, 'BACKEND_PORT');

    if (this.instance > 1) {
      this.frontendPort = await findFreePort();
      this.port = bpRaw && bpRaw !== 'NONE' ? await findFreePort() : null;
    } else {
      this.frontendPort = fpRaw ? Number(fpRaw) : NaN;
      if (!Number.isFinite(this.frontendPort) || this.frontendPort <= 0) this.frontendPort = await findFreePort();
      if (this.frontendPort && !(await isPortFree(this.frontendPort))) {
        await this.pReclaimSquattedPort(this.frontendPort);
      }
      if (this.frontendPort && !(await isPortFree(this.frontendPort))) {
        const newPort = await findFreePort();
        this.pBroadcast({ stream: 'runtime', text: `[runtime] persisted FRONTEND_PORT ${this.frontendPort} is in use; reallocating to ${newPort}` });
        this.frontendPort = newPort;
        writeEnvValue(envPath, 'FRONTEND_PORT', String(newPort));
      }
      if (bpRaw && bpRaw !== 'NONE') {
        const parsed = Number(bpRaw);
        this.port = Number.isFinite(parsed) ? parsed : null;
        if (this.port && !(await isPortFree(this.port))) {
          await this.pReclaimSquattedPort(this.port);
        }
        if (this.port && !(await isPortFree(this.port))) {
          const newPort = await findFreePort();
          this.pBroadcast({ stream: 'runtime', text: `[runtime] persisted BACKEND_PORT ${this.port} is in use; reallocating to ${newPort}` });
          this.port = newPort;
          writeEnvValue(envPath, 'BACKEND_PORT', String(newPort));
        }
      } else {
        this.port = null;
      }
    }

    const env = this.pSpawnEnvBase();
    if (this.instance > 1) {
      env.MAESTRO_FORCE_FRONTEND_PORT = String(this.frontendPort);
      if (this.port) env.MAESTRO_FORCE_BACKEND_PORT = String(this.port);
    }
    // Lazy import, mirrors runtime.py's own late `from backend.apps.outputs.view_builder_templates
    // import ...` -- avoids a module-load-order dependency on viewBuilderTemplates.ts's own
    // background cache-warm kickoff running before this module needs it.
    const { DEBUGGER_PATH, TEMPLATE_BACKEND_PATH } = await import('./viewBuilderTemplates');
    env.MAESTRO_DEBUGGER_PATH = DEBUGGER_PATH;
    env.MAESTRO_TEMPLATE_BACKEND_PATH = TEMPLATE_BACKEND_PATH;

    const { cmd, spawnCwd, launchDesc } = this.pResolveLaunch(env);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cmd[0], cmd.slice(1), { ...spawnOptions(), cwd: spawnCwd, env });
    } catch (e) {
      this.pBroadcast({ stream: 'runtime', text: `[runtime] failed to start: ${String(e)}` });
      this.frontendPort = null;
      this.port = null;
      this.child = null;
      return false;
    }
    if (child.pid === undefined) {
      this.pBroadcast({ stream: 'runtime', text: '[runtime] failed to start: no pid assigned' });
      this.frontendPort = null;
      this.port = null;
      this.child = null;
      return false;
    }
    this.pAttachChild(child);
    await recordSpawn(child.pid, this.workspaceId, this.instance, this.frontendPort);
    const backendNote = this.port ? ` + backend on ${this.port}` : '';
    this.pBroadcast({ stream: 'runtime', text: `[runtime] ${launchDesc} started; frontend on ${this.frontendPort}${backendNote} (pid ${child.pid})` });
    this.frontendReady = false;
    void this.pAwaitFrontendBind();
    return true;
  }

  private async pReclaimSquattedPort(port: number): Promise<void> {
    if (await reclaimPort(port)) {
      this.pBroadcast({ stream: 'runtime', text: `[runtime] port ${port} was held by an orphaned runtime from a previous session; reclaimed it` });
    }
  }

  /** Pick the new-mode launch command: default `bash run.sh`; on Windows, for a frontend-only app
   * with vite already linked, spawn vite directly through the bundled node (no system bash at all)
   * -- see runtime.py's own comment: the packaged Windows build ships node but not bash. */
  private pResolveLaunch(env: NodeJS.ProcessEnv): { cmd: string[]; spawnCwd: string; launchDesc: string } {
    if (process.platform === 'win32' && this.port === null) {
      const node = (env.MAESTRO_NODE_PATH && existsSync(env.MAESTRO_NODE_PATH)) ? env.MAESTRO_NODE_PATH : pWhichNode();
      const viteBin = join(this.workspacePath, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
      if (node && existsSync(node) && existsSync(viteBin)) {
        env.FRONTEND_PORT = String(this.frontendPort);
        env.BACKEND_PORT = 'NONE';
        return { cmd: [node, 'node_modules/vite/bin/vite.js'], spawnCwd: join(this.workspacePath, 'frontend'), launchDesc: 'vite (bundled node, no bash)' };
      }
    }
    return { cmd: [pResolveBash(), 'run.sh'], spawnCwd: this.workspacePath, launchDesc: 'bash run.sh' };
  }

  private async pAwaitFrontendBind(): Promise<void> {
    let lockReleased = false;
    const releaseBootLock = (): void => {
      if (lockReleased) return;
      lockReleased = true;
      try {
        pViteBootLock.release();
      } catch {
        // Already released.
      }
    };
    try {
      if (!this.frontendPort) return;
      const port = this.frontendPort;
      const deadline = Date.now() + FRONTEND_BIND_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.child === null || this.childExited) return;
        if (await pProbeConnect(port, 500)) {
          this.frontendReady = true;
          this.pBroadcast({ stream: 'runtime', text: `[runtime] frontend ready at http://127.0.0.1:${port}/` });
          releaseBootLock();
          return;
        }
        await pSleep(FRONTEND_BIND_POLL_INTERVAL_MS);
      }
      this.pBroadcast({ stream: 'runtime', text: `[runtime] frontend did NOT bind on port ${port} after ${FRONTEND_BIND_TIMEOUT_MS / 1000}s; check the Terminal for npm/vite errors.` });
    } finally {
      releaseBootLock();
    }
  }

  private async pStartOldMode(): Promise<boolean> {
    if (!this.hasBackendFile) {
      this.port = null;
      return false;
    }
    this.port = await findFreePort();
    const env = this.pSpawnEnvBase();
    env.PORT = String(this.port);
    env.BACKEND_PORT = String(this.port);
    // Hand the legacy backend.py the exact interpreter this engine's own backend runs on (the
    // bundled venv in a packaged build, the dev venv otherwise) -- mirrors runtime.py's own
    // `sys.executable`, sidestepping the Windows `python`/`python3` Microsoft-Store-alias shim a
    // bare command name can resolve to instead of a real interpreter.
    const resolvedPython = resolveBackendPythonPath();
    const pythonExe = existsSync(resolvedPython) ? resolvedPython : (process.env.MAESTRO_PYTHON || 'python');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(pythonExe, ['-u', 'backend.py'], { ...spawnOptions(), cwd: this.workspacePath, env });
    } catch (e) {
      this.pBroadcast({ stream: 'runtime', text: `[runtime] failed to start: ${String(e)}` });
      this.port = null;
      this.child = null;
      return false;
    }
    if (child.pid === undefined) {
      this.port = null;
      this.child = null;
      return false;
    }
    this.pAttachChild(child);
    await recordSpawn(child.pid, this.workspaceId, this.instance, null);
    this.pBroadcast({ stream: 'runtime', text: `[runtime] backend started on port ${this.port} (pid ${child.pid})` });
    return true;
  }

  private pSpawnEnvBase(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'MAESTRO_AUTH_TOKEN') continue;
      env[k] = v;
    }
    const resolvedPython = resolveBackendPythonPath();
    env.MAESTRO_PYTHON = existsSync(resolvedPython) ? resolvedPython : (process.env.MAESTRO_PYTHON || 'python');
    // Force npm to skip dependency lifecycle scripts for every install run.sh triggers -- an
    // imported/agent-authored app's package.json is untrusted, so a malicious postinstall must
    // never get to run arbitrary code the moment its preview boots.
    env.npm_config_ignore_scripts = 'true';
    return env;
  }

  private pAttachChild(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    this.childExited = false;
    this.childExitPromise = new Promise((resolve) => {
      this.resolveChildExit = resolve;
    });
    createInterface({ input: child.stdout }).on('line', (text) => this.pOnLine('stdout', text));
    createInterface({ input: child.stderr }).on('line', (text) => this.pOnLine('stderr', text));
    child.on('exit', (code) => {
      this.childExited = true;
      this.frontendReady = false;
      this.pBroadcast({ stream: 'runtime', text: `[runtime] backend exited with code ${code ?? 'unknown'}` });
      this.resolveChildExit?.();
    });
    child.on('error', () => {
      // A post-spawn error (e.g. EPIPE) still needs the exit-wait to resolve, matching the
      // Python original's `await process.wait()` always eventually returning.
      this.childExited = true;
      this.resolveChildExit?.();
    });
  }

  private pOnLine(name: 'stdout' | 'stderr', text: string): void {
    const trimmed = text.replace(/[\r\n]+$/, '');
    if (!trimmed) return;
    this.pBroadcast({ stream: name, text: trimmed });
    if (ERROR_PATTERNS.test(trimmed)) {
      this.recentErrors.push(trimmed);
      if (this.recentErrors.length > RECENT_ERRORS_MAX) this.recentErrors.shift();
    }
    if (trimmed.includes('[maestro:app-ready]')) {
      this.setRenderOk();
    } else if (trimmed.includes('[maestro:app-error]')) {
      const idx = trimmed.indexOf('[maestro:app-error]') + '[maestro:app-error]'.length;
      this.setRenderError(trimmed.slice(idx).trim());
    }
  }

  async stop(): Promise<void> {
    await this.lock.withLock(async () => {
      if (!this.child || this.childExited) {
        if (this.child?.pid) ledgerForget(this.child.pid);
        return;
      }
      const pid = this.child.pid as number;
      await killDescendantTree(pid, 'TERM');
      try {
        this.child.kill();
      } catch {
        // Already gone.
      }
      const exited = await pRaceTimeout(this.childExitPromise ?? Promise.resolve(), TERMINATE_GRACE_MS);
      if (!exited) {
        await killDescendantTree(pid, 'KILL');
        try {
          this.child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
        await (this.childExitPromise ?? Promise.resolve());
      }
      // Windows-only supplementary sweeps -- see killListenerOnPort's and
      // killProcessesUnderWorkspace's own headers: the direct child's kill above does not reliably
      // reach a new-mode (webapp_template) app's real vite/esbuild descendants, because Git-Bash's
      // fork() emulation for run.sh's backgrounded, piped pipeline breaks Win32's own
      // ParentProcessId chain. Path-based sweep first (catches frontend/run.sh unconditionally,
      // whether or not it has bound a port yet -- the gap port-based sweep alone cannot cover, e.g.
      // stopping mid-`npm install`); port-based sweep second (catches anything already listening,
      // including a case the path sweep can't name: a bare `npm install`/vite process whose own
      // command line never mentions the workspace path). Both no-ops on POSIX and whenever nothing
      // was ever allocated (old-mode / never-started runtimes).
      await killProcessesUnderWorkspace(this.workspacePath);
      await killListenerOnPort(this.frontendPort);
      await killListenerOnPort(this.port);
      this.frontendReady = false;
      ledgerForget(pid);
    });
  }

  async restart(): Promise<boolean> {
    await this.stop();
    return this.start();
  }

  subscribe(cb: LogSubscriber): () => void {
    this.subscribers.add(cb);
    for (const line of this.logBuffer) {
      try {
        cb(line);
      } catch {
        // Best-effort.
      }
    }
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private pBroadcast(line: LogLine): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > LOG_BUFFER_LINES) this.logBuffer.shift();
    void this.pAppendTerminalLog(line);
    for (const cb of [...this.subscribers]) {
      try {
        cb(line);
      } catch {
        // Best-effort.
      }
    }
  }

  announce(text: string): void {
    this.pBroadcast({ stream: 'runtime', text });
  }

  recordFrontendLog(level: string, text: string): void {
    const stream: LogStream = level === 'warn' ? 'frontend-warn' : level === 'error' ? 'frontend-error' : 'frontend';
    if (stream === 'frontend-error' && !text.includes('[maestro:app-')) {
      this.frontendErrors.push(text.replace(/\s+$/, ''));
      if (this.frontendErrors.length > RECENT_ERRORS_MAX) this.frontendErrors.shift();
    }
    this.pBroadcast({ stream, text });
  }

  private async pResetTerminalLog(): Promise<void> {
    try {
      mkdirSync(dirname(this.terminalLogPath), { recursive: true });
      await writeFile(this.terminalLogPath, '# App terminal output (backend stdout/stderr, runtime events, frontend console). Reset on every app start.\n', 'utf8');
      this.terminalLogBytes = 0;
    } catch {
      // Best-effort.
    }
  }

  private async pAppendTerminalLog(line: LogLine): Promise<void> {
    try {
      const prefix = TERMINAL_LOG_PREFIXES[line.stream] ?? `[${line.stream}]`;
      const rendered = `${prefix} ${line.text}\n`;
      if (this.terminalLogBytes > TERMINAL_LOG_MAX_BYTES) {
        let rewritten = '';
        for (const old of this.logBuffer) {
          rewritten += `${TERMINAL_LOG_PREFIXES[old.stream] ?? `[${old.stream}]`} ${old.text}\n`;
        }
        await writeFile(this.terminalLogPath, rewritten, 'utf8');
        this.terminalLogBytes = Buffer.byteLength(rewritten, 'utf8');
        return;
      }
      await appendFile(this.terminalLogPath, rendered, 'utf8');
      this.terminalLogBytes += Buffer.byteLength(rendered, 'utf8');
    } catch {
      // Best-effort; a log tee must never break the pipeline.
    }
  }
}

function pSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Non-blocking connect probe with its own timeout, the Node equivalent of asyncio.open_connection
 * wrapped in wait_for. */
function pProbeConnect(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolveProbe(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

/** Race a promise against a timeout; returns true if the promise settled first. */
function pRaceTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveRace) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolveRace(false);
      }
    }, timeoutMs);
    void promise.then(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveRace(true);
      }
    });
  });
}

export type { AppRuntime };

class AppRuntimeManager {
  private readonly runtimes = new Map<string, AppRuntime>();
  private readonly attached = new Map<string, number>();
  // Map preserves insertion order in JS, giving the same O(1)-ish move-to-end/pop-oldest LRU
  // semantics Python's OrderedDict gives runtime.py.
  private readonly idleLru = new Map<string, AppRuntime>();
  private readonly lock = new AsyncLock();
  private restartWatchTimer: ReturnType<typeof setInterval> | null = null;

  private ensureRestartWatcher(): void {
    if (this.restartWatchTimer !== null) return;
    this.restartWatchTimer = setInterval(() => {
      void this.pWatchRestartSentinelsTick();
    }, RESTART_SENTINEL_POLL_MS);
    this.restartWatchTimer.unref?.();
  }

  private async pWatchRestartSentinelsTick(): Promise<void> {
    try {
      const seenPaths = new Set<string>();
      for (const rt of this.runtimes.values()) {
        const wsPath = rt.workspacePath;
        if (seenPaths.has(wsPath) || rt.suspended || !rt.running) continue;
        const sentinel = stateDir(wsPath, RESTART_SENTINEL_NAME);
        if (!existsSync(sentinel)) continue;
        seenPaths.add(wsPath);
        try {
          unlinkSync(sentinel);
        } catch {
          continue;
        }
        for (const peer of this.runtimes.values()) {
          if (peer.workspacePath === wsPath && peer.running && !peer.suspended) {
            peer.announce("[runtime] restart requested from the workspace (restart.sh); restarting...");
            void peer.restart();
          }
        }
      }
    } catch (err) {
      console.error('[outputs] restart-sentinel watcher tick failed:', err);
    }
  }

  /** Public: tests / shutdown can stop the watcher. */
  stopRestartWatcher(): void {
    if (this.restartWatchTimer !== null) {
      clearInterval(this.restartWatchTimer);
      this.restartWatchTimer = null;
    }
  }

  async attach(workspaceId: string, workspacePath: string, instance = 1): Promise<AppRuntime> {
    this.ensureRestartWatcher();
    const key = runtimeKey(workspaceId, instance);
    let revived = false;
    let dead: AppRuntime | null = null;
    let rt: AppRuntime;
    await this.lock.withLock(async () => {
      const existing = this.runtimes.get(key);
      if (existing === undefined) {
        const idleRt = this.idleLru.get(key);
        this.idleLru.delete(key);
        if (idleRt !== undefined && idleRt.running) {
          rt = idleRt;
          rt.workspacePath = workspacePath;
          this.runtimes.set(key, rt);
          revived = true;
          resumeProcessTree(rt.pid);
          rt.suspended = false;
        } else {
          if (idleRt !== undefined) dead = idleRt;
          rt = new AppRuntime(workspaceId, workspacePath, instance);
          this.runtimes.set(key, rt);
        }
      } else {
        existing.workspacePath = workspacePath;
        rt = existing;
      }
      this.attached.set(key, (this.attached.get(key) ?? 0) + 1);
    });
    if (!revived && !rt!.running) await rt!.start();
    if (dead !== null) {
      try {
        await (dead as AppRuntime).stop();
      } catch (err) {
        console.error(`[outputs] failed to reap dead idle runtime ${key}:`, err);
      }
    }
    return rt!;
  }

  async detach(workspaceId: string, instance = 1): Promise<void> {
    const key = runtimeKey(workspaceId, instance);
    const toReap: AppRuntime[] = [];
    await this.lock.withLock(async () => {
      const count = (this.attached.get(key) ?? 0) - 1;
      if (count > 0) {
        this.attached.set(key, count);
        return;
      }
      this.attached.delete(key);
      const rt = this.runtimes.get(key);
      this.runtimes.delete(key);
      if (rt === undefined) return;
      if (!rt.running) {
        toReap.push(rt);
      } else {
        this.idleLru.delete(key);
        this.idleLru.set(key, rt);
        suspendProcessTree(rt.pid);
        rt.suspended = true;
        while (this.idleLru.size > MAX_IDLE_RUNTIMES) {
          const oldestKey = this.idleLru.keys().next().value as string;
          const oldRt = this.idleLru.get(oldestKey) as AppRuntime;
          this.idleLru.delete(oldestKey);
          resumeProcessTree(oldRt.pid);
          toReap.push(oldRt);
        }
      }
    });
    for (const old of toReap) {
      try {
        await old.stop();
      } catch (err) {
        console.error(`[outputs] failed to reap idle runtime ${key}:`, err);
      }
    }
  }

  get(workspaceId: string, instance = 1): AppRuntime | undefined {
    const key = runtimeKey(workspaceId, instance);
    return this.runtimes.get(key) ?? this.idleLru.get(key);
  }

  /** Every runtime whose workspace contains `filePath`, or [] if none does. */
  runtimesOwning(filePath: string): AppRuntime[] {
    if (!filePath) return [];
    let absPath: string;
    try {
      absPath = pathResolve(filePath);
    } catch {
      return [];
    }
    const owning: AppRuntime[] = [];
    for (const rt of [...this.runtimes.values(), ...this.idleLru.values()]) {
      let wsRoot: string;
      try {
        wsRoot = pathResolve(rt.workspacePath);
      } catch {
        continue;
      }
      if (absPath === wsRoot || absPath.startsWith(wsRoot + pathSep)) owning.push(rt);
    }
    return owning;
  }

  drainErrorsForPath(filePath: string): string[] {
    const drained: string[] = [];
    for (const rt of this.runtimesOwning(filePath)) drained.push(...rt.drainErrors());
    return drained;
  }

  drainFrontendErrorsForPath(filePath: string): string[] {
    const drained: string[] = [];
    for (const rt of this.runtimesOwning(filePath)) drained.push(...rt.drainFrontendErrors());
    return drained;
  }

  getRenderStateForWorkspace(workspaceId: string): [string | null, string] {
    const rt = this.runtimes.get(workspaceId) ?? this.idleLru.get(workspaceId);
    if (!rt) return [null, ''];
    return [rt.renderState, rt.renderErrorText];
  }

  resetRenderStateForWorkspace(workspaceId: string): void {
    (this.runtimes.get(workspaceId) ?? this.idleLru.get(workspaceId))?.resetRenderState();
  }

  async restart(workspaceId: string, workspacePath?: string, instance = 1): Promise<AppRuntime | null> {
    const key = runtimeKey(workspaceId, instance);
    const rt = this.runtimes.get(key) ?? this.idleLru.get(key);
    if (!rt) return null;
    if (workspacePath) rt.workspacePath = workspacePath;
    await rt.restart();
    return rt;
  }

  /** Terminate every active + idle workspace subprocess. Parallel via Promise.allSettled; with the
   * per-runtime 3s SIGTERM grace, worst case is one ~3s wait rather than N*3s. Idempotent. */
  async stopAll(): Promise<number> {
    let victims: AppRuntime[] = [];
    await this.lock.withLock(async () => {
      victims = [...this.runtimes.values()];
      for (const rt of this.idleLru.values()) {
        resumeProcessTree(rt.pid);
        victims.push(rt);
      }
      this.runtimes.clear();
      this.idleLru.clear();
      this.attached.clear();
    });
    if (victims.length === 0) return 0;
    await Promise.allSettled(victims.map((rt) => rt.stop()));
    return victims.length;
  }
}

export const manager = new AppRuntimeManager();
export { AppRuntimeManager };
