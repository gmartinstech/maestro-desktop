# Browser/agent card fullscreen + agent drawer — design

## Goal

Extend the existing app-card fullscreen feature (`DashboardViewCard`, shipped in
`2026-08-18-app-card-fullscreen-design.md`) to `BrowserCard` and `AgentCard`, and add a
second, independent expanded view for `AgentCard`: a slide-in drawer with a dropdown to
switch which of the dashboard's past chats it's showing.

Three pieces:
1. `BrowserCard` fullscreen — direct port of the existing mechanism.
2. `AgentCard` fullscreen — same mechanism, with a perf-preserving adjustment (below).
3. `AgentCard` drawer mode + previous-chats dropdown — new.

## 1. BrowserCard fullscreen

Same mechanism as `DashboardViewCard`'s fullscreen (see the prior spec for the full
mechanics: `getViewportEl`-based sizing, inverse `scale(1/zoom)`, `fullscreenCardId` Redux
flag, Escape/button exit, no reparenting). `BrowserCard` already receives `zoom`/`panX`/`panY`
as live props with the same shape `DashboardViewCard` does, so this ports without needing new
plumbing beyond `BrowserCard` itself.

- New fullscreen toggle `IconButton` added to the tab bar's right-side controls (next to the
  existing close button), not the nav bar (back/forward/reload/URL) — the nav bar stays
  wherever it already is in the layout.
- Tab strip and nav bar remain visible and fully functional while fullscreen; only the card's
  outer position/size/zIndex change, matching `DashboardViewCard`'s treatment (header
  contents don't change, only the root box's geometry).
- Drag/resize disabled while fullscreen, same as `DashboardViewCard`.
- `fullscreenCardId` is shared across all three card types (one global "which card is
  fullscreen" slot) — a `BrowserCard` and a `DashboardViewCard` can't both be fullscreen at
  once, matching the existing single-slot design (nothing today allows more than one
  fullscreen card, and this isn't changing that).

## 2. AgentCard fullscreen

Same mechanism, with one adjustment. `AgentCard` deliberately does NOT receive `zoom`/
`panX`/`panY` as live props — it reads them on demand via a `getCanvasState()` getter,
specifically to avoid re-rendering every agent card on the canvas on every pan/zoom tick (see
`AgentCard.tsx`'s own comment on `getCanvasState`). Passing live props for fullscreen sizing
would reintroduce that cost for every agent card, not just the fullscreen one.

Instead: `AgentCard` gets a **local live-zoom subscription that only exists while
`isFullscreen` is true**:
- While fullscreen, a `useEffect` calls `getCanvasState()` once immediately and again on
  every `maestro:canvas-pan-changed` window event (the same event `AgentCard` already
  subscribes to elsewhere, today only while dragging — see `AgentCard.tsx`'s existing
  `onPanChange` effect for the precedent), storing the result in local state
  (`{ panX, panY, zoom }`).
- The effect unsubscribes and this local state is unused whenever `isFullscreen` is false, so
  a non-fullscreen `AgentCard` never re-renders on pan/zoom — the original optimization is
  preserved for the common case (most agent cards on a canvas at any time).
- Sizing math is otherwise identical to `DashboardViewCard`/`BrowserCard`: canvas-space
  `fsLeft`/`fsTop`/`fsWidth`/`fsHeight` against the measured viewport rect, `scale(1/zoom)`
  inverse transform.

Fullscreen toggle button added to `AgentCard`'s header/toolbar area (exact placement decided
during planning, alongside its existing header controls).

## 3. AgentCard drawer mode

A second, independent expanded view — NOT a variant of fullscreen. Represents "pull this
chat out into a slide-in panel," coexisting with the canvas rather than covering it.

- New `drawerCardId: string | null` field in `tempStateSlice`, parallel to
  `fullscreenCardId` (same shape: `setDrawerCardId(id)` / `clearDrawerCardId(id)`, the
  clear scoped to the owning card so one card's cleanup can't clobber another's, same fix
  class as `fullscreenCardId`'s `2c9efdaa` commit).
- Drawer and fullscreen are **independent, coexisting** flags — opening a drawer does NOT
  force-close a fullscreen card elsewhere, and vice versa. A card cannot be both fullscreen
  and drawer-open at the same time (its own toggle buttons are mutually exclusive locally),
  but two DIFFERENT cards can be in the two different states simultaneously.
- New toolbar button on `AgentCard` opens the drawer: renders a MUI `Drawer`
  (`anchor="right"`), matching `ContextDrawer.tsx`'s existing styling/pattern (width, elevation,
  header treatment) since that's this codebase's established drawer look. Inside, the same
  embedded `AgentChat` component `AgentCard` already renders, parameterized by the same
  `sessionId` the card was showing before the drawer opened.
- Opening the drawer does not change the card's position/state on the canvas — the canvas
  stays visible and interactive underneath/beside the drawer. Closing the drawer (X button or
  Escape) returns to normal, with the card unchanged on the canvas.
- Like `isFullscreen`, this is local `useState` on the card (not persisted to dashboard
  layout), reset on reload/dashboard switch.

## 4. Previous-chats dropdown

A new header control on `AgentCard`, visible in its normal, fullscreen, AND drawer states —
a dropdown/menu button listing past chats to switch to.

- **Scope:** this dashboard's sessions only (both currently-active `state.agents.sessions`
  and finished/`state.agents.history` entries filtered by `dashboard_id` matching the
  current dashboard), most recent first. Reuses the same Redux state
  `GlobalSearchPalette.tsx` already reads (`s.agents.sessions`, `s.agents.history`) — no new
  backend/API surface, just a differently-scoped, differently-triggered UI over existing data.
- A text filter appears if the list is long (same UX pattern as the search palette, simplified
  to just filter-by-name since it's already dashboard-scoped and typically short).
- Selecting an entry **reassigns this card's canvas position to the picked session** — the
  data model keys a card's position by `session_id` (`cards: Record<string, CardPosition>`
  in `dashboardLayoutSlice`, and `DashboardCardLayer` keys the rendered `AgentCard` by that
  same id), so "switch this card's chat" concretely means: take this position record's
  `x`/`y`/`width`/`height`/`zOrder`, delete (or vacate) the entry keyed by the OLD session id,
  and create/update an entry keyed by the NEW session id with that same geometry. The old
  session isn't deleted or lost — it stops occupying this canvas position (it remains
  reachable via `GlobalSearchPalette` / history like any other past session that isn't
  currently pinned to a canvas slot). This is a genuine card swap, not a content overlay:
  after picking session-B in the dropdown, navigating away and back to this dashboard shows
  session-B at that position, not session-A.
  - Needs a new `dashboardLayoutSlice` reducer (e.g. `reassignCardSession({ fromSessionId,
    toSessionId })`) that moves the position record between keys. Existing reducers already
    do similar move-like operations (`moveBrowserTab` moves a tab between browser cards) —
    follow that precedent rather than inventing a new pattern.
  - `DashboardCardLayer`'s `key={sid}` naturally causes a remount when the position moves to
    a new key — this IS a real remount of the `AgentCard` (new WebSocket subscription, fresh
    message load for the new session), which is expected and correct here since it's a
    genuinely different chat, not the same one being reflowed.

