# Unified title bar + Maestro robot icon — design

**Date:** 2026-08-09
**Status:** approved, ready for planning
**Scope:** one seamless window bar on Windows; Maestro robot replaces the orange octopus across every icon surface.

## Problem

On Windows 11 the app renders **three stacked horizontal bars**:

1. **Native Win11 title bar.** `electron/main.js:1192` sets `titleBarStyle: 'hiddenInset'`, which is
   macOS-only. Windows ignores it and draws a full standard frame.
2. **Native menu bar.** No `Menu.setApplicationMenu(...)` call exists anywhere, so Electron installs
   its *default* menu (File/Edit/View/Window/Help) and Windows renders it as a strip below the title bar.
3. **The app's own 38px chrome row.** `frontend/src/app/components/Layout/AppShell.tsx:483` — sidebar
   toggle, back/forward, `DynamicIsland`, "Maestro Studio" wordmark. Its `pl: '78px'` reserves space
   for macOS traffic lights, which is dead space on Windows.

Separately, the app icon is still the inherited OpenSwarm orange pixel octopus
(`electron/build/icon.{png,ico,icns}`, `electron/splash/icon.png`, `assets/icon.png`,
`frontend/public/{favicon.ico,logo.png,apple-touch-icon.png}`), so the window, taskbar, alt-tab and
installer all show the wrong brand. `docs/HANDOFF.md:103` already tracks this as the BRD faithful pass.

## Assets: resolved

The brand assets live in the MartinsTech design-system skill:

```
G:\Shared drives\MartinsTech\.claude\skills\martinstech-design-system\assets\maestro\
  maestro-16.png  maestro-32.png  maestro-48.png  maestro-96.png  maestro-180.png  maestro-512.png
```

`SKILL.md:269` is authoritative on which mark to use: `assets/maestro/maestro-512.png … -16.png` is the
**product app icon and favicon**, while `assets/logo/mt-logo-*` is the **company** mark. The Maestro
robot (navy `#003566` body, azure face plate, gold `#F5CC00` antenna and ears) is therefore the correct
choice for the app icon. This supersedes the `bot-pixel.svg` filename named in `docs/HANDOFF.md:103` —
that asset does not exist under that name; `maestro-*.png` is the real thing.

The pixel-art variants (`assets/maestro/pixel/`) are explicitly scoped by `SKILL.md:272` to playful
contexts only, so they are **not** used for the app icon.

## Design

### 1. Window chrome — `electron/main.js`

`createWindow()` splits by platform. The two OSes genuinely disagree about who owns the window buttons,
so a branch here is unavoidable rather than incidental.

- **macOS:** unchanged. `titleBarStyle: 'hiddenInset'` keeps traffic lights inset into the app's bar,
  which already works today.
- **Windows / Linux:** `titleBarStyle: 'hidden'` plus
  `titleBarOverlay: { color, symbolColor, height: 38 }`.

Electron then paints the **real native** minimize/maximize/close into the right end of the app's
existing 38px row. Because the buttons are genuinely native, Win11 snap-layouts (the grid that appears
on maximize-hover) keep working with no reimplementation. `height: 38` matches the existing bar height
in `AppShell.tsx:485`, so no re-measuring is needed.

Electron is `github:castlabs/electron-releases#v42.3.3+wvcus` (`electron/package.json:27`), which fully
supports `titleBarOverlay` height and the runtime `setTitleBarOverlay` setter.

**Theme sync.** The overlay is painted by the OS, not the page, so `color` must be a solid hex and
cannot inherit the renderer's `transparent` background. One IPC channel carries the resolved chrome
color from renderer to main, which calls `mainWindow.setTitleBarOverlay({ color, symbolColor })`.
This keeps the native buttons matching `c.bg.secondary` across theme changes.

The splash window (`electron/main.js:575`, already `frame: false`) is untouched.

### 2. Menu — keep registered, hide the strip

`Menu.setApplicationMenu(null)` is the wrong tool: it removes the strip **and** every accelerator that
comes with the default menu — Reload, DevTools, zoom, copy/paste, quit. `AppShell.tsx:323` documents
relying on *View → Reload* by name.

Instead:

- Build an explicit menu template once and register it via `setApplicationMenu` on **all** platforms,
  so accelerators keep working everywhere.
- On Windows/Linux, call `mainWindow.setMenuBarVisibility(false)`. Leave `autoHideMenuBar` **off** so
  pressing Alt does not pop the strip back into view.
- A new ☰ button at the left of the unified bar IPCs to main, which calls
  `Menu.getApplicationMenu().popup({ window, x, y })` — the same menu object, anchored as a dropdown
  under the button.
- On macOS the ☰ button does not render; the menu stays in the system menubar where it belongs.

