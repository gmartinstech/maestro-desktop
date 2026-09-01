use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;

mod commands;
mod deeplink;
mod menu;
mod restart_policy;
mod sidecar;
mod splash;

use sidecar::Sidecar;
use splash::MainWindowReady;

// Forwards an uncaught JS error / unhandled rejection / console.error call from the webview into
// the Rust log, since a debug-build WebView2 has no stderr path back to the terminal on its own.
#[tauri::command]
fn report_js_error(msg: String) {
  log::error!("[webview] {}", msg);
}

// TAU-1's tauriShell.ts already calls these two by name (see frontend/src/shared/shell/tauriShell.ts);
// without them every `/api/*` request 401s (no token) against the wrong port, and the app never
// gets past the settings-load gate in Main.tsx, so the window stays blank.
//
// TAU-3 wires both to the real sidecar now: the port comes from `Sidecar`, populated by
// sidecar::spawn_supervisor() once pick_backend_port() has actually resolved and bound one
// (falling back to MAESTRO_PORT / 8324 only in the brief window before that first resolves), and
// the token path is resolved the same way electron/main.js's getAuthTokenFilePath() does. The
// remaining ShellBridge members (getAppVersion, getBuildInfo, openExternal, hardReset) are
// implemented in commands.rs (TAU-4), left in this file rather than moved here to avoid churn.
#[tauri::command]
fn get_backend_port(sidecar: tauri::State<Sidecar>) -> u16 {
  sidecar.port().unwrap_or_else(|| {
    std::env::var("MAESTRO_PORT")
      .ok()
      .and_then(|p| p.parse().ok())
      .unwrap_or(8324)
  })
}

#[tauri::command]
fn get_auth_token() -> String {
  // Mirrors electron/preload.js's read of the same per-install token file; backend/auth.py is the
  // source of truth for the path and accepts it back as `Authorization: Bearer <token>`.
  let repo_root: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
  let path = sidecar::dev_auth_token_path(&repo_root);
  fs::read_to_string(path)
    .map(|s| s.trim().to_string())
    .unwrap_or_default()
}

// TAU-5: splash 'quit'/'restart'/'open-logs' buttons, mirroring electron/main.js's
// 'splash:action' ipcMain.on handler (main.js:2859-2882). 'open-logs' is not ported -- the
// Electron version reveals a packaged-mode backend log file this dev-mode-only build never
// writes (see sidecar.rs's module doc comment on packaged-mode scope), so it's a documented no-op
// here rather than pointing at a file that doesn't exist.
#[tauri::command]
fn splash_action(app: tauri::AppHandle, sidecar: tauri::State<Sidecar>, action: String) {
  match action.as_str() {
    "quit" => app.exit(0),
    "restart" => {
      sidecar.shutdown();
      app.restart();
    }
    "open-logs" => log::info!("[splash] open-logs requested; no packaged-mode log file in this dev-mode build"),
    other => log::warn!("[splash] unknown splash:action '{}'", other),
  }
}

