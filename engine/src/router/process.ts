// engine/src/router/process.ts -- ENG-6, a faithful TypeScript port of
// backend/apps/nine_router/process.py: the single owner of the 9Router subprocess handle and its
// is_running() cache. Nothing else in this package spawns or kills the subprocess; sync.ts and
// oauth.ts only talk to the already-running server over HTTP.
//
// 9Router is a free AI subscription proxy that lets users connect their Claude/ChatGPT/Gemini
// subscriptions to Maestro without API keys. It runs silently in the background on port 20128 and
// exposes an OpenAI-compatible API at localhost:20128/v1.
//
// This is a 1:1 port, not a rewrite: every comment carried over from process.py describes a real,
// hard-won fix for a real bug (see that file's own header) and is preserved here verbatim or
// near-verbatim. Two mechanical adaptations were unavoidable and are called out at each site:
// (1) Node has no synchronous socket/subprocess-wait API, so a few Python `sync` functions
// (p_tcp_port_open, cli_auth_token, stop) became `async` here; (2) Python's asyncio.Task
// cancellation became an AbortController-based loop here. Neither changes observable behavior.
//
// State that Python tests reach via `patch.object(proc, "name", value)` is exposed here as
// mutable fields on the exported `routerState` object (a TS module has real lexical scoping, so a
// bare `export let` would not let external code observe or override it the way a Python module's
// globals dict does) -- tests mutate `routerState.xyz` directly, mirroring the Python originals.

import { type ChildProcess } from 'node:child_process';
import * as nodeChildProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeNet from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
// ENG-7: fetchWithTimeout below targets 9Router's own loopback port (NINE_ROUTER_*, defined in
// this same file), always-allowed by the provider-egress allowlist -- routed through engineFetch
// like every other outbound call in engine/src, mechanical swap, no behavior change.
import { engineFetch } from '../net/http';

export const NINE_ROUTER_PORT = 20128;
export const NINE_ROUTER_URL = `http://localhost:${NINE_ROUTER_PORT}`;
export const NINE_ROUTER_API = `${NINE_ROUTER_URL}/api`;
export const NINE_ROUTER_V1 = `${NINE_ROUTER_URL}/v1`;

// Pinned 9router npm package version. Prod default stays 0.3.60; set MAESTRO_ROUTER_VERSION to stage a bump in dev (keys the dev cache by version, so the override pulls a clean install) without shipping it. 0.4.x gates its internal /api/* routes behind auth (the old bump blocker): bare `POST /api/providers` / `/api/oauth/<prov>/device-code` now 401 instead of working. That auth is now PORTED here: see cliAuthToken() / cliAuthHeaders() below, which compute the `x-9r-cli-token` 9Router checks and which every /api/* call in this package attaches. The header is empty on 0.3.60 (no machine-id file), so the old auth-free path is untouched. What the bump buys: cc/claude-opus-4-8 and cx/gpt-5.5 on the sub routes (gpt-5.5 404s on 0.3.60), a reworked WebSearch behind /api/v1/search, and 3 months of cross-provider translator robustness. REMAINING gate before flipping the prod default to 0.4.x: re-qualify cross-provider WebSearch. The original 0.3.60 pin reason was that 0.3.60-0.3.96 regressed it (a Codex/Gemini primary delegating WebSearch saw "claude-haiku-4-5-20251001 unavailable" or hallucinated output); 0.4.x reworked it but that's unverified here. Also confirmed on 0.4.80: it STILL emits `max_tokens` (not max_completion_tokens) on Anthropic->OpenAI, so our /api/openai-passthrough rename (core/openai_passthrough.py + sync_openai_api_key, routed via an `openai-compatible` node that honors `baseUrl`) STAYS necessary. DO NOT bump this pin -- out of scope for ENG-6.
export const NINE_ROUTER_NPM_VERSION = process.env.MAESTRO_ROUTER_VERSION ?? '0.3.60';

// Spawn env for 9Router: inherited, plus the port/mode we pin, minus HOSTNAME. 9Router's server
// does `process.env.HOSTNAME || '0.0.0.0'` to choose its bind host, so any shell that exports
// HOSTNAME (git-bash/MSYS sets it automatically; Windows itself uses COMPUTERNAME) makes it bind
// that name -- which resolves to the machine's routable address, NOT loopback. That breaks the app
// in one specific, confusing way: the Keycloak OAuth redirect URI is the fixed, pre-registered
// http://127.0.0.1:20128/callback, so sign-in dead-ends on connection-refused while everything
// else looks fine. Loopback reachability is a correctness requirement, not a preference.
// Mirrors backend/apps/nine_router/process.py's p_router_env().
function routerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(NINE_ROUTER_PORT), NODE_ENV: 'production' };
  delete env.HOSTNAME;
  return env;
}

function expandHome(path: string): string {
  const home = userInfo().homedir;
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  return path;
}

// 9Router (our pinned 0.3.60) appends every request to ~/.9router/request-details.json and reloads the WHOLE file on each write; once it reaches tens of MB the router's node process OOM-aborts and takes the app down, even while idle (verified from crash dumps). Two cheap, pin-safe guards until the real fix (a 9Router bump past 0.4.66, which moved off this file): 1. rotate that log before we spawn 9Router when it gets large, so growth can't run away; 2. give node an explicit, generous heap ceiling for legitimate large multimodal bodies. Neither touches routing, so WebSearch/WebFetch translation and the 0.3.60 pin are unaffected.
export const REQUEST_LOG_PATH = join(expandHome('~'), '.9router', 'request-details.json');
export const REQUEST_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const NODE_HEAP_MB = 4096;

/** Rotate ~/.9router/request-details.json to a single .0 backup when it grows past the cap,
 * BEFORE 9Router is spawned (never racing a live writer). 9Router recreates a fresh file, exactly
 * like a clean install. The only consumer is the 'most recent 5' reasoning-token lookup, which
 * already tolerates an empty/missing file, so no feature loses data it depends on. */
