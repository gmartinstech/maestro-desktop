// Spawns the Python backend as a sidecar process and supervises it: pick a free port, launch
// uvicorn, poll /api/health/check until it answers, and on an unexpected exit hand the decision
// of whether to respawn to `restart_policy::decide_restart`.
//
// Ported from electron/main.js's startBackend()/waitForBackend()/pickBackendPort()/
// maybeRestartBackend()/killBackend(). Both DEV mode (spawns backend/.venv/Scripts/python.exe
// straight out of the repo checkout) and the PACKAGED-mode *resolution* path (spawns
// <resource_dir>/python-env/python.exe, mirroring electron/main.js's getPythonPath()/
// getResourcePath() isPackaged branches) are implemented via `BackendRoot` below -- which mode
// actually runs is decided at runtime by `is_packaged()`, not hardcoded. NOTE: this repo's local
// checkout has no bundled `python-env` payload yet (tauri.conf.json's `bundle.resources` doesn't
// stage one -- see docs/plans/txm-status.md's "Build-artifact readiness" section for exactly
// what script/step would need to produce and wire it), so a real packaged build's sidecar will
// resolve to the *correct* location and fail loudly (spawn ENOENT) rather than silently falling
// back to the dev path or baking this machine's absolute path into the shipped binary.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::restart_policy::{decide_restart, recent_attempts, RestartContext, MAX_RESTARTS};

// host:'127.0.0.1' is load-bearing, same as pickBackendPort()'s comment in electron/main.js:
// uvicorn binds --host 127.0.0.1, and probing 0.0.0.0 can report a port "free" on Windows even
// when something already holds 127.0.0.1:PORT (loopback), which would then make uvicorn's own
// bind fail. Probing the exact interface uvicorn binds avoids that false positive.
const BACKEND_HOST: &str = "127.0.0.1";
const PREFERRED_PORT_RANGE: std::ops::Range<u16> = 8324..8424;

/// Shared state the rest of the Rust app (Tauri commands, TAU-4) reads: the port the currently
/// running backend actually bound, and the handle needed to tear it down on app quit.
pub struct Sidecar {
    port: AtomicU16,
    child: Mutex<Option<Child>>,
    /// Flipped true immediately before we kill the child ourselves (app quit), so the exit
    /// handler's restart policy sees `intentional` and vetoes -- mirrors
    /// electron/main.js's `backendExitIsIntentional`.
    intentional: AtomicBool,
    /// Flipped true once the app has started quitting, so a backend that dies mid-teardown is
    /// never respawned into it -- mirrors `appIsQuitting`.
    quitting: AtomicBool,
    /// Flipped true once `wait_for_health` has actually returned Ok for the current backend
    /// process, false again the moment that process exits. TAU-5's splash boot coordinator
    /// (splash.rs / lib.rs) polls this the way electron/main.js's boot flow gates
    /// `swapToMain()` on its own `backendReady` flag -- port() alone isn't enough, since it's
    /// published before the health poll passes.
    ready: AtomicBool,
}

impl Default for Sidecar {
    fn default() -> Self {
        Sidecar {
            port: AtomicU16::new(0),
            child: Mutex::new(None),
            intentional: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            ready: AtomicBool::new(false),
        }
    }
}

impl Sidecar {
    /// The port the running backend bound, or None before the first spawn has resolved one.
    pub fn port(&self) -> Option<u16> {
        match self.port.load(Ordering::SeqCst) {
            0 => None,
            p => Some(p),
        }
    }