/// Waits for the backend to report healthy (`Sidecar::is_ready`) and the main window's page to
/// finish its first load (`MainWindowReady`), pushing splash status updates along the way, then
/// shows the main window and tears the splash down. Mirrors electron/main.js's boot sequence
/// (main.js:2034-2141): `emitSplashStatus` calls at each stage, `swapToMain()`'s gate on both
/// `mainWindowReady` and `backendReady`, and its dev-server-down fallback that shows main anyway
/// rather than hanging forever on a load that will never finish.
fn spawn_boot_coordinator(app_handle: tauri::AppHandle) {
  thread::spawn(move || {
    splash::emit_splash_status(&app_handle, "Starting backend…", None, false);

    let sidecar: &Sidecar = app_handle.state::<Sidecar>().inner();
    let backend_deadline = Instant::now() + Duration::from_secs(185); // wait_for_health's own bound + slack
    while !sidecar.is_ready() {
      if Instant::now() >= backend_deadline {
        log::error!("[boot] backend did not become ready in time; leaving splash up with an error");
        splash::emit_splash_status(&app_handle, "Maestro Studio failed to start.", Some("error"), true);
        return;
      }
      thread::sleep(Duration::from_millis(150));
    }

    splash::emit_splash_status(&app_handle, "Almost ready…", None, false);

    let main_ready: &MainWindowReady = app_handle.state::<MainWindowReady>().inner();
    let main_deadline = Instant::now() + Duration::from_secs(15);
    while !main_ready.is_ready() && Instant::now() < main_deadline {
      thread::sleep(Duration::from_millis(50));
    }
    // Falls through (rather than erroring out) past the deadline, same as main.js's did-fail-load
    // fallback: show whatever the main window has instead of hanging on a load that never fires.

    if let Some(main) = app_handle.get_webview_window(splash::MAIN_LABEL) {
      let _ = main.show();
      let _ = main.set_focus();
    }
    // Tiny delay so the OS gets a chance to bring main to front before splash disappears --
    // avoids a single-frame "no window" gap on Windows, same as main.js's setTimeout(..., 120).
    thread::sleep(Duration::from_millis(120));
    splash::close_splash(&app_handle);
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Per Tauri's own guidance this must be the first plugin registered. Mirrors
    // electron/main.js's app.requestSingleInstanceLock() + 'second-instance' handler
    // (main.js:328-343): a second launch is swallowed, the existing window is restored +
    // focused, and any maestro:// URL on its argv is routed the same way a live deep link would be.
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(window) = app.get_webview_window(splash::MAIN_LABEL) {
        if window.is_minimized().unwrap_or(false) {
          let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
      }
      if let Some(url) = deeplink::extract_maestro_url(&argv) {
        deeplink::handle_url(app, url);
      }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .manage(Sidecar::default())
    .manage(MainWindowReady::default())
    .invoke_handler(tauri::generate_handler![
      report_js_error,
      get_backend_port,
      get_auth_token,
      splash_action,
      commands::get_app_version,
      commands::get_build_info,
      commands::open_external,
      commands::hard_reset
    ])
    .on_page_load(|window, payload| {
      // Installed before any page script runs (PageLoadEvent::Started), so it catches errors
      // thrown during the frontend bundle's own module-init code, not just later at runtime.
      if cfg!(debug_assertions) && payload.event() == tauri::webview::PageLoadEvent::Started {
        let _ = window.eval(
          "window.addEventListener('error', function(e) {\
             try { window.__TAURI_INTERNALS__.invoke('report_js_error', { msg: 'uncaught: ' + (e.error && e.error.stack ? e.error.stack : e.message) }); } catch(_e) {}\
           });\
           window.addEventListener('unhandledrejection', function(e) {\
             try { var r = e.reason; window.__TAURI_INTERNALS__.invoke('report_js_error', { msg: 'unhandledrejection: ' + (r && r.stack ? r.stack : r) }); } catch(_e) {}\
           });\
           var _origErr = console.error;\
           console.error = function() {\
             try { window.__TAURI_INTERNALS__.invoke('report_js_error', { msg: 'console.error: ' + Array.prototype.slice.call(arguments).join(' ') }); } catch(_e) {}\
             _origErr.apply(console, arguments);\
           };",
        );
      }
      // Rust-side proxy for Electron's `ready-to-show` on the main window (see splash.rs's
      // `MainWindowReady` doc comment) -- flips once, on the first Finished load of "main".
      if payload.event() == tauri::webview::PageLoadEvent::Finished && window.label() == splash::MAIN_LABEL {
        window.app_handle().state::<MainWindowReady>().mark_ready();
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // App menu (TAU-5): registered even though nothing in this build hides its strip behind a
      // custom titlebar yet (that's the "unified titlebar" work the ticket says to only read, not
      // port -- see docs/HANDOFF.md §9). View -> Reload and the rest of the accelerators are live
      // either way, since Tauri's native menu strip stays visible on Windows.
      let app_menu = menu::build_app_menu(app.handle())?;
      app.set_menu(app_menu)?;
      app.on_menu_event(|app_handle, event| menu::handle_menu_event(app_handle, event));

      // maestro:// deep link registration + live-URL listener (TAU-5).
      deeplink::init(app.handle());

      // Splash window (TAU-5): shown immediately so the user sees motion within ~1s of launch,
      // mirroring main.js's boot sequence starting with `splashWindow = createSplashWindow()`.
      splash::create_splash_window(app.handle())?;

      // Spawns the backend sidecar and supervises it (health poll, bounded restart-on-crash) for
      // the app's whole lifetime. Runs on its own OS thread so `setup` (which must return
      // quickly) isn't blocked on the health poll -- see sidecar::spawn_supervisor's doc comment.
      // repo root = this crate's manifest dir's parent, same anchor get_auth_token() already used
      // pre-TAU-3 for the dev-mode auth.token path.
      let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
      sidecar::spawn_supervisor(app.handle().clone(), repo_root.clone());

      // Waits on backend + main-window readiness, then swaps splash -> main (TAU-5).
      spawn_boot_coordinator(app.handle().clone());

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // Mirrors electron/main.js's appIsQuitting flag + killBackend(): the moment the app starts
      // tearing down, mark the exit intentional and kill the child tree so the supervisor's
      // restart policy vetoes instead of respawning python.exe into a closing app.
      if let tauri::RunEvent::Exit = event {
        app_handle.state::<Sidecar>().shutdown();
      }
    });
}
