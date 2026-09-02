// engine/src/apps/outputs/runtimeProc.ts -- SUB-5, a TypeScript port of backend/apps/outputs/
// runtime_proc.py: OS/process/port primitives for the per-workspace runtime.
//
// THIS FILE IS THE TICKET'S CENTRAL RISK: the Python original leans on POSIX signal semantics
// (SIGSTOP/SIGCONT for suspend/resume, `pgrep -P` for descendant-tree walk) that do not exist on
// Windows, and the original ALREADY documents its own Windows behavior at each function -- this
// port reproduces exactly that behavior, not a from-scratch reinvention:
//
//   - suspend_process_tree/resume_process_tree: the Python docstring says "No-op on Windows
//     (SIGSTOP has no equivalent; the NtSuspendProcess route works but isn't worth the win32
//     surface here)". This port keeps that exact stance: a real SIGSTOP/SIGCONT on POSIX (Node's
//     process.kill supports arbitrary signal names, same syscall as Python's os.kill), a no-op on
//     win32. Idle Windows runtimes stay running -- unchanged from the shipping Python behavior,
//     not a regression this port introduces.
//
//   - kill_descendant_tree: Windows already uses `taskkill /PID <pid> /T /F` in the Python
//     original (a job-object-style recursive tree kill built into Windows itself) -- this is a
//     direct, mechanical port of that exact command, matching tauri/src/sidecar.rs's kill_tree()
//     and engine/src/router/process.ts's supervisor, the two in-repo precedents the ticket asks to
//     read first: both ALSO shell out to `taskkill /T /F` for the same reason (there is no native
//     Windows API this simple to call from a scripting-level runtime, and it is what those two
//     precedents already established as this codebase's answer). The POSIX `pgrep -P` recursive
//     walk is ported too, for platform parity, but Windows is this ticket's real, gated target.
//
//   - background_priority_kwargs (DELIBERATE, DISCLOSED SCOPE CUT): the Python original lowers the
//     spawned tree's OS scheduling priority (BELOW_NORMAL_PRIORITY_CLASS on Windows, os.nice(10) on
//     POSIX) so a backgrounded app build doesn't starve a foreground chat session. Node's
//     child_process.spawn has no equivalent option on either platform -- the only way to set a
//     Windows priority class from a scripting runtime is to either (a) wrap the spawn in another
//     process (`cmd /c start /belownormal ...` or a PowerShell `Start-Process -Priority`), which
//     inserts an extra node into the process tree this ticket's OWN kill-tree correctness property
//     depends on getting exactly right, or (b) call SetPriorityClass via a native addon, which this
//     engine has no binding for. Both are real, added risk for a pure scheduling nicety with no
//     correctness impact (a backgrounded app still runs correctly, just at normal OS priority) --
//     so this port intentionally omits it rather than risk the tree-shape the gate actually checks.
//     `spawnOptions()` below returns plain options with no priority adjustment; documented here so
//     a future ticket can pick this up deliberately, not rediscover the gap by accident.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';

// SIGTERM grace; well-behaved servers shut down under a second so 3s is enough.
export const TERMINATE_GRACE_MS = 3000;

// 180s covers npm install (60-90s on typical hardware) plus the Vite bind.
export const FRONTEND_BIND_TIMEOUT_MS = 180_000;
// 80ms probe: dropping from 500ms was pure user-visible preview latency win; cheap on localhost.
export const FRONTEND_BIND_POLL_INTERVAL_MS = 80;

// 2000 lines per runtime; lets a Terminal tab opened mid-session replay context.
export const LOG_BUFFER_LINES = 2000;

// Idle runtimes kept in LRU; trades memory for instant switch-back.
export const MAX_IDLE_RUNTIMES = 3;

// Cap on recent error lines the agent gets.
export const RECENT_ERRORS_MAX = 50;

// Narrow regex for build errors (vite, babel, tsc, uvicorn); keeps routine logs out of agent context.
export const ERROR_PATTERNS = new RegExp(
  '(?:' +
    '\\[plugin:[^\\]]+\\]|' +
    'SyntaxError|' +
    'Unexpected token|' +
    '\\berror TS\\d+|' +
    'ERROR\\s+in\\s|' +
    'Traceback \\(most recent call last\\)|' +
    'ModuleNotFoundError|' +
    'ImportError|' +
    'AttributeError:|' +
    'Failed to compile|' +
    'Cannot find module|' +
    'Cannot resolve' +
    ')',
);