    /// True once the current backend process has answered a health check successfully. See the
    /// field doc comment above for why this, not `port()`, is the readiness signal to gate on.
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Marks the app as quitting and kills the current child (if any) as an intentional exit, so
    /// the supervisor loop's restart policy vetoes rather than respawning into the teardown.
    /// Mirrors electron/main.js's killBackend() + appIsQuitting flag.
    pub fn shutdown(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        self.intentional.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                kill_tree(&mut child);
            }
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// True for an installed/packaged build (a `cargo tauri build` release binary), false for
/// `cargo tauri dev`. Tauri 2.x (checked tauri-2.11.5's own source, `path::desktop::resource_dir`
/// / tauri-utils-2.9.3's `platform::resource_dir_from`) has no public `isPackaged`-style API on
/// desktop -- on Windows it special-cases `resource_dir()` to always return the running exe's own
/// directory in BOTH dev and packaged builds, so that alone can't distinguish them either.
/// `debug_assertions` is the correct real signal instead: `cargo tauri dev` always builds the
/// `dev` Cargo profile (debug_assertions=true) and `cargo tauri build` always builds `release`
/// (debug_assertions=false) unless told otherwise -- so this reflects how the binary that is
/// ACTUALLY RUNNING right now was built, not a hardcoded literal.
pub fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

/// Dev-mode-only: this crate's manifest dir's parent (the repo root). `#[cfg(debug_assertions)]`
/// so `CARGO_MANIFEST_DIR` is compiled OUT of a release build entirely -- not just unreached at
/// runtime, but literally absent from the produced binary's source. This is what fixes the
/// dev-path-baked-into-the-shipped-exe bug: previously this same `env!()` call was reachable (and
/// therefore embedded in .rodata) from a `cargo tauri build` release binary too, since Cargo
/// always compiles from whatever machine/checkout is running the build.
#[cfg(debug_assertions)]
fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

#[cfg(not(debug_assertions))]
fn dev_repo_root() -> PathBuf {
    unreachable!("dev_repo_root() is only reachable when is_packaged() is false, which requires debug_assertions")
}

/// Where the backend's on-disk payload lives, resolved once at startup based on whether this is a
/// dev or packaged run -- shared as Tauri-managed state so every command/thread that needs
/// backend-relative paths (get_auth_token, spawn_supervisor, get_build_info) reads the same
/// answer instead of re-deriving `is_packaged`/the root path independently.
#[derive(Clone)]
pub struct BackendRoot {
    pub is_packaged: bool,
    /// Dev: the repo root. Packaged: Tauri's resolved `resource_dir()` (electron/main.js's
    /// `projectRoot`/`process.resourcesPath` equivalent) -- the directory a real
    /// `bundle.resources` payload (`python-env/`, `debugger/`, ...) would be copied into.
    pub root: PathBuf,
}

impl BackendRoot {
    /// `resource_dir_hint` is `app.path().resource_dir()`'s result, threaded in by the caller
    /// (lib.rs's `setup()`, which has the `AppHandle` this needs) since resolving it requires a
    /// live Tauri app; this function only decides which of {dev repo root, packaged resource
    /// dir} is authoritative, based on the real running binary via `is_packaged()`.
    pub fn resolve(resource_dir_hint: Option<PathBuf>) -> Self {
        if is_packaged() {
            let root = resource_dir_hint
                .or_else(|| std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)))
                .unwrap_or_else(|| PathBuf::from("."));
            BackendRoot { is_packaged: true, root }
        } else {
            BackendRoot { is_packaged: false, root: dev_repo_root() }
        }
    }
}

// WIRE-1: MAESTRO_USE_ENGINE=1 makes the sidecar spawn the TypeScript engine
// (engine/dist/main.js, under Node) instead of spawning Python directly. The engine then spawns
// Python itself as ITS OWN child (engine/src/pythonBackend.ts) -- so with the switch on there is
// still exactly one python.exe in the whole tree, just one hop deeper (app.exe -> node.exe ->
// python.exe instead of app.exe -> python.exe). Unset (the default) is byte-for-byte today's
// behavior: spawn_backend() below, nothing else in this file changed. Naming matches the two
// switches engine/src/split.ts and pythonBackend.ts already established
// (MAESTRO_ENGINE_ROUTES, MAESTRO_BROWSER_ENGINE) -- one flag, opt-in, read once at boot.
pub fn use_engine() -> bool {
    std::env::var("MAESTRO_USE_ENGINE").map(|v| v == "1").unwrap_or(false)
}

