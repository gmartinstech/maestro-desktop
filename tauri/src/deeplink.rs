// Ported from electron/main.js's maestro:// deep-link plumbing: the top-of-file
// `app.setAsDefaultProtocolClient('maestro')` registration (main.js:285-295) and
// `forwardDeepLinkToRenderer()` (main.js:301-322). Uses the `tauri-plugin-deep-link` crate, which
// needs the scheme declared in tauri.conf.json's `plugins.deep-link.desktop.schemes` (already
// added there) so its own argv parsing on Windows/Linux only matches configured schemes.
//
// Full onOauthClaim wiring into the frontend (the renderer-side handler for the
// 'maestro:oauth-claim' event this module emits) is TAU-4/later scope, per the ticket -- this
// module's job is only to prove the OS-level deep link reaches the Rust side and can be routed.

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

/// Registers this build as the OS's `maestro://` handler and wires the live (already-running-app)
/// deep-link listener. Call once from `setup()`, mirroring where main.js's registration runs
/// (synchronously, before the rest of boot).
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if let Err(err) = app.deep_link().register_all() {
        log::warn!("[deeplink] failed to register the maestro:// scheme: {}", err);
    }

    let app_handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_url(&app_handle, url.as_str());
        }
    });

    // Cold launch: the plugin's own setup already parsed argv for a matching maestro://
    // argument and cached it (see tauri-plugin-deep-link's handle_cli_arguments), but that ran
    // before our on_open_url listener above existed, so its 'deep-link://new-url' emit could have
    // been missed. get_current() re-reads the cached value, so flush it explicitly too.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            handle_url(app, url.as_str());
        }
    }
}

/// Extracts the `maestro://...` argument from a second-instance's argv, mirroring main.js's
/// `extractMaestroUrl()`. Used by the single-instance callback in lib.rs.
pub fn extract_maestro_url(argv: &[String]) -> Option<&str> {
    argv.iter().map(String::as_str).find(|a| a.starts_with("maestro://"))
}

/// Mirrors main.js's forwardDeepLinkToRenderer(): the only deep link this build currently routes
/// anywhere is the tool OAuth claim (`maestro://oauth/{provider}/complete`) -- everything else is
/// logged and dropped, same as the JS. Logging the received URL unconditionally (before the
/// filter) is what the ticket's gate (c) checks for: proof the Rust side received it.
pub fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &str) {
    log::info!("[deeplink] received {}", url);

    let path = url
        .strip_prefix("maestro://")
        .unwrap_or(url)
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    let is_oauth_complete = path.starts_with("oauth/") && path.ends_with("/complete");
    if !is_oauth_complete {
        log::info!("[deeplink] no route for this URL yet (TAU-4+ scope); dropping");
        return;
    }

    match app.get_webview_window(crate::splash::MAIN_LABEL) {
        Some(window) => {
            if let Err(err) = window.emit("maestro:oauth-claim", url) {
                log::error!("[deeplink] failed to emit oauth-claim to the main window: {}", err);
            }
        }
        None => {
            // main.js stashes this in `pendingDeepLink` and flushes it once the renderer's
            // did-finish-load fires (cold-launch case). Not ported here -- the gate only asks for
            // proof of receipt while the app is running (gate c), and queuing across the boot
            // race is exactly the onOauthClaim frontend wiring the ticket defers to TAU-4+.
            log::warn!("[deeplink] received oauth-claim before the main window existed; dropping");
        }
    }
}