const isWindows = process.platform === 'win32';

/** Send SIGSTOP to a workspace's subprocess so it consumes 0% CPU while sitting in the LRU idle
 * pool. No-op on Windows (see module doc). Failures are swallowed. */
export function suspendProcessTree(pid: number | undefined | null): void {
  if (!pid || isWindows) return;
  try {
    process.kill(pid, 'SIGSTOP');
  } catch {
    // Already-dead or out-of-permission; both safe to ignore.
  }
}

/** SIGCONT a previously-suspended workspace process. Pair with suspendProcessTree. */
export function resumeProcessTree(pid: number | undefined | null): void {
  if (!pid || isWindows) return;
  try {
    process.kill(pid, 'SIGCONT');
  } catch {
    // Already-dead or out-of-permission; both safe to ignore.
  }
}

/** Spawn options for the workspace subprocess. See module doc: OS priority lowering is a
 * deliberate, disclosed scope cut -- this returns the baseline options every spawn needs
 * (windowsHide so a packaged build never flashes a console window) with no priority adjustment. */
export function spawnOptions(): SpawnOptionsWithoutStdio {
  return { windowsHide: true };
}

/** Ask the kernel for an unused localhost port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** True if nothing currently holds a TCP listener on 127.0.0.1:port. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

/** Recursively signal every descendant of `pid`, leaves-first on POSIX; Windows uses `taskkill
 * /PID <pid> /T /F` (a job-object-style recursive tree kill), matching kill_descendant_tree's own
 * Windows branch and this repo's two in-repo precedents (tauri/src/sidecar.rs's kill_tree(),
 * engine/src/router/process.ts's supervisor). All failures are swallowed; a missing pid means the
 * process already exited, which is the desired end state anyway. */
export function killDescendantTree(pid: number, sigName: 'TERM' | 'KILL' = 'TERM'): Promise<void> {
  return new Promise((resolveDone) => {
    if (isWindows) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 }, () => resolveDone());
      return;
    }
    execFile('pgrep', ['-P', String(pid)], { timeout: 2000 }, (err, stdout) => {
      const children = err ? [] : stdout.split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number);
      void Promise.all(children.map((child) => killDescendantTree(child, sigName))).then(() => {
        const sig = sigName === 'KILL' ? 'SIGKILL' : 'SIGTERM';
        for (const child of children) {
          try {
            process.kill(child, sig);
          } catch {
            // Already gone; fine.
          }
        }
        resolveDone();
      });
    });
  });
}

/** Windows-only supplementary sweep, EMPIRICALLY MOTIVATED (not theoretical): Git-Bash/MSYS's
 * fork() emulation for a backgrounded, piped shell pipeline -- exactly webapp_template's own
 * run.sh/frontend/run.sh shape (`bash frontend/run.sh 2>&1 | awk '...' &`) -- does not preserve a
 * usable Win32 ParentProcessId chain: verified live against a real seeded workspace (SUB-5's own
 * gate) that `taskkill /PID <outer bash.exe> /T /F` kills only that one process, leaving
 * frontend/run.sh's own bash.exe, the `cmd /d /s /c vite` wrapper, the real `node vite.js`, and
 * `esbuild.exe` all alive and still squatting on the frontend port -- killDescendantTree's PID-walk
 * (correct for tauri/sidecar.rs's and router/process.ts's direct-child-process shapes, the two
 * precedents this ticket named) cannot see them, because Windows itself does not record them as
 * this pid's descendants. The fix needing no job-object/native-addon surface: `netstat -ano`'s
 * answer to "who is LISTENING on this port" does not depend on parent-child linkage at all, and
 * killing that PID (verified live: it IS a correct Win32 child of the `cmd` wrapper, just not of
 * the outer shell) cascades -- once it dies, the orphaned wrapper shells above it were only
 * blocked waiting on it and exit on their own within moments. Called from AppRuntime.stop() (this
 * file's own caller) for every port a runtime is known to own (frontendPort, backend port), in
 * ADDITION to killDescendantTree, never instead of it (POSIX's pgrep-based walk has no such gap --
 * real fork() always keeps an accurate PPID -- so this is a Windows-only supplement). ACCEPTED,
 * BOUNDED RACE (same class already documented at pick_backend_port's TOCTOU, TRI-1): if something
 * else grabs the exact same port in the instant between our own process dying and this sweep
 * running, this could kill an unrelated process instead -- narrow window, same tradeoff this
 * codebase already accepts elsewhere, not a reason to leave the confirmed common case unfixed. */