export function rotateRequestLog(): void {
  try {
    if (nodeFs.existsSync(REQUEST_LOG_PATH) && nodeFs.statSync(REQUEST_LOG_PATH).size > REQUEST_LOG_MAX_BYTES) {
      nodeFs.renameSync(REQUEST_LOG_PATH, `${REQUEST_LOG_PATH}.0`);
      console.info(`9Router request log rotated (exceeded ${Math.floor(REQUEST_LOG_MAX_BYTES / (1024 * 1024))} MB) to avoid the router OOM`);
    }
  } catch (e) {
    console.debug(`9Router request-log rotation skipped: ${e}`);
  }
}

// Serializes ensureRunning() so a background auto-start and a concurrent dispatch-time ensure
// can't both spawn 9Router (double-bind on :20128). A tiny promise-chain mutex stands in for
// Python's asyncio.Lock (lazily created there so module import doesn't require a running event
// loop -- not a concern here since a promise chain needs no loop to exist up front).
class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const runAfter = this.tail.then(fn, fn);
    this.tail = runAfter.then(
      () => undefined,
      () => undefined,
    );
    return runAfter;
  }
}
const startLock = new AsyncLock();

/** Single mutable state bag mirroring process.py's module-level globals -- exposed directly so
 * ported tests can read/write it the same way the Python originals do via `patch.object`. */
export const routerState = {
  process: null as ChildProcess | null,
  // Short TTL cache for positive isRunning() results. The probe would otherwise re-pay a real TCP+HTTP round trip on every call; under load (9Router busy streaming inference) the HTTP confirm can exceed its 2s timeout and return false even though 9Router is fine. Caching a recent True result avoids those false negatives without masking a real crash for more than P_IS_RUNNING_TTL_MS. Negative results are NOT cached this long so startup detection in ensureRunning() remains correct.
  // -Infinity, not 0: performance.now() is milliseconds since the CURRENT process started, so
  // early in a process's life (including the first ~10s of every test worker) a literal `0`
  // sentinel would collide with a real, very-small `now` and be misread as "checked just now".
  // Python's time.monotonic() sentinel of 0.0 doesn't have this problem in practice (its own
  // reference epoch is rarely near-zero), which is exactly the kind of clock-semantics gap this
  // port has to account for rather than reproduce literally.
  isRunningLastOk: -Infinity,
  // Short TTL cache for the last isRunning() outcome (either way), far shorter than the positive TTL: a router that's genuinely down (crashed) must be re-detected quickly by ensureRunning(), but a router that's merely slow to answer the HTTP confirm (busy streaming inference) shouldn't force every caller in this window to re-pay the full up-to-2s check.
  isRunningLastChecked: -Infinity,
  isRunningLastResult: false,
  windowsAclHardened: false,
  cliTokenCache: null as string | null,
  watchdogAbort: null as AbortController | null,
  watchdogRunning: false,
  deathWatcherRunning: false,
  deathWatcherAbort: null as AbortController | null,
  recentDeathMonos: [] as number[],
};

export const P_IS_RUNNING_TTL_MS = 10_000;
export const IS_RUNNING_NEGATIVE_TTL_MS = 1_000;

/** Reset every isRunning() cache slot together so the very next call is forced to re-probe; a
 * partial reset (e.g. only isRunningLastOk) leaves the outcome cache able to replay a stale True
 * through the negative-TTL window right after a detected crash. */
export function invalidateIsRunningCache(): void {
  routerState.isRunningLastOk = -Infinity;
  routerState.isRunningLastChecked = -Infinity;
  routerState.isRunningLastResult = false;
}

function monotonicMs(): number {
  return performance.now();
}

/** Cheap TCP connect probe to 9Router's port, no HTTP confirm. Used by isRunning() and by
 * cliAuthToken(), which needs the same fast-fail probe. Python's p_tcp_port_open() is a blocking
 * `socket.create_connection` call; Node has no synchronous socket API, so this is `async` here
 * (its only behavioral difference: callers must `await` it) -- same 0.3s timeout, same
 * 127.0.0.1-not-localhost target (see isRunning()'s doc for why that host matters on Windows). */
export function tcpPortOpen(): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = new nodeNet.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(result);
    };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(NINE_ROUTER_PORT, '127.0.0.1');
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await engineFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Dependencies isRunning() needs for its two real I/O steps, injected so ported tests can force
 * the TCP probe / HTTP confirm outcome directly -- the same role Python's tests fill via
 * `patch.object(process, "p_tcp_port_open", ...)`, made explicit here because a TS module's
 * exported functions don't share Python's "patch the module attribute, every caller sees it"
 * semantics for a same-file caller. */
export interface IsRunningDeps {
  tcpPortOpen: () => Promise<boolean>;
  fetchModels: () => Promise<Response>;
}
const defaultIsRunningDeps: IsRunningDeps = {
  tcpPortOpen,
  fetchModels: () => fetchWithTimeout(`http://127.0.0.1:${NINE_ROUTER_PORT}/v1/models`, 2000),
};

/** Check if 9Router is running.
 *
 * Fast-fail when down. isRunning() is called ~5x on the cold boot path (the settings key-sync
 * sequence + ensureRunning) BEFORE 9Router is up. Probing "localhost" instead of "127.0.0.1" on
 * Windows stalls multiple seconds (it tries ::1 first and the loopback refusal is slow), which
 * froze real callers ~18s and dominated cold startup -- probing 127.0.0.1 with a 0.3s TCP timeout
 * first detects a down 9Router in <~0.3s instead. Only when the port is open do we do the HTTP
 * confirm. 9Router binds 0.0.0.0 (the warm app reaches it via 127.0.0.1 today), so this changes
 * timing, not reachability. */
export async function isRunning(deps: IsRunningDeps = defaultIsRunningDeps): Promise<boolean> {
  const now = monotonicMs();
  if (now - routerState.isRunningLastOk < P_IS_RUNNING_TTL_MS) return true;
  if (now - routerState.isRunningLastChecked < IS_RUNNING_NEGATIVE_TTL_MS) return routerState.isRunningLastResult;
  if (!(await deps.tcpPortOpen())) {
    routerState.isRunningLastChecked = now;
    routerState.isRunningLastResult = false;
    return false;
  }
  try {
    const res = await deps.fetchModels();
    routerState.isRunningLastChecked = now;
    if (res.ok) {
      routerState.isRunningLastOk = now;
      routerState.isRunningLastResult = true;
      return true;
    }
    routerState.isRunningLastResult = false;
    return false;
  } catch {
    routerState.isRunningLastChecked = now;
    routerState.isRunningLastResult = false;
    return false;
  }
}

