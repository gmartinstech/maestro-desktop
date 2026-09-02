// Ported from electron/main.js's createSplashWindow() / emitSplashStatus() / the 'splash:action'
// IPC handler (see main.js:588-654 and :2859-2882): a small frameless window shown immediately at
// launch so a cold-Defender-scan Windows install shows motion within ~1s instead of a blank
// taskbar icon for 30-60s, updated with status text as boot progresses, and torn down once the
// main window + backend are both ready.
//
// Content is `splash/splash.html` (own minimal page, not a port of the Electron splash's WebGL
// shader background -- that's a large, purely-cosmetic diff and out of scope for this ticket)
// embedded as a self-contained data: URL, same trust boundary the Electron version used (no
// remote resources, no relation to frontendDist).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SPLASH_LABEL: &str = "splash";
pub const MAIN_LABEL: &str = "main";

const SPLASH_HTML: &str = include_str!("../splash/splash.html");

/// Rust-side stand-in for Electron's `ready-to-show` signal on the main window: flipped once the
/// "main" webview's page load has finished (see lib.rs's `on_page_load` hook). The boot
/// coordinator (`spawn_boot_coordinator` in lib.rs) waits on this plus `Sidecar::is_ready()`
/// before swapping splash -> main, mirroring main.js's `swapToMain()` gate on both
/// `mainWindowReady` and `backendReady`.
#[derive(Default)]
pub struct MainWindowReady(AtomicBool);

impl MainWindowReady {
    pub fn mark_ready(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

fn splash_data_url() -> String {
    format!(
        "data:text/html;charset=utf-8;base64,{}",
        base64_encode(SPLASH_HTML.as_bytes())
    )
}

// Small self-contained base64 encoder so this file doesn't need a new Cargo dependency just to
// build one data: URL. Standard alphabet, '=' padding.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied();
        let b2 = chunk.get(2).copied();
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1.unwrap_or(0) >> 4)) as usize] as char);
        out.push(match b1 {
            Some(b1) => ALPHABET[(((b1 & 0x0f) << 2) | (b2.unwrap_or(0) >> 6)) as usize] as char,
            None => '=',
        });
        out.push(match b2 {
            Some(b2) => ALPHABET[(b2 & 0x3f) as usize] as char,
            None => '=',
        });
    }
    out
}

/// Mirrors electron/main.js's createSplashWindow(): frameless, fixed-size, centered, no taskbar
/// entry (Electron's `skipTaskbar: true`), opaque background to dodge Windows DWM transparency
/// quirks during the very first paint.
pub fn create_splash_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    WebviewWindowBuilder::new(app, SPLASH_LABEL, WebviewUrl::External(splash_data_url().parse().expect("splash data: URL is well-formed")))
        .title("Maestro Studio")
        .inner_size(460.0, 340.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .center()
        .skip_taskbar(true)
        .always_on_top(false)
        .visible(true)
        .focused(true)
        .shadow(true)
        .build()
}

/// Mirrors electron/main.js's emitSplashStatus(): pushes status text into the splash window if
/// it's still alive, silently no-op otherwise (the boot coordinator can race the splash having
/// already been torn down). Uses `WebviewWindow::eval` rather than a Tauri event, matching how
/// lib.rs already talks to a webview during early boot (see its `on_page_load` error-reporting
/// injection) -- this is more robust than relying on `window.__TAURI__` event listeners being
/// available on a data: URL page.
pub fn emit_splash_status<R: Runtime>(app: &AppHandle<R>, text: &str, level: Option<&str>, show_actions: bool) {
    let Some(window) = app.get_webview_window(SPLASH_LABEL) else {
        return;
    };
    let js = format!(
        "window.__maestroSplash && window.__maestroSplash.setStatus({}, {}, {});",
        serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string()),
        level
            .map(|l| serde_json::to_string(l).unwrap_or_else(|_| "null".to_string()))
            .unwrap_or_else(|| "null".to_string()),
        show_actions,
    );
    let _ = window.eval(js);
}

/// Mirrors electron/main.js's splash `w.on('closed', ...)` teardown: destroy rather than close()
/// so no confirmation/close-event round trip is needed for a window that owns no user data.
pub fn close_splash<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(SPLASH_LABEL) {
        let _ = window.destroy();
    }
}