// Where the built engine entry point lives. Mirrors python_path()'s own dev-vs-packaged split:
// dev is the repo checkout's engine/dist/main.js (produced by `cd engine && npm run build`);
// packaged would be <resource_dir>/engine/dist/main.js, the same "stage it under resources and
// nothing else needs to change" shape python_path()'s packaged branch already uses for
// python-env -- not staged by tauri.conf.json's bundle.resources yet (same open gap as the
// Python payload itself, see docs/plans/txm-status.md's "Build-artifact readiness" section), so a
// real packaged build with the switch on will hit spawn_engine()'s missing-file error below rather
// than silently doing something else.
fn engine_entry_path(root: &BackendRoot) -> PathBuf {
    root.root.join("engine").join("dist").join("main.js")
}

// Node executable to run the engine with. MAESTRO_NODE_PATH (same variable name
// electron/main.js's bundled-node lookup uses, per this repo's own convention) overrides when set
// -- lets a packaged build point at a bundled Node the same way it will eventually point at a
// bundled python-env -- otherwise falls back to whatever `node` resolves to on PATH, which is the
// right choice for the dev opt-in path this ticket targets.
fn node_command() -> PathBuf {
    match std::env::var("MAESTRO_NODE_PATH") {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => PathBuf::from("node"),
    }
}

// Mirrors backend_env() but for the engine: MAESTRO_ENGINE_PORT/HOST are the two vars
// engine/src/main.ts reads to pick its bind address (see that file's enginePort()); MAESTRO_PACKAGED
// is forwarded the same way backend_env() computes it, since engine/src/auth/token.ts's
// resolveDataRoot() branches on it exactly like backend/config/paths.py does. Everything else
// (MAESTRO_ENGINE_ROUTES, MAESTRO_BROWSER_ENGINE, MAESTRO_DATA_ROOT, ...) is inherited unchanged
// from this process's own env, same "don't .env_clear()" posture backend_env() documents.
fn engine_env(port: u16, root: &BackendRoot) -> HashMap<&'static str, String> {
    let mut env = HashMap::new();
    env.insert("MAESTRO_ENGINE_PORT", port.to_string());
    env.insert("MAESTRO_ENGINE_HOST", BACKEND_HOST.to_string());
    env.insert("MAESTRO_PACKAGED", if root.is_packaged { "1" } else { "0" }.to_string());
    env
}

/// Spawns `node <root>/engine/dist/main.js` bound to `port`, mirroring spawn_backend()'s shape
/// (piped stdout/stderr teed into the Rust log, cwd = repo root in dev). Fails loudly -- a plain
/// `std::io::Error` with an actionable message -- if engine/dist/main.js doesn't exist yet, rather
/// than silently falling back to spawning Python directly: MAESTRO_USE_ENGINE=1 is an explicit ask
/// for the engine path, and a silent fallback would hide exactly the "did my build actually run"
/// question a developer flipping this switch is asking. The engine spawns its own Python child
/// (engine/src/pythonBackend.ts) after this returns -- this function itself never touches Python.
pub fn spawn_engine(root: &BackendRoot, port: u16) -> std::io::Result<Child> {
    let entry = engine_entry_path(root);
    if !entry.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!(
                "MAESTRO_USE_ENGINE=1 but {} does not exist -- build it first: `cd engine && npm run build`",
                entry.display()
            ),
        ));
    }
    let node = node_command();
    log::info!("[sidecar] starting engine: {} {} on port {}", node.display(), entry.display(), port);
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(&root.root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in engine_env(port, root) {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || pipe_to_log(stdout, false));
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || pipe_to_log(stderr, true));
    }
    Ok(child)
}

// Mirrors electron/main.js's getPythonPath(): dev branch is win32 .venv/Scripts/python.exe /
// posix .venv/bin/python3 relative to the repo root; packaged branch is <resource_dir>/python-env/
// {python.exe | bin/python3} -- the exact layout electron-builder's `extraResources` (from:
// "python-env") stages today, so a Tauri build that gains an equivalent `bundle.resources` entry
// (see docs/plans/txm-status.md) needs no further change here.
fn python_path(root: &BackendRoot) -> PathBuf {
    if root.is_packaged {
        let env_dir = root.root.join("python-env");
        if cfg!(target_os = "windows") {
            env_dir.join("python.exe")
        } else {
            env_dir.join("bin").join("python3")
        }
    } else if cfg!(target_os = "windows") {
        root.root.join("backend").join(".venv").join("Scripts").join("python.exe")
    } else {
        root.root.join("backend").join(".venv").join("bin").join("python3")
    }
}