/** Where 9Router persists machine-id + auth/cli-secret, the two files we hash into the /api/*
 * auth token on 0.4.x. Mirrors 9Router's own default (DATA_DIR env, else ~/.9router on unix,
 * %APPDATA%/9router on win) so we read the exact files it writes. We never relocate it: that
 * would orphan a user's existing subscription connections. */
export function nineRouterDataDir(): string {
  const envDir = process.env.DATA_DIR;
  if (envDir) return envDir;
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(expandHome('~'), 'AppData', 'Roaming');
    return join(base, '9router');
  }
  return join(expandHome('~'), '.9router');
}

// db.json holds LIVE provider credentials (API keys, OAuth bearer tokens) and auth/cli-secret seeds the /api/* token; both were created world-readable, so any other local account could read a user's keys off disk.
export const CREDENTIAL_RELPATHS = ['db.json', join('auth', 'cli-secret')];
export const DATA_DIR_MODE = 0o700;
export const CREDENTIAL_FILE_MODE = 0o600;

/** argv restricting `path` and its existing children to the current user, SYSTEM and the local
 * Administrators group, dropping the inherited ACEs that let other standard accounts in.
 *
 * Well-known SIDs are used because "SYSTEM"/"Administrators" are localized on non-English Windows.
 * Administrators keep access deliberately: a local admin can take ownership of any file, so
 * excluding them buys no real protection and only risks locking the app out of its own state. */
export function windowsAclCommand(path: string): string[] {
  return [
    'icacls', path, '/inheritance:r',
    '/grant:r', `${currentUserPrincipal()}:(OI)(CI)F`,
    '/grant:r', '*S-1-5-18:(OI)(CI)F',
    '/grant:r', '*S-1-5-32-544:(OI)(CI)F',
    '/T', '/C', '/Q',
  ];
}

/** An icacls principal for the current user that actually resolves.
 *
 * A bare username returns from os.userInfo() the same way getpass.getuser() does in Python, which
 * icacls fails to resolve on a domain-joined host ("WILEY\\gmartinssi" logged in, "gmartinssi"
 * passed). That grant is then skipped while the preceding /inheritance:r has already applied,
 * which is how a path ends up with an empty DACL. The user's SID is preferred for the same reason
 * the well-known SIDs above are: it is immune to both localization and domain qualification. */
export function currentUserPrincipal(): string {
  try {
    const result = nodeChildProcess.spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { timeout: 10_000, encoding: 'utf-8' });
    if (!result.error) {
      let stdout = (result.stdout ?? '').trim();
      stdout = stdout.replace(/^"+/, '').replace(/"+$/, '');
      const parts = stdout.split('","');
      let sid = parts[parts.length - 1] ?? '';
      sid = sid.replace(/^"+/, '').replace(/"+$/, '');
      if (sid.startsWith('S-1-')) return `*${sid}`;
    }
  } catch {
    // fall through to the domain\user fallback below
  }
  const domain = (process.env.USERDOMAIN ?? '').trim();
  const user = (process.env.USERNAME ?? '').trim() || userInfo().username;
  return domain ? `${domain}\\${user}` : user;
}

/** The dir plus the state files whose loss actually breaks the router, for post-hardening checks. */
export function aclPathsToVerify(path: string): string[] {
  const paths = [path];
  for (const rel of CREDENTIAL_RELPATHS) {
    const file = join(path, rel);
    if (nodeFs.existsSync(file) && nodeFs.statSync(file).isFile()) paths.push(file);
  }
  return paths;
}

/** True when `path` still has at least one ACE. An empty DACL denies everyone, so this is the
 * post-condition that separates 'hardened' from 'bricked'. */
export function windowsAclIsUsable(path: string): boolean {
  let result;
  try {
    result = nodeChildProcess.spawnSync('icacls', [path], { timeout: 20_000, encoding: 'utf-8' });
  } catch {
    return true;
  }
  if (result.error) return true;
  // icacls echoes the path then one indented "principal:(rights)" line per ACE; no ACE lines means
  // an empty DACL. Treat an unreadable result as usable so a parsing surprise never triggers a
  // rollback we did not need.
  const lines = (result.stdout ?? '').split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  return lines.some((ln) => ln.includes(':') && !ln.startsWith(path));
}

/** Best-effort, once per process: there is no POSIX-mode-bit equivalent on Windows (chmod there
 * only flips the read-only bit, which would actively break 9Router's writes), so the only real
 * mechanism is an ACL edit via icacls. Failure is non-fatal and never logged with any file
 * content, since a missing/refused icacls just leaves the inherited permissions in place. */
export function hardenWindowsAcl(path: string): void {
  if (routerState.windowsAclHardened) return;
  routerState.windowsAclHardened = true;
  try {
    const argv = windowsAclCommand(path);
    const result = nodeChildProcess.spawnSync(argv[0], argv.slice(1), { timeout: 20_000, encoding: 'utf-8' });
    if (!result.error && result.status !== 0) {
      console.debug(`9Router data-dir ACL hardening returned ${result.status}`);
    }
    // icacls applies its arguments left to right and PARTIALLY: if /inheritance:r succeeds and a
    // later /grant:r fails to resolve its principal (a bare username, which does not always
    // resolve on a domain-joined host), the result is a dir with an EMPTY DACL that nobody --
    // including the owner -- can open, propagated to db.json by /T. That is strictly worse than
    // the loose permissions we came to fix, so verify and roll back rather than trust the return
    // code, which is 0 on a partial apply.
    // Check the FILES too, not just the dir. /T applies per-entry, so a file that was locked
    // (9Router holding db.json open) can be left with an empty DACL while the dir above it ends up
    // correctly hardened and the return code stays 0 -- observed in the wild as a healthy dir with
    // 3 ACEs over a db.json with none, which bricks the router into "Failed to create provider
    // node" 500s.
    const bricked = aclPathsToVerify(path).filter((p) => !windowsAclIsUsable(p));
    if (bricked.length > 0) {
      nodeChildProcess.spawnSync('icacls', [path, '/inheritance:e', '/T', '/C', '/Q'], { timeout: 20_000, encoding: 'utf-8' });
      console.warn(`9Router data-dir ACL left no usable entries on ${bricked.length} path(s); restored inheritance instead of locking the app out of its own state`);
    }
  } catch (e) {
    console.debug(`9Router data-dir ACL hardening skipped: ${e}`);
  }
}

