# App card fullscreen — design

## Goal

Add a fullscreen toggle to app windows on the Dashboard canvas (`DashboardViewCard`, the
card that hosts a running app's preview/code/logs/shell/history). While fullscreen, the
card fills the dashboard canvas' content area and the top nav (`DynamicIsland`) is hidden,
so the app gets maximum uninterrupted space. "Fills the canvas area" — not the literal OS
window edges — because the window edges are unreachable without reparenting the card (see
"Rejected" sections below); the canvas area is everything below/beside the app's own
titlebar, sidebar, and any banners.

Scope: only `DashboardViewCard`. `BrowserCard`, `AgentCard`, `NoteCard`, `ElementCard`, and
the Workflows cards are untouched.

## Behavior

- A new toolbar icon button (fullscreen glyph) sits in the card header, before the existing
  toolbar-collapse button.
- Clicking it flips local state `isFullscreen` on the card. No dashboard-layout/Redux
  persistence — same treatment as the existing `headerCollapsed` local state. Reloading or
  switching dashboards resets it.
- While fullscreen:
  - The card is **not** reparented or portaled. It stays exactly where it already is in the
    React/DOM tree, inside the canvas' pan/zoom-transformed content layer. Reparenting was
    the first design (see "Rejected: portal" below) and was rejected once review + research
    confirmed it reloads the live app.
  - Instead, the card measures the canvas **viewport** element itself (the element that
    already accounts for the sidebar width, insets, and any visible banners — everything the
    OS-window-relative first attempt got wrong, see "Rejected: window-relative sizing" below)
    via a `ResizeObserver` (not a window `resize` listener — a sidebar drag or a banner
    collapsing changes the viewport's rect without ever resizing the window) and computes a
    canvas-space rect plus an inverse `scale(1 / zoom)` on its own root box such that, after
    the ambient canvas transform (`translate(panX, panY) scale(zoom)`, `transformOrigin: '0
    0'`, applied by the canvas content layer) is applied, the card visually fills that
    viewport's rect exactly, with its contents rendered at native (unscaled) size.
  - The floating `DashboardHeader` overlay (rendered above the canvas viewport by
    `DashboardCanvas`) is hidden while any card is fullscreen, so it can't visually cover the
    top of the fullscreen card.
  - Drag and resize are disabled (pointer handlers on the header become no-ops).
  - The header keeps: app name, view switcher (preview/code/logs/shell/history), refresh,
    open-another, an exit-fullscreen button (replaces the fullscreen-enter icon), and the
    existing close ("remove from dashboard") button. The toolbar-collapse (peek) control is
    hidden in fullscreen since there's no drag surface reason to hide it.
  - Pressing `Escape` exits fullscreen (global `keydown` listener, added only while
    fullscreen is active).
- Because the card's DOM node is never moved to a new parent, the underlying webview/iframe
  is never reloaded — no lost app state, entering/exiting fullscreen repeatedly is cheap.

### Rejected: portal-based fullscreen

The original design rendered the fullscreen card through `createPortal(cardTree,
document.body)` with `position: fixed`. Code review plus targeted research
(`electron/electron#9529` and related issues) established that moving a `<webview>`'s DOM
node to a new parent — even via a non-destructive React portal, which keeps the React fiber
alive — still triggers Electron's guest-teardown path and reloads the app, because the
guestview attachment in the browser process is driven by the custom element's native
connect/disconnect lifecycle, not by React's reconciliation. The `<iframe>` path (used for
srcdoc-based apps) has the same failure by the HTML spec: moving an iframe to a new parent
unconditionally re-navigates it. Both paths would defeat the feature's purpose, so the portal
approach was dropped in favor of the inverse-transform approach above, which never moves the
node.

### Rejected: window-relative sizing

A second attempt kept the card in place (no portal) but sized it against
`window.innerWidth`/`window.innerHeight` with a hardcoded 38px titlebar offset. Review found
this wrong: the canvas' actual containing chain (`AppShell`) includes a resizable sidebar
(0–400px, in normal flow), a 6px inset margin, a 14px border radius, optional warning/update
banners in normal flow above the content area, and three ancestors with `overflow: hidden`
(the content panel, the canvas root, and the canvas viewport) — none of which a
window-relative calculation accounts for or can escape without reintroducing the
portal/reparent problem. The card would render offset and clipped whenever the sidebar was
open or a banner was visible. Replaced with the viewport-rect approach above, which measures
the actual space already reserved for dashboard content instead of assuming it starts at the
window's edges.

## Hiding the nav island

`DynamicIsland` renders inside `AppShell`'s persistent titlebar row, outside the routed
Dashboard tree, so a local flag on the card can't reach it directly. Add a small piece of
shared state:

- `frontend/src/shared/state/tempStateSlice.ts`: add `fullscreenCardId: string | null` plus
  `setFullscreenCardId` / `clearFullscreenCardId` actions — mirrors the existing
  `pendingFocusAgentId` field, which serves the same kind of ephemeral cross-component
  signal.
- `DashboardViewCard` dispatches `setFullscreenCardId(cardKey)` when entering fullscreen and
  `clearFullscreenCardId()` on exit (including on unmount, in case the card is removed while
  fullscreen).
- `AppShell` selects `fullscreenCardId` and renders `<DynamicIsland />` only when it's
  `null`.

## Files touched

- `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx` — fullscreen state,
  inverse-transform sizing against the measured viewport rect, toolbar button, Escape
  handler.
- `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts` — new
  `getViewportEl` callback, mirroring the existing `getCanvasState` pattern.
- `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx` — thread `getViewportEl`
  through to `DashboardCardLayer`; hide the floating `DashboardHeader` overlay while any card
  is fullscreen.
- `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx` — thread
  `getViewportEl` through to `DashboardViewCard`.
- `frontend/src/shared/state/tempStateSlice.ts` — new field + actions.
- `frontend/src/app/components/Layout/AppShell.tsx` — conditionally render `DynamicIsland`.
- `frontend/src/shared/i18n/en.json`, `pt-BR.json` — new tooltip strings
  (`dashboard.viewCard.enterFullscreen`, `dashboard.viewCard.exitFullscreen`).

## Out of scope

- OS-level fullscreen (Fullscreen API / Electron window fullscreen) — explicitly rejected in
  favor of an in-app overlay, since the overlay is simpler, has no interaction with Electron
  window state, and Escape-to-exit works uniformly.
- Persisting fullscreen state across reloads/dashboard switches.
- Fullscreen for other card types.