/// Mirrors electron/backendPaths.js's `authTokenPath()` 1:1, including the packaged-mode
/// branches: a future packaged Tauri build (TAU-4+) and the Electron app must resolve the exact
/// same file, `<data-root>/auth.token`, since both read the backend's per-install bearer token.
pub struct AuthTokenPathArgs<'a> {
    pub is_packaged: bool,
    pub data_root_override: Option<&'a str>,
    pub platform: &'a str,
    pub home: &'a Path,
    pub appdata: Option<&'a str>,
    pub xdg_data_home: Option<&'a str>,
    pub repo_root: &'a Path,
}

pub fn auth_token_path(args: &AuthTokenPathArgs) -> PathBuf {
    if let Some(root) = args.data_root_override {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            // path.resolve() in the JS makes the override absolute relative to cwd; PathBuf's
            // Path::new(trimmed) is already used as-is, matching the common case of tests and
            // real callers always passing an absolute override.
            return Path::new(trimmed).join("auth.token");
        }
    }
    if !args.is_packaged {
        return args.repo_root.join("backend").join("data").join("auth.token");
    }
    match args.platform {
        "darwin" => args
            .home
            .join("Library")
            .join("Application Support")
            .join("Maestro Studio")
            .join("data")
            .join("auth.token"),
        "win32" => {
            let base = args.appdata.map(Path::new).unwrap_or(args.home);
            base.join("Maestro Studio").join("data").join("auth.token")
        }
        _ => {
            let base = args
                .xdg_data_home
                .map(PathBuf::from)
                .unwrap_or_else(|| args.home.join(".local").join("share"));
            base.join("Maestro Studio").join("data").join("auth.token")
        }
    }
}

/// Resolves the auth token path for the CURRENT process env, matching electron/main.js's
/// getAuthTokenFilePath() -- `root.is_packaged` (a real runtime determination, see
/// `is_packaged()`) picks dev vs. packaged branch instead of a hardcoded `false`, so a genuinely
/// packaged build resolves the same per-OS app-data path Electron's shipped app does.
pub fn resolve_auth_token_path(root: &BackendRoot) -> PathBuf {
    let data_root = std::env::var("MAESTRO_DATA_ROOT").ok();
    let appdata = std::env::var("APPDATA").ok();
    let xdg_data_home = std::env::var("XDG_DATA_HOME").ok();
    auth_token_path(&AuthTokenPathArgs {
        is_packaged: root.is_packaged,
        data_root_override: data_root.as_deref(),
        platform: std::env::consts::OS,
        home: &dirs_home(),
        appdata: appdata.as_deref(),
        xdg_data_home: xdg_data_home.as_deref(),
        repo_root: &root.root,
    })
}

pub fn dirs_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Races a preferred-range probe against a wall clock, same tradeoff as electron/main.js's
/// pickBackendPort(): try 8324..8424 on 127.0.0.1 (the exact interface uvicorn binds), and fall
/// back to an OS-assigned ephemeral port if the whole range is occupied.
///
/// TRI-1 triage (bind-then-drop TOCTOU, confirmed real, not fixed further): the listener above is
/// dropped before the caller's child process gets anywhere near actually binding the same port, so
/// another process on the machine could in principle steal it first. Closing that window for real
/// needs OS-level socket handoff (bind here, pass the fd/handle to the spawned Python process,
/// have uvicorn attach to it instead of calling its own bind()) -- that requires backend-side
/// cooperation, out of scope while backend/** is frozen this phase. This is not a regression: it is
/// the exact tradeoff electron/main.js's pickBackendPort() already made. It is also already bounded
/// and self-healing here: a stolen port makes the spawned child fail its own bind and exit almost
/// immediately, which spawn_supervisor's loop observes as an unexpected exit and retries with a
/// freshly-probed port, subject to restart_policy's MAX_RESTARTS/backoff -- whose own sizing
/// rationale (restart_policy.rs's module doc comment) explicitly names transient port issues as
/// one of the causes that budget exists to absorb.
pub fn pick_backend_port() -> u16 {
    for port in PREFERRED_PORT_RANGE {
        if let Ok(listener) = TcpListener::bind((BACKEND_HOST, port)) {
            drop(listener);
            return port;
        }
    }
    log::warn!("[sidecar] preferred port range 8324..8424 is occupied — falling back to an OS-assigned port");
    let listener = TcpListener::bind((BACKEND_HOST, 0)).expect("failed to bind an OS-assigned port");
    let port = listener.local_addr().expect("bound listener has no local_addr").port();
    drop(listener);
    port
}