Nothing is lost: every command remains reachable by mouse and by keyboard.

### 3. Bar contents — `AppShell.tsx`

- `pl: '78px'` becomes platform-aware: 78px on macOS (traffic lights), ~8px on Windows.
- New leading ☰ menu button, Windows/Linux only.
- The trailing cluster (robot mark + "Maestro Studio" wordmark) **stays on the right**, per the
  approved mock, and gains a right padding equal to the overlay width (~138px on Win11) so it cannot
  slide underneath the native buttons.
- Existing `WebkitAppRegion: 'drag'` on the bar and `'no-drag'` on every control carries over unchanged.
- `electron/preload.js` must newly expose `process.platform`; it currently exposes no platform hint.

Final layout:

```
┌───────────────────────────────────────────────────────┐
│ [☰] [▣] [←] [→]   ·island·     🤖 Maestro Studio  ─ □ ✕│
└───────────────────────────────────────────────────────┘
  one 38px bar;  ─ □ ✕ are real native buttons
```

### 4. Icon pipeline

Source PNGs are **vendored into the repo** at `assets/brand/maestro/`. Builds must not depend on the
`G:` share being mounted, and CI has no access to it.

A committed `scripts/gen-icons.py` regenerates every target from those sources. It runs on the backend
venv's Pillow 12.2.0 (`backend/.venv/Scripts/python.exe`), which writes multi-size `.ico` and `.icns`
directly — so this adds **no new dependency** to any `package.json`.

Targets:

| Path | Content | Consumed by |
|---|---|---|
| `electron/build/icon.png` | 512 | `build.icon` (`electron/package.json:52`), `iconPath` (`main.js:548`) |
| `electron/build/icon.ico` | 16/24/32/48/64/128/256 | `build.win.icon` (`electron/package.json:103`) |
| `electron/build/icon.icns` | 512 | `build.mac.icon` (`electron/package.json:54`) |
| `electron/splash/icon.png` | 512 | splash payload (`main.js:558`) |
| `assets/icon.png` | 512 | repo-level asset |
| `frontend/public/favicon.ico` | 16/32/48 | `frontend/public/index.html:34` |
| `frontend/public/apple-touch-icon.png` | 180 | `frontend/public/index.html:35` |
| `frontend/public/logo.png` | 512 | `OpenSwarmProCard.tsx:226` — still live, not dead |
| `frontend/public/maestro-mark.png` | 96 (rendered at 20px, 2x+ for HiDPI) | new robot glyph in the unified bar, `AppShell.tsx` |

Committing the generator rather than hand-producing the files makes the next brand tweak a
one-command job, which is what `docs/HANDOFF.md:103` asks for.

## Explicitly out of scope

- **`electron/package.json:130`** — `squirrelWindows.iconUrl` still points at
  `openswarm-ai/openswarm`. Already tracked as DET Step 3
  (`docs/plans/2026-07-20-det-detach.md:69`); changing it here would tangle two tickets.
- **The rest of the BRD faithful pass** — self-hosted Inter / IBM Plex Mono woff2, gold `#F5CC00`
  placements (`docs/HANDOFF.md:104-106`). The design-system skill carries those assets too, but they
  are a separate epic, not this bar.
- **Remaining "OpenSwarm" copy strings** — BRD copy cleanup, unrelated to chrome or icons.

## Verification

`npm run verify` is the gate — build + lint + typecheck + tests + golden smoke + call-home check.

Beyond it, a live Windows dev launch must confirm:

- one bar, not three;
- native minimize/maximize/close work, including Win11 snap-layouts on maximize-hover;
- ☰ pops the app menu; *View → Reload* and Ctrl+R still route to the app's own handler
  (`AppShell.tsx:324`) rather than reloading the renderer;
- Alt does not reveal a hidden menu strip;
- window, taskbar and alt-tab all show the robot;
- theme change repaints the native button strip to match.

The macOS path can only be verified by inspection from a Windows dev machine. That limitation is
stated rather than papered over: the macOS branch is unchanged code, but it is untested by this work.

## Risks

- **`titleBarOverlay` colour drift.** If the IPC theme sync fails, the native button strip renders in a
  stale colour against the themed bar — visually wrong but not functionally broken. Mitigated by
  setting the overlay once at window creation from the same token the renderer uses.
- **Accelerator regression.** The whole menu approach hinges on keeping the `Menu` object registered.
  A future refactor that "cleans up" the hidden menu into `setApplicationMenu(null)` would silently
  kill Reload/DevTools/zoom shortcuts. The reason is recorded as a one-line comment at the call site.
- **`.icns` fidelity.** Pillow writes `.icns` from a 512px source; macOS Retina prefers 1024. The
  design-system skill ships no 1024 variant. Acceptable for now, flagged for the macOS release pass.