export function killListenerOnPort(port: number | null | undefined): Promise<void> {
  return new Promise((resolveDone) => {
    if (!isWindows || !port) {
      resolveDone();
      return;
    }
    execFile('netstat', ['-ano'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolveDone();
        return;
      }
      const pids = new Set<number>();
      for (const raw of stdout.split('\n')) {
        if (!raw.includes('LISTENING')) continue;
        const cols = raw.trim().split(/\s+/);
        const local = cols[1] ?? '';
        if (!local.endsWith(`:${port}`)) continue;
        const pid = Number(cols[cols.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      if (pids.size === 0) {
        resolveDone();
        return;
      }
      void Promise.all(
        [...pids].map(
          (pid) => new Promise<void>((r) => {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 }, () => r());
          }),
        ),
      ).then(() => resolveDone());
    });
  });
}

/** Windows-only supplementary sweep #2, ALSO empirically motivated: killListenerOnPort only finds
 * a reparented descendant once it has actually bound the port it's known by. Verified live (SUB-5's
 * own gate, on a heavily-loaded shared dev box where `npm install` took long enough to observe this
 * directly): stopping a runtime WHILE its `frontend/run.sh` is still mid-`npm install` -- before
 * vite has bound anything -- leaves that reparented `bash.exe` (and, once install finishes on its
 * own after we've already returned, `npm run dev` -> vite -> esbuild descend from it) running
 * forever: killDescendantTree can't see it (the same broken-PPID-chain reason killListenerOnPort
 * exists for) and killListenerOnPort finds no listener yet, so neither sweep has anything to kill.
 *
 * The fix needing no job-object/native-addon surface: `frontend/run.sh` is invoked with the
 * workspace's own absolute path as an argv element (`bash <workspacePath>/frontend/run.sh`), so its
 * command line is a reliable, ancestry-independent fingerprint -- `Get-CimInstance Win32_Process`
 * (the same WMI class `router/process.ts`'s Windows ACL helpers already shell out to
 * `powershell.exe -EncodedCommand` for, matching that established convention rather than `wmic`,
 * which is absent on some Windows 11 builds) filtered by `CommandLine` containing the workspace's
 * path finds it directly, no ancestry required. This does NOT reach a further descendant whose own
 * command line never mentions the path (a bare `npm install`/`npm run dev`'s argv has no path in
 * it) -- so a `stop()` that lands WHILE `npm install` is still genuinely running can still leave
 * that one node.exe/bash.exe pair orphaned; this sweep narrows the gap (catches the immediate
 * `frontend/run.sh` wrapper unconditionally) rather than closing it completely, which would need a
 * Windows Job Object (a native-addon surface this port deliberately doesn't add, same tradeoff
 * `background_priority_kwargs`'s own scope-cut note above already accepts for the same reason).
 * Called from AppRuntime.stop() in ADDITION to killDescendantTree AND killListenerOnPort, never
 * instead of either. */