/// Builds the env var contract, mirroring electron/main.js's startBackend() env object:
/// MAESTRO_PORT/MAESTRO_PACKAGED are always set (MAESTRO_PACKAGED now reflects the real
/// `root.is_packaged`, not a hardcoded "0"); MAESTRO_DATA_ROOT, MAESTRO_STATE_HOME,
/// MAESTRO_NODE_PATH and MAESTRO_INSTALLATION_ID are never set by Electron either -- the backend
/// reads them straight off the *inherited* process env if a caller (a test harness, a developer's
/// shell) set them, which `Command` gives us for free by not calling `.env_clear()`. Packaged mode
/// additionally sets PYTHONPATH, mirroring electron/main.js's isPackaged branch exactly
/// (projectRoot + debugger dir + python-env's site-packages, joined with the platform delimiter).
fn backend_env(port: u16, root: &BackendRoot) -> HashMap<&'static str, String> {
    let mut env = HashMap::new();
    env.insert("MAESTRO_PACKAGED", if root.is_packaged { "1" } else { "0" }.to_string());
    env.insert("MAESTRO_PORT", port.to_string());
    // Electron computes this from Intl.DateTimeFormat().resolvedOptions().timeZone; iana-time-zone
    // is the Rust equivalent cross-platform IANA-name lookup. Empty string on lookup failure,
    // same fallback electron/main.js uses (`|| ''`).
    env.insert(
        "MAESTRO_TIMEZONE",
        iana_time_zone::get_timezone().unwrap_or_default(),
    );
    // PEP 540 UTF-8 mode + no .pyc writes: same two interpreter flags electron/main.js sets
    // unconditionally for every backend spawn (dev and packaged alike).
    env.insert("PYTHONDONTWRITEBYTECODE", "1".to_string());
    env.insert("PYTHONUTF8", "1".to_string());
    if root.is_packaged {
        let site_packages = if cfg!(target_os = "windows") {
            root.root.join("python-env").join("Lib").join("site-packages")
        } else {
            root.root.join("python-env").join("lib").join("python3.13").join("site-packages")
        };
        let debugger_dir = root.root.join("debugger");
        if let Ok(joined) = std::env::join_paths([root.root.clone(), debugger_dir, site_packages]) {
            env.insert("PYTHONPATH", joined.to_string_lossy().to_string());
        }
    }
    env
}

/// Spawns `python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port <port>` with cwd =
/// `root.root` (repo root in dev, resource dir in a packaged build), mirroring electron/main.js's
/// startBackend() spawn call (`cwd: projectRoot`, same dev/packaged split).
pub fn spawn_backend(root: &BackendRoot, port: u16) -> std::io::Result<Child> {
    let python = python_path(root);
    log::info!("[sidecar] starting backend: {} on port {}", python.display(), port);
    let mut cmd = Command::new(&python);
    cmd.args([
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        BACKEND_HOST,
        "--port",
        &port.to_string(),
    ])
    .current_dir(&root.root)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    for (k, v) in backend_env(port, root) {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn()?;

    // Tee stdout/stderr into the Rust log, same purpose as electron/main.js's `[backend]`-prefixed
    // console forwarding: the packaged app has no console of its own to read otherwise.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || pipe_to_log(stdout, false));
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || pipe_to_log(stderr, true));
    }
    Ok(child)
}

