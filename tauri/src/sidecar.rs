// Spawns the Python backend as a sidecar process and supervises it: pick a free port, launch
// uvicorn, poll /api/health/check until it answers, and on an unexpected exit hand the decision
// of whether to respawn to `restart_policy::decide_restart`.
//
// Ported from electron/main.js's startBackend()/waitForBackend()/pickBackendPort()/
// maybeRestartBackend()/killBackend(), mirroring DEV-mode behavior only (spawns
// backend/.venv/Scripts/python.exe directly) -- this repo's local checkout has no bundled
// python-env, so the packaged-mode branches of the JS (process.resourcesPath, python-env/,
// bundled node) are intentionally not ported here. authTokenPath() below is the one exception:
// its packaged-mode branches ARE ported, because TAU-4 needs the exact same resolution the
// Electron app uses so both shells agree on where the per-install bearer token lives, even
// though this build never actually runs isPackaged=true today.

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

// Mirrors electron/main.js's getPythonPath() DEV branch only (win32 .venv/Scripts/python.exe,
// posix .venv/bin/python3) -- packaged mode (process.resourcesPath/python-env) is not ported,
// per this repo's local checkout having no bundled python-env.
fn python_path(repo_root: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        repo_root.join("backend").join(".venv").join("Scripts").join("python.exe")
    } else {
        repo_root.join("backend").join(".venv").join("bin").join("python3")
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

/// Resolves the dev-mode auth token path for the CURRENT process env, matching
/// electron/main.js's getAuthTokenFilePath() (isPackaged is always false in this repo's local
/// Tauri checkout -- see module doc comment).
pub fn dev_auth_token_path(repo_root: &Path) -> PathBuf {
    let data_root = std::env::var("MAESTRO_DATA_ROOT").ok();
    auth_token_path(&AuthTokenPathArgs {
        is_packaged: false,
        data_root_override: data_root.as_deref(),
        platform: std::env::consts::OS,
        home: &dirs_home(),
        appdata: None,
        xdg_data_home: None,
        repo_root,
    })
}

fn dirs_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Races a preferred-range probe against a wall clock, same tradeoff as electron/main.js's
/// pickBackendPort(): try 8324..8424 on 127.0.0.1 (the exact interface uvicorn binds), and fall
/// back to an OS-assigned ephemeral port if the whole range is occupied.
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

/// Builds the dev-mode env var contract, mirroring electron/main.js's startBackend() env object
/// (DEV branch only): MAESTRO_PORT and MAESTRO_PACKAGED are always set here; MAESTRO_DATA_ROOT,
/// MAESTRO_STATE_HOME, MAESTRO_NODE_PATH and MAESTRO_INSTALLATION_ID are never set by Electron
/// either -- the backend reads them straight off the *inherited* process env if a caller (a
/// test harness, a developer's shell) set them, which `Command` gives us for free by not calling
/// `.env_clear()`. Only the few keys Electron computes itself are listed here.
fn backend_env(port: u16) -> HashMap<&'static str, String> {
    let mut env = HashMap::new();
    env.insert("MAESTRO_PACKAGED", "0".to_string());
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
    env
}

/// Spawns `python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port <port>` with cwd =
/// repo root, mirroring electron/main.js's startBackend() spawn call (DEV mode: no PYTHONPATH
/// override, since that's only added for the packaged python-env's site-packages layout).
pub fn spawn_backend(repo_root: &Path, port: u16) -> std::io::Result<Child> {
    let python = python_path(repo_root);
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
    .current_dir(repo_root)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    for (k, v) in backend_env(port) {
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
pub fn spawn_supervisor(app_handle: AppHandle, repo_root: PathBuf) {
    thread::spawn(move || {
        // `Sidecar` is managed via `app.manage()` in lib.rs; this handle is Send + owned by the
        // thread for its whole lifetime, so borrowing the managed state through it for the
        // duration of the loop is sound without needing a `'static` reference or our own Arc.
        let sidecar: &Sidecar = app_handle.state::<Sidecar>().inner();
        let mut attempts: Vec<i64> = Vec::new();
        loop {
            let port = pick_backend_port();
            let mut child = match spawn_backend(&repo_root, port) {
                Ok(c) => c,
                Err(err) => {
                    log::error!("[sidecar] backend failed to spawn: {}", err);
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

            // Block until the child actually exits (whether it came up healthy and later
            // crashed, or never came up at all) -- same as electron/main.js's 'exit' listener,
            // which is what actually drives maybeRestartBackend().
            let status = {
                let mut guard = sidecar.child.lock().unwrap();
                match guard.as_mut() {
                    Some(c) => c.wait(),
                    None => break, // shutdown() already took + killed it
                }
            };
            *sidecar.child.lock().unwrap() = None;
            sidecar.ready.store(false, Ordering::SeqCst);
            log::warn!("[sidecar] backend exited: {:?}", status);

            if !apply_restart_decision(&app_handle, sidecar, &mut attempts) {
                return;
            }
        }
    });
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