/** Make 9Router's state dir owner-only and tighten any credential file already inside it.
 *
 * POSIX: the dir is created with mode 0700 passed to mkdir, so it is never briefly traversable (a
 * create-then-chmod would leave that window); an existing dir from an earlier run is chmod'ed
 * down, which is the common case. Credential files we know by name go to 0600. Files 9Router
 * itself creates later (db.json on a fresh connect) are still born 0644 because we do not control
 * that writer, so the 0700 dir is the actual guarantee: another user cannot traverse into it to
 * reach them at all. The next start also tightens db.json's own bits.
 *
 * Windows: NO POSIX mode bits exist, so the file modes above are not attempted at all. Protection
 * rests on (1) the data dir living under the user's profile, whose default ACL already excludes
 * other standard users, and (2) the best-effort icacls tightening below. Neither is a guarantee
 * against a local administrator or a machine with a loosened profile ACL.
 *
 * Never raises; hardening failure must not stop the router from starting. `platform` is injectable
 * (default: the real process.platform) purely so ported tests can force either branch on a single
 * host, the same way the Python tests patch `os.name`. */
export function secureDataDir(dataDir?: string, platform: NodeJS.Platform = process.platform): string {
  const path = dataDir ?? nineRouterDataDir();
  try {
    const isDir = nodeFs.existsSync(path) && nodeFs.statSync(path).isDirectory();
    if (!isDir) {
      nodeFs.mkdirSync(path, { recursive: true, mode: DATA_DIR_MODE });
    } else if (platform !== 'win32' && (nodeFs.statSync(path).mode & 0o777) !== DATA_DIR_MODE) {
      nodeFs.chmodSync(path, DATA_DIR_MODE);
    }
    if (platform === 'win32') {
      hardenWindowsAcl(path);
      return path;
    }
    for (const rel of CREDENTIAL_RELPATHS) {
      const file = join(path, rel);
      if (nodeFs.existsSync(file) && nodeFs.statSync(file).isFile() && (nodeFs.statSync(file).mode & 0o777) !== CREDENTIAL_FILE_MODE) {
        nodeFs.chmodSync(file, CREDENTIAL_FILE_MODE);
      }
    }
  } catch (e) {
    console.warn(`9Router data-dir hardening failed for ${path}: ${e}`);
  }
  return path;
}

const cliTokenPromise: Promise<string | null> | null = null;

/** The token 9Router 0.4.x checks in `x-9r-cli-token` on /api/* calls:
 * sha256(machineId + "9r-cli-auth" + cliSecret)[:16]. machine-id is written at 9Router boot,
 * cli-secret only lazily on its first self-call, so we create cli-secret ourselves (atomic
 * O_EXCL, 0600, identical to 9Router's getter) when missing so connect/sync can auth before that
 * self-call. Returns null on 0.3.60 (no machine-id) or when 9Router isn't up, so the caller sends
 * no header and the old auth-free path is untouched. Never raises.
 *
 * Python's version is a synchronous function; Node has no synchronous socket API for the
 * tcpPortOpen() pre-check, so this is `async` here (callers must `await` it). */
export async function cliAuthToken(): Promise<string | null> {
  if (routerState.cliTokenCache) return routerState.cliTokenCache;
  if (!(await tcpPortOpen())) return null;
  try {
    const dataDir = nineRouterDataDir();
    let machineId: string;
    try {
      machineId = nodeFs.readFileSync(join(dataDir, 'machine-id'), 'utf-8').trim();
    } catch {
      return null; // 0.3.60 layout, or 9Router hasn't written it yet
    }
    if (!machineId) return null;
    const secretPath = join(dataDir, 'auth', 'cli-secret');
    let cliSecret = '';
    try {
      cliSecret = nodeFs.readFileSync(secretPath, 'utf-8').trim();
    } catch {
      cliSecret = '';
    }
    if (!cliSecret) {
      cliSecret = randomBytes(32).toString('hex');
      try {
        nodeFs.mkdirSync(dirname(secretPath), { recursive: true, mode: DATA_DIR_MODE });
        // O_EXCL: if 9Router won the race and wrote first, read its value.
        const fd = nodeFs.openSync(secretPath, nodeFs.constants.O_CREAT | nodeFs.constants.O_EXCL | nodeFs.constants.O_WRONLY, 0o600);
        try {
          nodeFs.writeSync(fd, cliSecret, null, 'utf-8');
        } finally {
          nodeFs.closeSync(fd);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          cliSecret = nodeFs.readFileSync(secretPath, 'utf-8').trim();
        } else {
          throw e;
        }
      }
    }
    if (!cliSecret) return null;
    const tok = createHash('sha256').update(machineId + '9r-cli-auth' + cliSecret, 'utf-8').digest('hex').slice(0, 16);
    routerState.cliTokenCache = tok;
    return tok;
  } catch {
    return null;
  }
}

/** `x-9r-cli-token` header for 9Router 0.4.x /api/* calls; empty object on 0.3.60 (no token),
 * where the old auth-free endpoints still answer. */
export async function cliAuthHeaders(): Promise<Record<string, string>> {
  const tok = await cliAuthToken();
  return tok ? { 'x-9r-cli-token': tok } : {};
}
void cliTokenPromise; // reserved: keeps the single-flight variable declared for a future in-flight-dedup pass, unused today (matches p_cli_token_cache's own no-dedup behavior on a cache miss)