fn pipe_to_log<R: Read>(mut reader: R, is_err: bool) {
    let mut buf = [0u8; 4096];
    let mut carry = String::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                carry.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(idx) = carry.find('\n') {
                    let line: String = carry.drain(..=idx).collect();
                    let line = line.trim_end();
                    if is_err {
                        log::error!("[backend] {}", line);
                    } else {
                        log::info!("[backend] {}", line);
                    }
                }
            }
            Err(_) => break,
        }
    }
    if !carry.is_empty() {
        if is_err {
            log::error!("[backend] {}", carry);
        } else {
            log::info!("[backend] {}", carry);
        }
    }
}

/// Polls GET /api/health/check until it answers 200, or the child exits, or `timeout` elapses.
/// Mirrors electron/main.js's waitForBackend(): 500ms between polls, bail out early (rather than
/// polling forever) the moment the child has already exited.
pub fn wait_for_health(port: u16, child: &mut Child, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("backend process exited with {:?} during startup", status.code()));
        }
        if http_get_is_ok(port, "/api/health/check", Duration::from_millis(2000)) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("backend did not become healthy within {:?}", timeout));
        }
        thread::sleep(Duration::from_millis(500));
    }
}

/// One-shot health probe used by the crash-detection poll (see `supervise`) to notice a
/// respawned backend has come back up, without pulling in an HTTP client crate for a single
/// GET request.
fn http_get_is_ok(port: u16, path: &str, timeout: Duration) -> bool {
    let addr: SocketAddr = match format!("{BACKEND_HOST}:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {BACKEND_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut resp = Vec::new();
    if stream.read_to_end(&mut resp).is_err() && resp.is_empty() {
        return false;
    }
    let text = String::from_utf8_lossy(&resp);
    text.lines().next().unwrap_or("").contains(" 200 ")
}

// Windows: Child::kill() only signals the direct child, leaving grandchildren (the 9Router node
// process the backend spawns) orphaned. `taskkill /T /F` walks the whole process tree, same as
// electron/main.js's killBackend(). POSIX doesn't need this repo's dev flow (Windows-only per
// CLAUDE.md) but SIGTERM-then-kill is a reasonable direct equivalent if it ever runs there.
fn kill_tree(child: &mut Child) {
    let pid = child.id();
    if cfg!(target_os = "windows") {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if status.is_err() {
            let _ = child.kill();
        }
    } else {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Spawns the backend and supervises it for the lifetime of the app: waits for health, publishes
/// the resolved port into `Sidecar`, and on an unexpected exit re-applies
/// `restart_policy::decide_restart` exactly as electron/main.js's maybeRestartBackend() does,
/// bounded to MAX_RESTARTS attempts within the restart window. Runs on its own OS thread so
/// `tauri::Builder::setup` (which must return quickly) isn't blocked on the health poll.
pub fn spawn_supervisor(app_handle: AppHandle, root: BackendRoot) {
    thread::spawn(move || {
        // `Sidecar` is managed via `app.manage()` in lib.rs; this handle is Send + owned by the
        // thread for its whole lifetime, so borrowing the managed state through it for the
        // duration of the loop is sound without needing a `'static` reference or our own Arc.
        let sidecar: &Sidecar = app_handle.state::<Sidecar>().inner();
        // WIRE-1: read once at supervisor start, not per-attempt -- flipping the env var mid-run
        // isn't a supported scenario (same posture as every other MAESTRO_* switch in this repo).
        let engine_mode = use_engine();
        if engine_mode {
            log::info!("[sidecar] MAESTRO_USE_ENGINE=1 -- spawning the TypeScript engine (engine/dist/main.js) instead of Python directly; the engine owns the one Python child from here on");
        }
        let mut attempts: Vec<i64> = Vec::new();
        loop {
            let port = pick_backend_port();
            let spawn_result = if engine_mode { spawn_engine(&root, port) } else { spawn_backend(&root, port) };
            let mut child = match spawn_result {
                Ok(c) => c,
                Err(err) => {
                    log::error!("[sidecar] {} failed to spawn: {}", if engine_mode { "engine" } else { "backend" }, err);
                    // Treat a spawn failure the same as any other unexpected exit: it still
                    // consumes an attempt and is still subject to the same bound, matching
                    // electron/main.js (spawn 'error' there feeds into the same exit-driven
                    // maybeRestartBackend() path via waitForBackend()'s rejection).
                    if !apply_restart_decision(&app_handle, sidecar, &mut attempts) {
                        return;
                    }
                    continue;
                }
            };

            sidecar.port.store(port, Ordering::SeqCst);
            match wait_for_health(port, &mut child, Duration::from_secs(180)) {
                Ok(()) => {
                    log::info!("[sidecar] backend ready on port {}", port);
                    sidecar.ready.store(true, Ordering::SeqCst);
                }
                Err(err) => log::error!("[sidecar] backend startup failed: {}", err),
            }
            *sidecar.child.lock().unwrap() = Some(child);

            // Wait for the child to exit (whether it came up healthy and later crashed, or never
            // came up at all) -- same trigger as electron/main.js's 'exit' listener, which is what
            // actually drives maybeRestartBackend(). Polls rather than blocking on Child::wait()
            // while holding sidecar.child's mutex: a blocking wait() under that lock would make
            // shutdown() (which also needs this same lock to force-kill a hung/long-running child)
            // itself block until the child exits on its own -- exactly backwards for a forced
            // teardown, and a real hang if the child never exits by itself. See wait_for_child_exit.
            let status = wait_for_child_exit(sidecar);
            sidecar.ready.store(false, Ordering::SeqCst);
            match status {
                Some(status) => log::warn!("[sidecar] backend exited: {:?}", status),
                None => break, // shutdown() already took + killed it
            }

            if !apply_restart_decision(&app_handle, sidecar, &mut attempts) {
                return;
            }
        }
    });
}

/// Waits for the current child to exit, polling `Child::try_wait()` under a briefly-held lock
/// instead of blocking on `Child::wait()` while holding `sidecar.child`'s mutex for the whole
/// (possibly unbounded) duration -- see spawn_supervisor's call site for why that matters.
/// Returns the exit status once the child has actually exited, or `None` if `shutdown()` already
/// took (and killed) the child before this observed it -- the caller treats that as "stop, don't
/// restart", matching the previous behavior's `None => break`.
fn wait_for_child_exit(sidecar: &Sidecar) -> Option<std::process::ExitStatus> {
    loop {
        let mut guard = sidecar.child.lock().unwrap();
        match guard.as_mut() {
            None => return None,
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    return Some(status);
                }
                Ok(None) => {
                    // Not exited yet: drop the lock BEFORE sleeping so a concurrent shutdown()
                    // (or any other caller) can acquire it and force-kill the child immediately,
                    // rather than waiting out however long this poll would otherwise take.
                    drop(guard);
                    thread::sleep(Duration::from_millis(100));
                }
                Err(err) => {
                    log::error!("[sidecar] error polling backend exit status: {}", err);
                    *guard = None;
                    return None;
                }
            },
        }
    }
}

/// Runs one decide/act cycle of the restart policy against the current `sidecar` flags. Returns
/// true if the caller should loop around and spawn again (after sleeping the backoff delay),
/// false if it should stop (clean exit, or the restart budget is exhausted).
fn apply_restart_decision(app_handle: &AppHandle, sidecar: &Sidecar, attempts: &mut Vec<i64>) -> bool {
    let ctx = RestartContext {
        intentional: sidecar.intentional.swap(false, Ordering::SeqCst), // one-shot, same as electron/main.js
        quitting: sidecar.quitting.load(Ordering::SeqCst),
        installing_update: false, // no updater in this Tauri build yet
        attempt_timestamps: attempts.clone(),
        now: now_ms(),
    };
    let decision = decide_restart(&ctx);
    if !decision.restart {
        log::info!("[sidecar] not restarting backend ({})", decision.reason);
        if decision.exhausted {
            log::error!(
                "[sidecar] giving up on the backend after the restart bound was exhausted ({} attempts)",
                MAX_RESTARTS
            );
            // Rust-side equivalent of electron/main.js's 'backend-unrecoverable' IPC event: same
            // event name, so a future frontend listener (TAU-4+) doesn't need a second name to
            // handle depending on which shell it's running under.
            let _ = app_handle.emit("backend-unrecoverable", MAX_RESTARTS);
        }
        return false;
    }
    attempts.push(now_ms());
    *attempts = recent_attempts(attempts, now_ms());
    log::warn!(
        "[sidecar] backend exited unexpectedly; restart {}/{} in {}ms",
        attempts.len(),
        MAX_RESTARTS,
        decision.delay_ms
    );
    thread::sleep(Duration::from_millis(decision.delay_ms));
    true
}

#[cfg(test)]
mod tests {
    // Regression coverage for TRI-1 finding #4 (a real bug, confirmed and fixed): the supervisor
    // used to block on `Child::wait()` while holding `sidecar.child`'s mutex for the whole
    // (possibly unbounded) duration, so `shutdown()`'s own `self.child.lock()` -- needed to
    // force-kill a hung/long-running child -- would itself block until the child exited on its
    // own. That is exactly backwards for a forced teardown. `wait_for_child_exit` now polls
    // `try_wait()` under a lock held only briefly per attempt, so shutdown() can interrupt it.
    use super::*;
    use std::sync::Arc;

    fn spawn_long_running_child() -> Child {
        // A process that reliably keeps running for ~30s without a test-specific binary: ping's
        // own built-in interval, present on every Windows install (this crate targets Windows
        // only per this repo's CLAUDE.md).
        Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn a long-running test child (ping)")
    }

    #[test]
    fn shutdown_kills_a_long_running_child_promptly_even_during_a_concurrent_wait_poll() {
        let sidecar = Arc::new(Sidecar::default());
        *sidecar.child.lock().unwrap() = Some(spawn_long_running_child());

        let poller_sidecar = Arc::clone(&sidecar);
        let poller = thread::spawn(move || wait_for_child_exit(&poller_sidecar));

        // Give the poller a moment to actually start looping (acquire + release the lock at
        // least once) before racing shutdown() against it.
        thread::sleep(Duration::from_millis(250));

        let started = Instant::now();
        sidecar.shutdown();
        let elapsed = started.elapsed();

        // Generous margin for CI slowness, but nowhere near the child's ~30s natural lifetime --
        // that gap is exactly the deadlock this test guards against. Pre-fix, this assertion
        // would see `elapsed` on the order of 29+ seconds (or hang until the test harness's own
        // timeout), since shutdown() couldn't acquire the mutex until the ping process exited by
        // itself.
        assert!(
            elapsed < Duration::from_secs(5),
            "shutdown() took {:?} to kill a still-running child -- it should force-kill \
             promptly instead of waiting out the child's natural lifetime",
            elapsed
        );

        // The poller must actually return (not hang forever on a child that's already gone), and
        // must report "already taken by shutdown()" (None), not a status it invented itself.
        let poller_result = poller.join().expect("poller thread panicked");
        assert_eq!(poller_result, None);
    }

    #[test]
    fn wait_for_child_exit_reports_the_real_exit_status_for_a_child_that_exits_on_its_own() {
        let sidecar = Sidecar::default();
        // A trivial, fast-exiting child -- unlike the other test, this one is meant to finish on
        // its own so wait_for_child_exit's Ok(Some(status)) branch (not the shutdown-raced None
        // branch) is what gets exercised.
        let child = Command::new("cmd")
            .args(["/C", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn a short-lived test child (cmd)");
        *sidecar.child.lock().unwrap() = Some(child);

        let status = wait_for_child_exit(&sidecar);
        assert!(status.is_some(), "a child that exited on its own must report Some(status), not None");
        assert!(status.unwrap().success());
        // wait_for_child_exit must have cleared the slot so the caller doesn't see a stale Some.
        assert!(sidecar.child.lock().unwrap().is_none());
    }
}