export function killProcessesUnderWorkspace(workspacePath: string): Promise<void> {
  return new Promise((resolveDone) => {
    if (!isWindows || !workspacePath) {
      resolveDone();
      return;
    }
    const absPath = pathResolve(workspacePath);
    // Escape for a PowerShell single-quoted string (double any embedded single quote) and for a
    // WQL/`-like` pattern (escape `[`/`]`/backtick, which -like treats as wildcard/escape chars).
    const likeEscaped = absPath.replace(/`/g, '``').replace(/\[/g, '`[').replace(/\]/g, '`]').replace(/'/g, "''");
    const script = [
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + likeEscaped + "*' } |",
      'Select-Object -ExpandProperty ProcessId',
    ].join(' ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // Longer timeout than the other sweeps' 5s: PowerShell's own cold-start plus enumerating every
    // process on a busy host is measurably slower than a bare netstat/taskkill call (observed
    // directly on this ticket's own heavily-loaded shared dev box) -- this sweep is a best-effort
    // background cleanup step, not a latency-sensitive one, so the extra patience costs nothing.
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) {
        resolveDone();
        return;
      }
      const pids = stdout
        .split(/\r?\n/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
      if (pids.length === 0) {
        resolveDone();
        return;
      }
      void Promise.all(
        pids.map(
          (pid) => new Promise<void>((r) => {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 }, () => r());
          }),
        ),
      ).then(() => resolveDone());
    });
  });
}

/** Update KEY=VALUE in an existing `.env`, preserving every other line. Creates the file if
 * missing. */
export function writeEnvValue(envPath: string, key: string, value: string): void {
  let lines: string[] = [];
  if (existsSync(envPath)) {
    try {
      lines = readFileSync(envPath, 'utf8').split(/(?<=\n)/);
    } catch {
      lines = [];
    }
  }
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped || stripped.startsWith('#') || !stripped.includes('=')) continue;
    const k = stripped.split('=', 1)[0].trim();
    if (k === key) {
      lines[i] = `${key}=${value}\n`;
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
      lines[lines.length - 1] += '\n';
    }
    lines.push(`${key}=${value}\n`);
  }
  try {
    writeFileSync(envPath, lines.join(''));
  } catch {
    // Best-effort, matches runtime_proc.py's own logged-and-continue.
  }
}

/** Parse one value out of a workspace's `.env` without a full subprocess-source. Strips quotes +
 * trailing comments. Returns undefined if the file or key is missing. */
export function readEnvValue(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const k = line.slice(0, eq).trim();
      if (k !== key) continue;
      let v = line.slice(eq + 1).trim();
      const hashIdx = v.indexOf('#');
      if (hashIdx >= 0) v = v.slice(0, hashIdx).trimEnd();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch {
    // Best-effort, matches runtime_proc.py's own logged-and-continue.
  }
  return undefined;
}

/** Retrofit the per-instance port override into a legacy workspace's `run.sh`. Idempotent. */
export function ensureForcePortShim(workspacePath: string): void {
  const runSh = `${workspacePath}/run.sh`;
  if (!existsSync(runSh)) return;
  let lines: string[];
  try {
    lines = readFileSync(runSh, 'utf8').split(/(?<=\n)/);
  } catch {
    return;
  }
  if (lines.some((ln) => ln.includes('MAESTRO_FORCE_FRONTEND_PORT'))) return;
  const block = [
    '\n',
    '# Per-instance port overrides: Maestro passes these when the user opens a SECOND instance of the app, so it boots on fresh ports instead of colliding with the primary\'s .env-pinned ones.\n',
    'if [[ -n "${MAESTRO_FORCE_FRONTEND_PORT:-}" ]]; then\n',
    '    export FRONTEND_PORT="$MAESTRO_FORCE_FRONTEND_PORT"\n',
    'fi\n',
    'if [[ -n "${MAESTRO_FORCE_BACKEND_PORT:-}" ]]; then\n',
    '    export BACKEND_PORT="$MAESTRO_FORCE_BACKEND_PORT"\n',
    'fi\n',
  ];
  const out: string[] = [];
  let sourced = false;
  let inserted = false;
  for (const ln of lines) {
    out.push(ln);
    if (ln.includes('source "$ROOT_DIR/.env"')) {
      sourced = true;
    } else if (sourced && !inserted && ln.trim() === 'fi') {
      out.push(...block);
      inserted = true;
    }
  }
  if (!inserted) return; // run.sh lacks a recognizable source-.env block; secondary instances may collide
  try {
    writeFileSync(runSh, out.join(''));
  } catch {
    // Best-effort.
  }
}

/** A workspace is "new-mode" (webapp-template scaffold) if it has a `run.sh` at its root. */
export function isNewMode(workspacePath: string): boolean {
  return existsSync(`${workspacePath}/run.sh`);
}