/** Locate the bundled 9Router directory (works in both dev and packaged mode). */
export function find9routerDir(): string | null {
  const isPackaged = process.env.MAESTRO_PACKAGED === '1';
  if (isPackaged) {
    // engine/(src|dist)/router -> engine/(src|dist) -> engine -> repo root -> one more hop to the
    // packaged "Resources" dir, mirroring process.py's 4-dirname hop from
    // backend/apps/nine_router/process.py to the folder that holds "backend" and "router" as
    // siblings. The engine's own packaged resource layout is not yet formalized (no TAU/ENG ticket
    // has packaged engine/ itself), so this hop count is a best-effort mirror of the Python
    // original's shape, not a verified path -- flagged for whoever does that packaging work.
    const resources = resolve(__dirname, '..', '..', '..', '..');
    const candidate = join(resources, 'router');
    if (nodeFs.existsSync(candidate) && nodeFs.statSync(candidate).isDirectory()) return candidate;
  } else {
    // engine/(src|dist)/router -> engine/(src|dist) -> engine -> repo root -> "router" sibling of backend/.
    const projectRoot = resolve(__dirname, '..', '..', '..');
    const candidate = join(projectRoot, 'router');
    if (nodeFs.existsSync(candidate) && nodeFs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

/** Absolute path to backend/apps/agents/9router_gpt5_patch.js, used as `node --require <path>`
 * when spawning 9router.
 *
 * The patch intercepts outbound HTTPS to api.openai.com and renames `max_tokens` ->
 * `max_completion_tokens` for GPT-5 models. Without it, every gpt-5* own-key session 400's because
 * OpenAI rejects the legacy field name and 9router (every version including 0.4.20) emits it.
 *
 * Returns null if the file is missing; spawning `node --require <missing-path>` would fail, so the
 * caller drops the flag and spawns 9router unpatched (failure mode = identical to pre-patch
 * baseline; GPT-5 still 400's but everything else works). */
export function gpt5PatchPath(): string | null {
  // engine/(src|dist)/router -> engine/(src|dist) -> engine -> repo root.
  const repoRoot = resolve(__dirname, '..', '..', '..');
  const candidate = join(repoRoot, 'backend', 'apps', 'agents', '9router_gpt5_patch.js');
  return nodeFs.existsSync(candidate) ? candidate : null;
}

function which(cmd: string): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (nodeFs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Find a Node.js binary (works in both dev and packaged mode).
 *
 * Priority order:
 *   1. MAESTRO_NODE_PATH; set by electron/main.js when a real Node binary is bundled in
 *      extraResources. Always preferred on user machines because it (a) avoids the bouncing "exec"
 *      Dock icon that ELECTRON_RUN_AS_NODE produces on fresh Macs and (b) starts in ~50ms vs
 *      Electron-as-Node's 5-15s cold-start, shrinking the splash window the user stares at.
 *   2. System `node` on PATH; dev convenience.
 *   3. ELECTRON_RUN_AS_NODE fallback; last resort. Only hits this on packaged builds that for some
 *      reason shipped without the bundled node payload. */
export function findNode(): string | null {
  const bundled = process.env.MAESTRO_NODE_PATH;
  if (bundled && nodeFs.existsSync(bundled)) return bundled;

  const node = which('node');
  if (node) return node;

  const electronPath = process.env.MAESTRO_ELECTRON_PATH;
  if (electronPath && nodeFs.existsSync(electronPath)) return electronPath;

  return null;
}

/** Cache dir for the npm 9router package used in dev mode.
 *
 * Pinned per version so bumping NINE_ROUTER_NPM_VERSION triggers a fresh install instead of
 * reusing a stale cache. */
export function devRouterCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(expandHome('~'), '.cache');
  return join(base, 'maestro-router', NINE_ROUTER_NPM_VERSION);
}

/** Ensure the npm 9router package is installed in the dev cache.
 *
 * Returns the absolute path to `app/server.js` on success, or null if npm isn't available or the
 * install fails. Idempotent; returns immediately when the server file already exists.
 *
 * Running `node app/server.js` directly (instead of `npx 9router`) skips the CLI wrapper, which
 * means no systray menu-bar icon, no update-check spinner, and no accidental-quit foot-gun when a
 * non-developer right-clicks the "9" tray icon and picks Quit. */
export async function ensureRouterCached(): Promise<string | null> {
  const cacheDir = devRouterCacheDir();
  const serverJs = join(cacheDir, 'node_modules', '9router', 'app', 'server.js');
  if (nodeFs.existsSync(serverJs)) return serverJs;

  const npm = which('npm');
  if (!npm) {
    console.warn('npm not found; install Node.js to auto-start 9Router in dev.');
    return null;
  }

  try {
    nodeFs.mkdirSync(cacheDir, { recursive: true });
    const pkgJson = join(cacheDir, 'package.json');
    if (!nodeFs.existsSync(pkgJson)) {
      nodeFs.writeFileSync(pkgJson, '{"name":"_maestro_router_cache","version":"0.0.0","private":true}\n');
    }
    console.info(`Installing 9router@${NINE_ROUTER_NPM_VERSION} into ${cacheDir} (one-time, ~30s)...`);
    // Note: we do NOT pass --ignore-scripts. The package's postinstall rebuilds better-sqlite3 for the host platform; skipping it leaves the server unable to load its native addon.
    nodeChildProcess.spawnSync(npm, ['install', `9router@${NINE_ROUTER_NPM_VERSION}`, '--no-save', '--no-audit', '--no-fund', '--silent'], {
      cwd: cacheDir,
      stdio: 'ignore',
      timeout: 300_000,
    });
  } catch (e) {
    console.warn(`Failed to install 9router into ${cacheDir}: ${e}`);
    return null;
  }

  return nodeFs.existsSync(serverJs) ? serverJs : null;
}

/** Tail of the 9Router start-capture file, where the real spawn error lands. Best-effort; empty
 * string on any hiccup so telemetry never breaks boot. */
export function readCaptureTail(path: string, limit = 6000): string {
  let fd: number | undefined;
  try {
    fd = nodeFs.openSync(path, 'r');
    const size = nodeFs.fstatSync(fd).size;
    const start = Math.max(0, size - limit);
    const buf = Buffer.alloc(size - start);
    nodeFs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        nodeFs.closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

/** 9Router didn't come up. Log it so a user's 'every model exits 1' is finally explained from our
 * side instead of a silent warning. Never raises.
 *
 * Python's sibling submits a scrubbed diagnostic via backend.apps.service.client; that service
 * client has no engine-side equivalent yet (ENG-7, "Health/service + provider egress chokepoint",
 * owns building one) so this port logs only, for now -- the ported behavior that IS portable
 * today (log the failure reason, never throw) is preserved exactly. */
export function reportStartFailure(reason: string, fields: Record<string, unknown> = {}): void {
  console.warn(`9Router start failed (${reason})`, fields);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Races the child's 'exit' event against `signal` aborting first. Node has no equivalent of
 * asyncio's `task.cancel()` interrupting an in-flight await, so deathWatch() needs this explicit
 * race to get the SAME effect Python's cancellation gets almost for free: stop()'s cancel must
 * win outright, not merely race the `routerState.process !== child` guard below, which by itself
 * is a real, observed race in Node -- both stop()'s own exit-wait and this one attach listeners to
 * the SAME child, and which continuation's guard-check runs first after the process actually
 * exits is unspecified. Aborting FIRST (as stop() does) makes this resolve 'aborted' before the
 * process is even killed, closing that race outright rather than leaving it to guard-check
 * ordering. */
function waitUntilExitOrAborted(child: ChildProcess, signal: AbortSignal): Promise<'exited' | 'aborted'> {
  return new Promise((resolveRace) => {
    if (signal.aborted) {
      resolveRace('aborted');
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveRace('exited');
      return;
    }
    const cleanup = () => {
      child.removeListener('exit', onExit);
      signal.removeEventListener('abort', onAbort);
    };
    const onExit = () => {
      cleanup();
      resolveRace('exited');
    };
    const onAbort = () => {
      cleanup();
      resolveRace('aborted');
    };
    child.once('exit', onExit);
    signal.addEventListener('abort', onAbort);
  });
}

// A signal that never aborts, for deathWatch() callers (mainly ported tests) that don't route
// through startDeathWatcher()/stop() and so have no real controller to hand in.
const neverAbortSignal = new AbortController().signal;

function waitForExitWithTimeout(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveWait) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveWait(true);
      return;
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveWait(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveWait(true);
    };
    child.once('exit', onExit);
  });
}

/** Start 9Router if not already running. */
async function ensureRunningImpl(): Promise<void> {
  const isPackaged = process.env.MAESTRO_PACKAGED === '1';
  // Before the isRunning() early-return, so an adopted router's dir gets tightened too, and before any spawn so 9Router writes its credentials into an already-locked dir.
  secureDataDir();

  if (await isRunning()) {
    // In dev mode, kill stale standalone servers (from previous builds) so we can start `next dev` which always uses latest source code
    if (!isPackaged) {
      // But never kill the instance WE already started: a second ensure call (another sub-app's lifespan races settings') would pkill our fresh next-server, leaving a dead window the boot key-sync fails into, so the cp-openai node never registers and gpt-5.* own-key dies.
      if (routerState.process !== null && routerState.process.exitCode === null && routerState.process.signalCode === null) {
        console.info(`9Router already running (ours) on port ${NINE_ROUTER_PORT}`);
        return;
      }
      try {
        const result = nodeChildProcess.spawnSync('pgrep', ['-f', 'next-server'], { encoding: 'utf-8', timeout: 3000 });
        if (result.error) throw result.error;
        if ((result.stdout ?? '').trim()) {
          console.info('Dev mode: killing stale standalone 9Router to use next dev instead');
          nodeChildProcess.spawnSync('pkill', ['-f', 'next-server'], { timeout: 5000 });
          // The port is about to go dead; drop the whole cache so the start-loop below actually re-probes instead of trusting the killed server's stale "ready".
          invalidateIsRunningCache();
          await sleep(2000);
        } else {
          console.info(`9Router already running on port ${NINE_ROUTER_PORT}`);
          return;
        }
      } catch {
        console.info(`9Router already running on port ${NINE_ROUTER_PORT}`);
        return;
      }
    } else {
      console.info(`9Router already running on port ${NINE_ROUTER_PORT}`);
      return;
    }
  }

  rotateRequestLog();
  const routerDir = find9routerDir();
  const patch = gpt5PatchPath();

  let cmd: string[];
  let cwd: string;
  let env: NodeJS.ProcessEnv;

  if (isPackaged) {
    // Packaged: run the pre-built standalone server staged at <resources>/router/server.js by fetch-router at build time. We do NOT fall back to the dev npm path here, a user machine has no npm, so that only ever fails silently; every miss is reported instead.
    if (!routerDir) {
      reportStartFailure('router_not_bundled');
      return;
    }
    let standaloneServer = join(routerDir, 'server.js');
    if (!nodeFs.existsSync(standaloneServer)) standaloneServer = join(routerDir, '.next', 'standalone', 'server.js');
    if (!nodeFs.existsSync(standaloneServer)) {
      reportStartFailure('server_missing', { routerDirFound: true });
      return;
    }
    const node = findNode();
    if (!node) {
      reportStartFailure('node_not_found', { routerDirFound: true, serverFound: true });
      return;
    }
    console.info(`Starting 9Router (production) on port ${NINE_ROUTER_PORT}...`);
    cmd = [node, `--max-old-space-size=${NODE_HEAP_MB}`, ...(patch ? ['--require', patch] : []), standaloneServer];
    cwd = dirname(standaloneServer);
    env = routerEnv();
    if (node === process.env.MAESTRO_ELECTRON_PATH) env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    // Dev: install the pinned npm package into a local cache once, then spawn `node app/server.js` directly (bypasses the package cli.js tray icon users confusingly quit, its update-check spinner, and the TUI).
    const cachedServer = await ensureRouterCached();
    if (!cachedServer) return;
    const node = findNode();
    if (!node) {
      console.warn('Node.js not found; cannot start 9Router in dev mode.');
      return;
    }
    console.info(`Starting 9Router (dev cache, 9router@${NINE_ROUTER_NPM_VERSION}) on port ${NINE_ROUTER_PORT}...`);
    cmd = [node, `--max-old-space-size=${NODE_HEAP_MB}`, ...(patch ? ['--require', patch] : []), cachedServer];
    cwd = dirname(cachedServer);
    env = routerEnv();
  }

  // Capture stdout+stderr so a failed start can tell us WHY (the old DEVNULL default made every "router never came up" a silent mystery, which is the whole reason #90 was un-diagnosable). Packaged prod (NODE_ENV=production standalone) is quiet, so one fixed temp file, truncated each start attempt, won't grow; dev keeps its chatty-Next.js DEVNULL unless debug is set.
  const capPath = join(tmpdir(), 'maestro-9router-start.log');
  let capFd: number | null = null;
  let stdio: ['ignore', 'ignore' | number, 'ignore' | number] = ['ignore', 'ignore', 'ignore'];
  if (isPackaged) {
    try {
      capFd = nodeFs.openSync(capPath, 'w');
      stdio = ['ignore', capFd, capFd];
    } catch {
      stdio = ['ignore', 'ignore', 'ignore'];
    }
  } else if (process.env.MAESTRO_DEBUG_9ROUTER) {
    const logPath = join(resolve(__dirname, '..', '..', '..'), 'backend', 'data', '9router.log');
    nodeFs.mkdirSync(dirname(logPath), { recursive: true });
    const logFd = nodeFs.openSync(logPath, 'a');
    stdio = ['ignore', logFd, logFd];
    console.info(`9Router debug logging enabled -> ${logPath}`);
  }

  try {
    const [command, ...args] = cmd;
    const child = nodeChildProcess.spawn(command, args, { cwd, env, stdio });
    routerState.process = child;
    let spawnError: Error | null = null;
    child.once('error', (err) => {
      spawnError = err;
    });
    if (capFd !== null) {
      try {
        nodeFs.closeSync(capFd); // the child holds its own fd; the parent copy isn't needed
      } catch {
        // already closed
      }
    }
    const timeoutSec = isPackaged ? 20 : 30;
    for (let i = 0; i < timeoutSec * 2; i++) {
      if (spawnError) throw spawnError;
      await sleep(500);
      if (await isRunning()) {
        console.info('9Router started successfully');
        return;
      }
    }
    // Verify-at-boot: it never answered. Report with the captured tail + the exit code (non-null = it crashed; null = wedged or just slow).
    reportStartFailure('not_ready_in_time', {
      detail: isPackaged ? readCaptureTail(capPath) : '',
      returncode: child.exitCode,
      timeoutS: timeoutSec,
    });
  } catch (e) {
    if (capFd !== null) {
      try {
        nodeFs.closeSync(capFd);
      } catch {
        // already closed
      }
    }
    reportStartFailure('spawn_exception', {
      detail: `${e}\n${isPackaged ? readCaptureTail(capPath) : ''}`,
    });
  }
}

// 20s pulse while healthy; after 3 straight failed revives (no node, broken install) back way off so a dead-end setup logs once per 5min instead of crash-looping.
export const WATCHDOG_INTERVAL_MS = 20_000;
export const WATCHDOG_BACKOFF_MS = 300_000;

// Exported so ported tests can supply a fake `sleep` WatchdogDep that respects the same abort
// contract watchdogLoop() itself relies on to actually stop (see the loop's catch clause below).
export class AbortSleepError extends Error {}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal.aborted) {
      reject(new AbortSleepError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortSleepError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolveSleep();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

export interface WatchdogDeps {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  isRunning: () => Promise<boolean>;
  ensureRunning: () => Promise<void>;
}

const defaultWatchdogDeps: WatchdogDeps = { sleep: abortableSleep, isRunning, ensureRunning: () => ensureRunning() };

/** Backstop healer for routers we DIDN'T spawn (adopted port-holders have no handle for the
 * death-watcher). Two-strike confirmation before reviving: the isRunning probe can false-negative
 * while a busy router streams, and acting on one bad probe would rotate a LIVE router's request
 * log and burn a duplicate spawn attempt. */
export async function watchdogLoop(signal: AbortSignal, deps: WatchdogDeps = defaultWatchdogDeps): Promise<void> {
  let failures = 0;
  for (;;) {
    try {
      await deps.sleep(failures >= 3 ? WATCHDOG_BACKOFF_MS : WATCHDOG_INTERVAL_MS, signal);
      // isRunning() already offloads its HTTP confirm off the caller internally, so a periodic pulse never blocks anything else.
      if (await deps.isRunning()) {
        failures = 0;
        continue;
      }
      await deps.sleep(2000, signal);
      if (await deps.isRunning()) {
        failures = 0;
        continue;
      }
      console.warn('9Router watchdog: router is down (confirmed twice); reviving');
      await deps.ensureRunning();
      if (await deps.isRunning()) {
        failures = 0;
        console.info('9Router watchdog: revived');
      } else {
        failures += 1;
      }
    } catch (e) {
      if (e instanceof AbortSleepError) return;
      failures += 1;
      console.error('9Router watchdog iteration failed', e);
    }
  }
}

export interface DeathWatchDeps {
  ensureRunning: () => Promise<void>;
  now: () => number;
}

const defaultDeathWatchDeps: DeathWatchDeps = { ensureRunning: () => ensureRunning(), now: monotonicMs };

/** Instant healer for the process WE spawned: its exit wakes us the moment it happens (no polling,
 * no false positives), so total heal time = just the respawn. Crash-loop guard: 3 deaths inside
 * 60s defers to the backed-off watchdog instead of hot-spinning a broken install.
 *
 * `signal` is the equivalent of Python's `task.cancel()` on the coroutine awaiting
 * `run_in_executor(None, proc_handle.wait)`: stop() aborts it BEFORE killing the process, so this
 * returns on the 'aborted' branch and never reaches the revive below -- the
 * `routerState.process !== child` guard after it is a belt-and-suspenders backup for a caller
 * that races stop() without going through it (e.g. a superseded handle from a fresh spawn), not
 * the primary defense; relying on the guard ALONE lost a real race in Node, where stop()'s own
 * exit-wait and this function's both listen on the same child's 'exit' event with no guaranteed
 * ordering between the two continuations' guard-checks. */
export async function deathWatch(child: ChildProcess, deps: DeathWatchDeps = defaultDeathWatchDeps, signal: AbortSignal = neverAbortSignal): Promise<void> {
  const outcome = await waitUntilExitOrAborted(child, signal);
  if (outcome === 'aborted') return;
  // stop() nulls routerState.process before this continuation can run (the underlying process
  // exit is what unblocks it), so a deliberate quit or a superseded handle never triggers a revive.
  if (routerState.process !== child) return;
  const now = deps.now();
  routerState.recentDeathMonos.push(now);
  routerState.recentDeathMonos.splice(0, routerState.recentDeathMonos.length - 3);
  if (routerState.recentDeathMonos.length === 3 && now - routerState.recentDeathMonos[0] < 60_000) {
    console.warn('9Router died 3x in 60s; leaving revival to the backed-off watchdog');
    return;
  }
  console.warn('9Router process died; instant revive');
  invalidateIsRunningCache();
  await deps.ensureRunning();
}

/** Idempotent per spawned handle; no-op for adopted routers (no handle to wait on). */
export function startDeathWatcher(): void {
  const child = routerState.process;
  if (child === null || child.exitCode !== null || child.signalCode !== null) return;
  if (routerState.deathWatcherRunning) return;
  routerState.deathWatcherRunning = true;
  routerState.deathWatcherAbort = new AbortController();
  void deathWatch(child, defaultDeathWatchDeps, routerState.deathWatcherAbort.signal).finally(() => {
    routerState.deathWatcherRunning = false;
  });
}

/** Idempotent; armed by ensureRunning() on success, cancelled by stop(). */
export function startWatchdog(): void {
  if (routerState.watchdogRunning) return;
  routerState.watchdogRunning = true;
  routerState.watchdogAbort = new AbortController();
  const signal = routerState.watchdogAbort.signal;
  void watchdogLoop(signal).finally(() => {
    routerState.watchdogRunning = false;
  });
}

/** Start 9Router if not already running. Serialized so concurrent callers (the background
 * auto-start + a dispatch-time ensure) can't double-spawn. */
export async function ensureRunning(): Promise<void> {
  await startLock.run(() => ensureRunningImpl());
  // Arm both healers the moment the router becomes a live dependency; users who never route through it never spawn them.
  if (await isRunning()) {
    startWatchdog();
    startDeathWatcher();
  }
}

/** True when 9Router's on-disk db shows an active provider connection. Readable while the router
 * is DOWN, so revival logic can tell a sub-only user (revive!) from a zero-config one (don't boot
 * a router that has nothing to route). Fail-closed on any read problem. */
export function hasPersistedConnections(): boolean {
  try {
    const raw = nodeFs.readFileSync(join(nineRouterDataDir(), 'db.json'), 'utf-8');
    const db = JSON.parse(raw) as { providerConnections?: unknown };
    const conns = db.providerConnections;
    if (!Array.isArray(conns)) return false;
    return conns.some((c) => c !== null && typeof c === 'object' && (c as Record<string, unknown>).isActive === true);
  } catch {
    return false;
  }
}

/** Stop the 9Router subprocess. */
export async function stop(): Promise<void> {
  // Cancel the healers FIRST or they would revive the router we're about to kill (shutdown = the one sanctioned "down") -- mirrors Python's task.cancel() on both the watchdog and the death-watcher, which is what actually stops the death-watcher's revive (see deathWatch()'s own doc comment for why the `routerState.process !== child` guard alone is not enough in Node).
  if (routerState.watchdogAbort !== null) {
    routerState.watchdogAbort.abort();
    routerState.watchdogAbort = null;
  }
  if (routerState.deathWatcherAbort !== null) {
    routerState.deathWatcherAbort.abort();
    routerState.deathWatcherAbort = null;
  }
  routerState.deathWatcherRunning = false;
  const child = routerState.process;
  if (child) {
    try {
      child.kill('SIGTERM');
      const exited = await waitForExitWithTimeout(child, 5000);
      if (!exited) child.kill('SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    routerState.process = null;
    console.info('9Router stopped');
  }
}

/** Get usage statistics from 9Router. */
export async function getUsageStats(period = 'all'): Promise<Record<string, unknown> | null> {
  try {
    const headers = await cliAuthHeaders();
    const res = await fetchWithTimeout(`${NINE_ROUTER_API}/usage/stats?${new URLSearchParams({ period })}`, 5000, { headers });
    if (res.ok) return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.debug(`9Router usage stats fetch failed: ${e}`);
  }
  return null;
}

/** Fetch reasoning_tokens from 9Router for the most recently completed request, optionally
 * filtered by model. Returns null if 9Router isn't running, the request didn't expose reasoning
 * tokens, or the lookup fails for any reason.
 *
 * 9Router's request-details endpoint returns the most recent N requests in reverse chronological
 * order with full token breakdowns including `reasoning_tokens` (OpenAI's
 * `completion_tokens_details.reasoning_tokens`) and `thoughtsTokenCount` (Gemini's). For Anthropic
 * via 9Router this field will be absent/zero; Anthropic doesn't break out reasoning tokens in its
 * API response; so callers get null and should fall back to the heuristic. */
export async function getLatestReasoningTokens(modelHint?: string): Promise<number | null> {
  if (!(await isRunning())) return null;
  try {
    const headers = await cliAuthHeaders();
    const params = new URLSearchParams({ page: '1', pageSize: '5' });
    if (modelHint) params.set('model', modelHint);
    const res = await fetchWithTimeout(`${NINE_ROUTER_API}/usage/request-details?${params}`, 2000, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as { requests?: unknown[]; data?: unknown[] };
    const requests = data.requests ?? data.data ?? [];
    for (const req of requests) {
      if (req === null || typeof req !== 'object') continue;
      const tokens = ((req as Record<string, unknown>).tokens ?? (req as Record<string, unknown>).usage ?? {}) as Record<string, unknown>;
      const rt = tokens.reasoning_tokens ?? tokens.thoughtsTokenCount ?? tokens.thoughts_token_count ?? 0;
      const rtNum = Number(rt);
      if (rtNum > 0) return rtNum;
    }
  } catch (e) {
    console.debug(`9Router reasoning-token lookup failed: ${e}`);
  }
  return null;
}

/** Get all providers and their connection status from 9Router.
 *
 * 9Router's GET /api/providers returns `{"connections": [...]}`; we unwrap so callers always see a
 * plain list of connection dicts. */
export async function getProviders(): Promise<Record<string, unknown>[]> {
  try {
    const headers = await cliAuthHeaders();
    const res = await fetchWithTimeout(`${NINE_ROUTER_API}/providers`, 5000, { headers });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (data !== null && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).connections)) {
        return (data as { connections: Record<string, unknown>[] }).connections;
      }
      if (Array.isArray(data)) return data as Record<string, unknown>[];
    }
  } catch (e) {
    console.debug(`9Router providers fetch failed: ${e}`);
  }
  return [];
}