## Shared behavior across all pieces

- No card is ever reparented/portaled for fullscreen (same reasoning as the original
  `DashboardViewCard` spec's rejected-portal section: it would reload a live `<webview>` or
  disrupt `AgentChat`'s live WebSocket/state).
- `fullscreenCardId` continues to hide `DynamicIsland` (AppShell) and the floating dashboard
  header (`DashboardCanvas`), regardless of which card type set it.
- `drawerCardId` does NOT hide `DynamicIsland` or the floating header — the drawer is a
  layered overlay, not a canvas takeover, so the rest of the chrome stays visible and usable.
- Escape key: while a card's drawer is open AND focused, Escape closes the drawer (scoped the
  same way fullscreen's Escape listener is — only attached while that state is active).

## Files touched (expected, subject to refinement during planning)

- `frontend/src/app/pages/Dashboard/cards/BrowserCard.tsx` — fullscreen toggle, sizing, button.
- `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx` — fullscreen toggle, sizing (via the
  scoped live-subscription effect), button; drawer toggle, drawer render, dropdown control.
- `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx` — thread `getViewportEl`
  to `BrowserCard` and `AgentCard` (currently only threaded to `DashboardViewCard`).
- `frontend/src/shared/state/tempStateSlice.ts` — new `drawerCardId` field + actions.
- `frontend/src/shared/i18n/en.json`, `pt-BR.json` — new strings (fullscreen tooltips for the
  two new card types, drawer tooltip, dropdown labels).

## Out of scope

- Persisting fullscreen/drawer state or the picked previous-chat across reloads.
- Changing `GlobalSearchPalette`'s existing behavior (still navigates across dashboards; this
  dropdown is a separate, narrower, in-place control).
- Any change to how sessions are created, run, or their backend lifecycle — this is purely a
  "which existing session does this card currently render" UI concern.
- Multiple simultaneous fullscreen cards (still a single global slot, as today).
