// TAU-4: the four ShellBridge commands frontend/src/shared/shell/tauriShell.ts calls that
// TAU-2 did not already stub. get_backend_port and get_auth_token stay in lib.rs (TAU-2 put them
// there ahead of schedule to unblock the blank-webview bug; the TXM status ledger says extend,
// don't duplicate) -- this file only adds get_app_version, get_build_info, open_external and
// hard_reset, all registered alongside the other two in lib.rs's invoke_handler.

#[cfg(debug_assertions)]
use std::path::PathBuf;
#[cfg(debug_assertions)]
use std::process::Command;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::sidecar::Sidecar;

/// Mirrors electron/main.js's getBuildInfo() return shape 1:1 (see preload.js's `getBuildInfo`
/// doc comment) so ShellBridge's `ShellBuildInfo` type needs no Tauri-specific branching.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    sha: String,
    short_sha: String,
    built_at: Option<String>,
    channel: String,
}

#[tauri::command]
pub fn get_app_version() -> String {
    // Cargo.toml's `version` is the source of truth for this crate and is kept in sync with
    // tauri.conf.json's `version` by hand (both read "0.1.0" as of this ticket); reading it via
    // this compile-time env var avoids parsing either file at runtime.
    env!("CARGO_PKG_VERSION").to_string()
}

static BUILD_INFO: OnceLock<BuildInfo> = OnceLock::new();

/// Mirrors electron/main.js's getBuildInfo(): a packaged build ships a generated
/// `build-info.json` (there, next to main.js inside the asar; here, next to the built exe) that
/// names the exact commit; dev mode has no such file, so fall back to a live `git rev-parse HEAD`
/// tagged 'dev', same as the JS. Cached after first read (`_buildInfoCache` there, `OnceLock` here).
fn compute_build_info() -> BuildInfo {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Ok(raw) = std::fs::read_to_string(dir.join("build-info.json")) {
                if let Ok(parsed) = serde_json::from_str::<BuildInfo>(&raw) {
                    return parsed;
                }
            }
        }
    }
    if let Some(info) = dev_git_build_info() {
        return info;
    }
    BuildInfo {
        sha: "unknown".to_string(),
        short_sha: "unknown".to_string(),
        built_at: None,
        channel: "unknown".to_string(),
    }
}

// Dev-mode-only fallback: `git rev-parse HEAD` against the repo checkout, same as
// electron/main.js's dev branch. `#[cfg(debug_assertions)]`-gated (like
// sidecar::dev_repo_root()) so `CARGO_MANIFEST_DIR` never gets embedded in a release binary --
// a real packaged build has no repo checkout / `.git` to `rev-parse` anyway, and always ships a
// `build-info.json` instead (the branch above), so this literally has nothing to do there.
#[cfg(debug_assertions)]
fn dev_git_build_info() -> Option<BuildInfo> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let out = Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&repo_root).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if sha.is_empty() {
        return None;
    }
    Some(BuildInfo {
        short_sha: sha.chars().take(12).collect(),
        sha,
        built_at: None,
        channel: "dev".to_string(),
    })
}

#[cfg(not(debug_assertions))]
fn dev_git_build_info() -> Option<BuildInfo> {
    None
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BUILD_INFO.get_or_init(compute_build_info).clone()
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    // Mirrors electron/main.js's 'open-external' handler exactly: only ever hand the OS opener a
    // well-formed http(s) URL, silently no-op on anything else instead of erroring.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Ok(());
    }
    // The plain function form (vs. `AppHandle::opener()`) needs no plugin registration or
    // capability grant -- it shells out to the OS opener directly, the same trust boundary as
    // Electron's `shell.openExternal`, which this command already gates the same way.
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hard_reset(app: AppHandle, sidecar: tauri::State<Sidecar>) {
    // Mirrors electron/main.js's hard-reset handler: stop the backend first (a live process holds
    // its files open on Windows), best-effort wipe the app's own data dir, then relaunch into a
    // clean first run. Every step is best-effort, same as the JS's try/catch-per-step shape, so a
    // failed kill or wipe still relaunches rather than wedging the user.
    //
    // Documented gap, not a silent omission: Electron wipes `app.getPath('userData')/data`, which
    // in a *packaged* run can be the same tree `MAESTRO_DATA_ROOT` points the backend at
    // (dashboards, workspaces, auth.token). This build's dev-mode `Sidecar`/`auth_token_path`
    // always resolve to `<repo>/backend/data` (see sidecar.rs), which this command deliberately
    // does NOT touch -- wiping the developer's real backend/data would delete their live auth
    // token and workspaces, not "factory reset" a throwaway packaged install. Tauri's own
    // `app_data_dir()` (`<OS data dir>/net.martinstech.maestro.studio`) is wiped instead, since
    // nothing in this build's dev flow writes there yet (ENG-3's settings store is still queued in
    // docs/plans/txm-status.md) -- true packaged-mode parity belongs with that ticket, once
    // MAESTRO_DATA_ROOT is actually wired to this same directory.
    sidecar.shutdown();
    if let Ok(dir) = app.path().app_data_dir() {
        let data_dir = dir.join("data");
        match std::fs::remove_dir_all(&data_dir) {
            Ok(()) => log::info!("[hard-reset] wiped data dir"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::error!("[hard-reset] wipe failed: {}", e),
        }
    }
    app.restart();
}
