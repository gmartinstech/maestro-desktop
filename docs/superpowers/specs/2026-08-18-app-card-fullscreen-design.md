# App card fullscreen — design

## Goal

Add a fullscreen toggle to app windows on the Dashboard canvas (`DashboardViewCard`, the
card that hosts a running app's preview/code/logs/shell/history). While fullscreen, the
card fills the window's content area and the top nav (`DynamicIsland`) is hidden, so the
app gets maximum uninterrupted space.

Scope: only `DashboardViewCard`. `BrowserCard`, `AgentCard`, `NoteCard`, `ElementCard`, and
the Workflows cards are untouched.

## Behavior

- A new toolbar icon button (fullscreen glyph) sits in the card header, before the existing
  toolbar-collapse button.
- Clicking it flips local state `isFullscreen` on the card. No dashboard-layout/Redux
  persistence — same treatment as the existing `headerCollapsed` local state. Reloading or
  switching dashboards resets it.
- While fullscreen:
  - The card is rendered through a React portal into `document.body`, `position: fixed`,
    covering the window content area below the OS titlebar (`top: 38px` matching AppShell's
    `TITLEBAR_HEIGHT`), `left/right/bottom: 0`, `borderRadius: 0`, and a `zIndex` above
    `DynamicIsland`'s 9999.
  - Drag and resize are disabled (pointer handlers on the header become no-ops); the card
    isn't part of the canvas' pan/zoom transform while portaled out.
  - The header keeps: app name, view switcher (preview/code/logs/shell/history), refresh,
    open-another, an exit-fullscreen button (replaces the fullscreen-enter icon), and the
    existing close ("remove from dashboard") button. The toolbar-collapse (peek) control is
    hidden in fullscreen since there's no drag surface reason to hide it.
  - Pressing `Escape` exits fullscreen (global `keydown` listener, added only while
    fullscreen is active).
- Because the portal keeps `DashboardOutputPreview` at the same position in the React tree
  (only the DOM mount point moves), the underlying webview/iframe is never remounted —
  no reload, no lost app state, entering/exiting fullscreen repeatedly is cheap.

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

- `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx` — fullscreen state, portal
  render path, toolbar button, Escape handler.
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
