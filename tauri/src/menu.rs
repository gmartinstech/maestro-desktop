// Ported from electron/main.js's buildAppMenu() (main.js:1193-1211). electron/main.js keeps this
// menu registered even though its *strip* is hidden behind the unified titlebar's hamburger (see
// main.js:1189-1192 and docs/HANDOFF.md §9's explicit warning) -- AppShell.tsx depends on the
// View -> Reload accelerator actually working. This Rust port preserves that accelerator (and the
// other standard accelerators an app menu carries: Undo/Redo/Cut/Copy/Paste/Select All, window
// Minimize/Close, Toggle Fullscreen, Quit) via Tauri's menu API. Do NOT reduce this to a bare
// menu or skip registering it -- see the same warning that guards the Electron original.

use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

const RELOAD_ID: &str = "view_reload";
const FORCE_RELOAD_ID: &str = "view_force_reload";
const TOGGLE_DEVTOOLS_ID: &str = "view_toggle_devtools";
const HELP_GITHUB_ID: &str = "help_github";

/// Builds the full app menu. Mirrors buildAppMenu()'s shape: a macOS-only app submenu, then
/// File/Edit/View/Window/Help -- the View submenu is the one AppShell.tsx cares about (Reload).
pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let is_mac = cfg!(target_os = "macos");
    let accel = |windows: &str, mac: &str| if is_mac { mac } else { windows }.to_string();

    let mut builder = MenuBuilder::new(app);

    if is_mac {
        let app_menu = SubmenuBuilder::new(app, "Maestro Studio")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // The accelerator AppShell.tsx depends on (docs/HANDOFF.md §9) -- do not drop this item or
    // change its id without updating the `view_reload` match arm in `handle_menu_event` below.
    let reload_item = MenuItemBuilder::with_id(RELOAD_ID, "Reload")
        .accelerator(accel("CmdOrCtrl+R", "Cmd+R"))
        .build(app)?;
    let force_reload_item = MenuItemBuilder::with_id(FORCE_RELOAD_ID, "Force Reload")
        .accelerator(accel("CmdOrCtrl+Shift+R", "Cmd+Shift+R"))
        .build(app)?;
    let toggle_devtools_item = MenuItemBuilder::with_id(TOGGLE_DEVTOOLS_ID, "Toggle Developer Tools")
        .accelerator(accel("Ctrl+Shift+I", "Cmd+Alt+I"))
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&reload_item)
        .item(&force_reload_item)
        .separator()
        .item(&toggle_devtools_item)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some("Toggle Full Screen"))?)
        .build()?;

    let mut window_menu_builder = SubmenuBuilder::new(app, "Window").minimize();
    if is_mac {
        window_menu_builder = window_menu_builder.maximize();
    }
    let window_menu = window_menu_builder.close_window().build()?;

    let help_item = MenuItemBuilder::with_id(HELP_GITHUB_ID, "Maestro Studio on GitHub").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&help_item).build()?;

    builder
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

/// Wired via `App::on_menu_event` in lib.rs. Handles the menu items that need real app logic --
/// everything else (Undo/Redo/Cut/Copy/.../Quit/Close Window/Fullscreen) is a `PredefinedMenuItem`
/// and Tauri already executes it natively without a click handler.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        RELOAD_ID | FORCE_RELOAD_ID => {
            if let Some(window) = app.get_webview_window(crate::splash::MAIN_LABEL) {
                let _ = window.eval("window.location.reload()");
            }
        }
        TOGGLE_DEVTOOLS_ID => {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window(crate::splash::MAIN_LABEL) {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        HELP_GITHUB_ID => {
            let _ = tauri_plugin_opener::open_url(
                "https://github.com/gmartinstech/maestro-desktop",
                None::<&str>,
            );
        }
        _ => {}
    }
}
