# App Card Fullscreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen toggle to app windows (`DashboardViewCard`) on the Dashboard canvas that fills the window's content area and hides the top nav island while active.

**Architecture:** A local `isFullscreen` boolean in `DashboardViewCard` controls sizing only — the card's DOM node is never reparented (an earlier portal-based design was rejected: reparenting a live `<webview>`/`<iframe>` reloads it). While fullscreen, the card measures the canvas viewport element's own `getBoundingClientRect()` (threaded down via a new `getViewportEl` callback, mirroring the existing `getCanvasState` pattern) and computes a canvas-space rect plus an inverse `scale(1/zoom)` so the ambient canvas pan/zoom transform lands it exactly over that viewport's own layout area — not the OS window, which is unreachable from inside the canvas' nested, inset, `overflow: hidden`, sidebar-adjacent containers without reintroducing the reparenting problem. A new `fullscreenCardId` field in the existing `tempStateSlice` (Redux), scoped so only the owning card can clear it, signals `AppShell` to hide `DynamicIsland` and `DashboardCanvas` to hide its floating header while any card is fullscreen. Escape key and a toolbar button both exit.

**Tech Stack:** React 18, MUI (`Box`, `IconButton`, `Tooltip`), Redux Toolkit (`tempStateSlice`), Vitest for the reducer test.

---

### Task 1: Add `fullscreenCardId` to `tempStateSlice`

**Files:**
- Modify: `frontend/src/shared/state/tempStateSlice.ts`
- Test: `frontend/src/shared/state/tempStateSlice.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shared/state/tempStateSlice.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import reducer, { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';

describe('tempState fullscreenCardId', () => {
  it('starts null', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.fullscreenCardId).toBeNull();
  });

  it('setFullscreenCardId stores the card key', () => {
    const state = reducer(undefined, setFullscreenCardId('view-abc123'));
    expect(state.fullscreenCardId).toBe('view-abc123');
  });

  it('clearFullscreenCardId resets to null', () => {
    const withId = reducer(undefined, setFullscreenCardId('view-abc123'));
    const cleared = reducer(withId, clearFullscreenCardId());
    expect(cleared.fullscreenCardId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shared/state/tempStateSlice.test.ts`
Expected: FAIL — `setFullscreenCardId` / `clearFullscreenCardId` are not exported.

- [ ] **Step 3: Implement the slice change**

Modify `frontend/src/shared/state/tempStateSlice.ts` to the following full contents:

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TempState {
  pendingBrowserUrl: string | null;
  pendingFocusAgentId: string | null;
  lastDashboardId: string | null;
  fullscreenCardId: string | null;
}

const initialState: TempState = {
  pendingBrowserUrl: null,
  pendingFocusAgentId: null,
  lastDashboardId: null,
  fullscreenCardId: null,
};

const tempStateSlice = createSlice({
  name: 'tempState',
  initialState,
  reducers: {
    setPendingBrowserUrl(state, action: PayloadAction<string>) {
      state.pendingBrowserUrl = action.payload;
    },
    clearPendingBrowserUrl(state) {
      state.pendingBrowserUrl = null;
    },
    setLastDashboardId(state, action: PayloadAction<string>) {
      state.lastDashboardId = action.payload;
    },
    setPendingFocusAgentId(state, action: PayloadAction<string>) {
      state.pendingFocusAgentId = action.payload;
    },
    clearPendingFocusAgentId(state) {
      state.pendingFocusAgentId = null;
    },
    setFullscreenCardId(state, action: PayloadAction<string>) {
      state.fullscreenCardId = action.payload;
    },
    clearFullscreenCardId(state) {
      state.fullscreenCardId = null;
    },
  },
});

export const {
  setPendingBrowserUrl,
  clearPendingBrowserUrl,
  setLastDashboardId,
  setPendingFocusAgentId,
  clearPendingFocusAgentId,
  setFullscreenCardId,
  clearFullscreenCardId,
} = tempStateSlice.actions;

export default tempStateSlice.reducer;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/shared/state/tempStateSlice.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/state/tempStateSlice.ts frontend/src/shared/state/tempStateSlice.test.ts
git commit -m "feat(state): add fullscreenCardId to tempState slice"
```

---

### Task 2: Hide `DynamicIsland` in `AppShell` while a card is fullscreen

**Files:**
- Modify: `frontend/src/app/components/Layout/AppShell.tsx:585`

- [ ] **Step 1: Add the selector**

In `frontend/src/app/components/Layout/AppShell.tsx`, find the `AppShell` component body (starts at line 68). Add this selector near the other `useAppSelector` calls inside the component (search for an existing `useAppSelector` call in the file to place it beside — the file already imports `useAppSelector` from `@/shared/hooks` at line 39):

```typescript
  const fullscreenCardId = useAppSelector((s) => s.tempState.fullscreenCardId);
```

- [ ] **Step 2: Conditionally render `DynamicIsland`**

Replace this line (currently at line 585):

```typescript
        <DynamicIsland />
```

with:

```typescript
        {!fullscreenCardId && <DynamicIsland />}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. If `s.tempState` doesn't resolve, check the root reducer registers `tempStateSlice` under the key `tempState` — verify with:

Run: `grep -n "tempState" frontend/src/shared/state/store.ts`
Expected: a line mapping `tempState: tempStateReducer` (or similarly named) in the root reducer. This key already exists since `pendingFocusAgentId`/`pendingBrowserUrl` are read the same way elsewhere in the codebase (e.g. `frontend/src/app/components/Layout/AppShell.tsx` already dispatches `setPendingBrowserUrl`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/Layout/AppShell.tsx
git commit -m "feat(appshell): hide DynamicIsland while an app card is fullscreen"
```

---

### Task 3: Add fullscreen toggle state, toolbar button, and Escape handler to `DashboardViewCard`

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`

- [ ] **Step 1: Add icon imports**

In `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`, after the existing icon import block (after line 19, `import KeyboardArrowUpRounded from '@mui/icons-material/KeyboardArrowUpRounded';`), add:

```typescript
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
```

- [ ] **Step 2: Import the new Redux actions**

Modify the import on line 21:

```typescript
import { setViewCardPosition, setViewCardSize, setActiveViewCardId, recordClosedCard, addViewCard } from '@/shared/state/dashboardLayoutSlice';
```

to:

```typescript
import { setViewCardPosition, setViewCardSize, setActiveViewCardId, recordClosedCard, addViewCard } from '@/shared/state/dashboardLayoutSlice';
import { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';
```

- [ ] **Step 3: Add `isFullscreen` state near `headerCollapsed`**

Modify lines 167-170 (the `headerCollapsed`/`headerPeek` block):

```typescript
  // Chevron rolls the whole header away so an immersive app fills the card; hovering the top edge peeks it back.
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [headerPeek, setHeaderPeek] = useState(false);
  const showControls = !headerCollapsed || headerPeek;
```

to:

```typescript
  // Chevron rolls the whole header away so an immersive app fills the card; hovering the top edge peeks it back.
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [headerPeek, setHeaderPeek] = useState(false);
  const showControls = !headerCollapsed || headerPeek;
  // Local-only, like headerCollapsed: resets on reload/dashboard switch, never persisted to dashboard layout.
  const [isFullscreen, setIsFullscreen] = useState(false);
```

- [ ] **Step 4: Sync fullscreen state to Redux and add the Escape handler**

Add this new `useEffect` immediately after the block just edited in Step 3 (i.e. right after the `const [isFullscreen, setIsFullscreen] = useState(false);` line):

```typescript
  useEffect(() => {
    if (!isFullscreen) return;
    dispatch(setFullscreenCardId(cardKey ?? output.id));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dispatch(clearFullscreenCardId());
    };
  }, [isFullscreen, dispatch, cardKey, output.id]);
```

- [ ] **Step 5: Add the toggle handler next to the other handlers**

Modify lines 374-378 (`handleRemove`):

```typescript
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(recordClosedCard({ kind: 'view', id: cardKey }));
    void removeViewCardCleanly(cardKey, dispatch);
  };
```

to:

```typescript
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(recordClosedCard({ kind: 'view', id: cardKey }));
    void removeViewCardCleanly(cardKey, dispatch);
  };

  const handleToggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFullscreen((v) => !v);
  };
```

- [ ] **Step 6: Typecheck before touching JSX**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors (unused-var warnings for the new icons/handler are fine at this point since they're not wired into JSX yet — but if the linter treats unused as an error, proceed straight to Step 7 before checking).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
git commit -m "feat(dashboard): add fullscreen toggle state to app card"
```

---

### Task 4: Render the fullscreen toolbar button and disable drag/resize while fullscreen

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`

- [ ] **Step 1: Guard drag/resize pointer handlers**

The header's drag handlers are wired at lines 504-506:

```typescript
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
```

Replace with fullscreen-aware no-ops:

```typescript
        onPointerDown={isFullscreen ? undefined : handleDragPointerDown}
        onPointerMove={isFullscreen ? undefined : handleDragPointerMove}
        onPointerUp={isFullscreen ? undefined : handleDragPointerUp}
```

- [ ] **Step 2: Hide resize handles while fullscreen**

The resize handles block is at lines 704-720:

```typescript
      {/* Resize handles */}
      {HANDLE_DEFS.map(({ dir, sx }) => (
        <Box
          key={dir}
          className="resize-handle"
          onPointerDown={handleResizeDown(dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          sx={{
            position: 'absolute',
            cursor: CURSOR_MAP[dir],
            opacity: 0,
            zIndex: 10,
            ...sx,
          }}
        />
      ))}
```

Replace the opening line to gate the whole map:

```typescript
      {/* Resize handles */}
      {!isFullscreen && HANDLE_DEFS.map(({ dir, sx }) => (
        <Box
          key={dir}
          className="resize-handle"
          onPointerDown={handleResizeDown(dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          sx={{
            position: 'absolute',
            cursor: CURSOR_MAP[dir],
            opacity: 0,
            zIndex: 10,
            ...sx,
          }}
        />
      ))}
```

- [ ] **Step 3: Hide the toolbar-collapse (peek) button while fullscreen**

The collapse-toolbar button is at lines 630-639:

```typescript
        <Tooltip title={headerCollapsed ? t('dashboard.viewCard.showToolbar') : t('dashboard.viewCard.hideToolbar')} placement="top">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setHeaderPeek(false); setHeaderCollapsed((v) => !v); }}
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ color: c.text.ghost, p: 0.5, '&:hover': { color: c.text.primary } }}
          >
            <KeyboardArrowUpRounded sx={{ fontSize: 18, transition: 'transform 0.15s', transform: headerCollapsed ? 'rotate(180deg)' : 'none' }} />
          </IconButton>
        </Tooltip>
```

Replace with:

```typescript
        {!isFullscreen && (
          <Tooltip title={headerCollapsed ? t('dashboard.viewCard.showToolbar') : t('dashboard.viewCard.hideToolbar')} placement="top">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setHeaderPeek(false); setHeaderCollapsed((v) => !v); }}
              onPointerDown={(e) => e.stopPropagation()}
              sx={{ color: c.text.ghost, p: 0.5, '&:hover': { color: c.text.primary } }}
            >
              <KeyboardArrowUpRounded sx={{ fontSize: 18, transition: 'transform 0.15s', transform: headerCollapsed ? 'rotate(180deg)' : 'none' }} />
            </IconButton>
          </Tooltip>
        )}
```

- [ ] **Step 4: Add the fullscreen toggle button before the collapse button**

Insert immediately before the block just edited in Step 3 (i.e. right before `{!isFullscreen && (` from Step 3, still inside the header `Box`, after the `openAnotherWindow` Tooltip block that ends at line 626-628 `</> )}`):

```typescript
        <Tooltip title={isFullscreen ? t('dashboard.viewCard.exitFullscreen') : t('dashboard.viewCard.enterFullscreen')} placement="top">
          <IconButton
            size="small"
            onClick={handleToggleFullscreen}
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ color: c.text.ghost, p: 0.5, '&:hover': { color: c.text.primary } }}
          >
            {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 16 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
git commit -m "feat(dashboard): wire fullscreen toggle button into app card toolbar"
```

---

### Task 5 (revision 2): Size the card to fill the canvas viewport when fullscreen, without reparenting it

**As-built note:** the code below documents the intent accurately, but two details changed
during implementation review and the ACTUAL final shape differs slightly from the literal
snippets in Steps 1-4:
- `getViewportEl` returns the raw `HTMLDivElement | null` (not a `DOMRect`) — i.e. every
  `() => DOMRect | null` type below should read `() => HTMLDivElement | null`, and every
  `getCanvasState() ?? null` / `.getBoundingClientRect() ?? null` in the controller should
  read `canvas.viewportRef.current` with no `.getBoundingClientRect()` call. The card calls
  `.getBoundingClientRect()` itself, inside the `ResizeObserver` callback.
- Step 3's re-measure effect uses a `ResizeObserver` on the real element (not a
  `window.addEventListener('resize', ...)` listener) — a window resize listener misses a
  sidebar drag or a warning-banner `Collapse`, neither of which resizes the window but both of
  which change the viewport's rect. See the design spec's "Rejected: window-relative sizing"
  section — this was found in a second-order review pass on top of the viewport-rect fix
  itself, not something the original revision-2 draft anticipated.

This was corrected before landing (commits `95da6806` then `63294a3c` on the feature branch)
and passed final review clean. If executing this plan fresh (not resuming a prior run), skip
straight to the corrected shape: `getViewportEl(): HTMLDivElement | null` threaded through all
four files, and a `ResizeObserver`-based effect in `DashboardViewCard` (not a resize listener).
The step-by-step snippets below are kept as originally written for their explanatory value
(the math derivation in particular is still exactly correct) — just mentally substitute
`HTMLDivElement` for `DOMRect` in the getter's type, and `ResizeObserver` for the resize
listener, per the two bullets above.

**Design history:** revision 1 portaled the card into `document.body` with `position:
fixed`, which reloads a live `<webview>`/`<iframe>` on reparent (see the design spec's
"Rejected: portal-based fullscreen" section). Revision 1.5 kept the card in place but sized
it against `window.innerWidth/innerHeight`, which turned out wrong too: the card's actual
containing chain (`AppShell.tsx`) includes a resizable sidebar (0–400px, in normal flow), a
6px inset margin, a 14px border radius, up to two banners in normal flow above the content
area, and **three ancestors with `overflow: hidden`** (`AppShell.tsx:1100`,
`DashboardCanvas.tsx:168` and `:212`) — none of which a window-relative calculation accounts
for, and none of which are escapable without reintroducing the portal/reparent problem. This
revision (2) sizes the card against the canvas **viewport element's own
`getBoundingClientRect()`** instead of the window, so it fills exactly the space already
reserved for dashboard content — inside the app's chrome, not past it. This is the direct
replacement for the whole of the old Task 5; if a prior run applied either earlier revision,
this task's diffs supersede those changes (see "If resuming" below).

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`

**If resuming:** check `git log --oneline -- frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx` for a commit titled "feat(dashboard): size app card to fill window on fullscreen via inverse zoom transform" (revision 1.5) or "feat(dashboard): portal app card fullscreen over the whole window" (revision 1). If either exists, read the current file state and reconcile it to the target state shown in this task's steps — the constants/state this task introduces (`getViewportEl`, `fsLeft`/`fsTop`/`fsWidth`/`fsHeight`) replace `viewportSize`/`window.innerWidth`/`window.innerHeight`-based ones from revision 1.5 entirely; there should be no `viewportSize` state and no `window.addEventListener('resize', ...)` left after this task (window resize is superseded by measuring the viewport element directly, which naturally reflects any layout change on the next render triggered by pan/zoom/selection state — see Step 2's `ResizeObserver` for why an explicit resize listener is still needed, just on the right element).

### Background: the math

The canvas' content layer (`DashboardCanvas.tsx`) wraps all cards in a `<div ref={canvas.contentRef}>` with `transform: translate(panX, panY) scale(zoom)` and `transformOrigin: '0 0'`. That div is a descendant of the canvas **viewport** element (`<Box ref={canvas.viewportRef} sx={{ position: 'absolute', inset: 0, overflow: 'hidden', ... }}>`), which is the actual space reserved for dashboard content — sized by ordinary CSS layout (flex/inset), not by the pan/zoom transform.

For a point at canvas-space coordinate `(x, y)` inside the transformed div, its position relative to the viewport element's own top-left corner is `(panX + x * zoom, panY + y * zoom)` (the transform's `translate`/`scale` apply relative to the content div's own containing block, which is the viewport). To make the card visually occupy the FULL viewport element — from its own `(0, 0)` to `(viewportRect.width, viewportRect.height)` — while staying inside the transformed div:

- `fsLeft = -panX / zoom`
- `fsTop = -panY / zoom`
- `fsWidth = viewportRect.width` (canvas units — see Task 5 revision 1.5's background section, still accurate: the card's own inverse `scale(1/zoom)` cancels the ambient `zoom`, so declared width/height equal the desired on-screen size directly, no extra multiplication)
- `fsHeight = viewportRect.height`

No `TITLEBAR_HEIGHT`/`38` constant is needed in this revision — the viewport element's rect already starts below all the app chrome (titlebar, sidebar row, banners), since `viewportRef` is already positioned in the layout that accounts for all of that.

- [ ] **Step 1: Expose a `getViewportEl` getter from the dashboard controller**

Open `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`. Find:

```typescript
  const canvasStateRef = useRef({ panX: canvas.panX, panY: canvas.panY, zoom: canvas.zoom });
  canvasStateRef.current = { panX: canvas.panX, panY: canvas.panY, zoom: canvas.zoom };
  // Stable getter, AgentCards read pan/zoom on demand during drag math.
  const getCanvasState = useCallback(() => canvasStateRef.current, []);
```

Add immediately after it:

```typescript
  // Stable getter so a fullscreen card can size itself against the canvas viewport's real layout rect (sidebar width, insets, banners already resolved) instead of the OS window.
  const getViewportEl = useCallback(() => canvas.viewportRef.current?.getBoundingClientRect() ?? null, [canvas.viewportRef]);
```

Find where `getCanvasState` is included in this hook's returned object (search for `getCanvasState,` inside a `return { ... }` block near the end of the file) and add `getViewportEl,` alongside it in the same object.

- [ ] **Step 2: Thread `getViewportEl` through `DashboardCanvas` to `DashboardCardLayer`**

In `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`, find the `DashboardCanvasProps` interface's `getCanvasState` field:

```typescript
  getCanvasState: () => { panX: number; panY: number; zoom: number };
```

Add immediately after it:

```typescript
  getViewportEl: () => DOMRect | null;
```

Find where `getCanvasState` is destructured from props (in the component's parameter list) and add `getViewportEl,` alongside it. Find where `getCanvasState={getCanvasState}` is passed to `<DashboardCardLayer ... />` and add `getViewportEl={getViewportEl}` alongside it.

In `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`, make the same three changes: add `getViewportEl: () => DOMRect | null;` to `DashboardCardLayerProps` next to the existing `getCanvasState` field, destructure `getViewportEl` from props next to `getCanvasState`, and pass `getViewportEl={getViewportEl}` to the `<DashboardViewCard ... />` element (search for `<DashboardViewCard` — it currently does NOT receive `getCanvasState` either; add both as new props to this one call site, since `ElementCard` is the only current consumer of `getCanvasState` and `DashboardViewCard` needs its own).

- [ ] **Step 3: Consume `getViewportEl` in `DashboardViewCard` and recompute on layout changes**

In `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`, add `getViewportEl: () => DOMRect | null;` to the component's `Props` interface (near the other function-typed props like `onCardSelect`), and destructure `getViewportEl` from the component's props (in its parameter list, alongside `output`, `cardKey: cardKeyProp`, etc.).

Find the existing computed layout block (search for `const noTransition =`):

```typescript
  const mdDx = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dx : 0;
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const displayX = localResize?.x ?? localDragPos?.x ?? (cardX + mdDx);
  const displayY = localResize?.y ?? localDragPos?.y ?? (cardY + mdDy);
  const displayW = localResize?.w ?? cardWidth;
  const displayH = localResize?.h ?? cardHeight;
  const noTransition = isDragging || isResizing || (isSelected && !!multiDragDelta);
```

Replace with:

```typescript
  const mdDx = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dx : 0;
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const displayX = localResize?.x ?? localDragPos?.x ?? (cardX + mdDx);
  const displayY = localResize?.y ?? localDragPos?.y ?? (cardY + mdDy);
  const displayW = localResize?.w ?? cardWidth;
  const displayH = localResize?.h ?? cardHeight;
  const noTransition = isDragging || isResizing || (isSelected && !!multiDragDelta);
  const FULLSCREEN_Z_INDEX = 999998;
  // Viewport's own layout rect (sidebar width, insets, banners already resolved by CSS) — re-measured on mount-while-fullscreen and on window resize, since the viewport's on-screen size can change independent of any React re-render this component would otherwise get.
  const [viewportRect, setViewportRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!isFullscreen) return;
    const measure = () => setViewportRect(getViewportEl());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isFullscreen, getViewportEl]);
  // Card stays in the canvas' zoomed/panned tree (never reparented — reparenting a live <webview>/<iframe> reloads it). Sized in canvas-space so the ambient transform (translate(panX,panY) scale(zoom)) lands it exactly over the viewport element's own rect, then its own inverse scale(1/zoom) undoes the zoom for its own content. Falls back to the card's normal display rect if the viewport hasn't been measured yet (first fullscreen frame).
  const fsLeft = viewportRect ? -panX / zoom : displayX;
  const fsTop = viewportRect ? -panY / zoom : displayY;
  const fsWidth = viewportRect ? viewportRect.width : displayW;
  const fsHeight = viewportRect ? viewportRect.height : displayH;
```

- [ ] **Step 4: Branch the root `Box`'s positioning `sx`**

Find the root `Box`'s `sx` prop. If a prior revision's changes are present (`isFullscreen ? fsLeft : displayX` etc. already exist, possibly referencing a now-removed `FULLSCREEN_TOP_OFFSET`), reconcile to exactly this shape — the field names (`fsLeft`/`fsTop`/`fsWidth`/`fsHeight`) are unchanged from revision 1.5, only their computation (Step 3 above) changed, so this `sx` block should already match or need only the `FULLSCREEN_TOP_OFFSET` reference removed if it lingered. The target `sx` (from a clean pre-fullscreen baseline) is:

```typescript
      sx={{
        position: 'absolute',
        // contain + willChange: own compositor layer so paint stays scoped (see AgentCard for full rationale).
        contain: 'layout style',
        willChange: 'transform',
        left: isFullscreen ? fsLeft : displayX,
        top: isFullscreen ? fsTop : displayY,
        width: isFullscreen ? fsWidth : displayW,
        height: isFullscreen ? fsHeight : displayH,
        // Cancels the ambient canvas zoom (transformOrigin '0 0' matches the canvas content layer's own origin) so header text, buttons, and the app inside render at native size instead of being visually scaled by the canvas zoom level.
        transform: isFullscreen ? `scale(${1 / zoom})` : 'none',
        transformOrigin: '0 0',
        borderRadius: isFullscreen ? 0 : `${c.radius.lg}px`,
```

Leave the rest of the `sx` object (border, bgcolor, boxShadow, overflow, display, flexDirection, transition, hover rules, highlight animation) unchanged, except `zIndex`:

```typescript
        zIndex: isFullscreen ? FULLSCREEN_Z_INDEX : (isDragging || isResizing) ? 999999 : cardZOrder,
```

- [ ] **Step 5: Confirm no `createPortal`, no `cardTree` split, single return statement**

The component must have exactly one `return (<Box ...> ... </Box>);` for its main JSX. If any prior revision left a `cardTree` variable or a `createPortal(...)` call for the fullscreen path, remove it, collapsing back to a single unconditional return. The unrelated, pre-existing `createPortal` usage for the reload-menu popover elsewhere in this file must remain untouched.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. Pay attention to `useDashboardController.ts`'s return type/interface if one is explicitly declared (vs. inferred) — `getViewportEl` needs to be included there too if so; search for how `getCanvasState`'s type is threaded and mirror it exactly.

- [ ] **Step 7: Manual math sanity check**

If you can run the dev app (see `docs/HANDOFF.md`), open a dashboard with an app card, zoom the canvas to something other than 100%, toggle fullscreen, and in devtools:

```js
const card = document.querySelector('[data-select-type="view-card"]').getBoundingClientRect();
const viewport = document.querySelector('[data-select-type="view-card"]').closest('[style*="overflow"]')?.getBoundingClientRect();
console.log(card, viewport);
```

Expected: `card.x/y/width/height` closely match the viewport's own rect (not `window.innerWidth`/`innerHeight`). If you cannot stand up a live app card in this environment, skip this and note it — Task 7 covers manual smoke testing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
git commit -m "feat(dashboard): size app card to fill the canvas viewport on fullscreen"
```

---

### Task 5b: Hide the floating dashboard header while a card is fullscreen

**Context:** `DashboardCanvas.tsx` renders a floating `DashboardHeader` overlay positioned
above the canvas viewport (`position: absolute, top: 0, zIndex: 10`). Since the fullscreen
card (Task 5) stays inside the canvas viewport rather than escaping to `document.body`, this
floating header would otherwise paint over the top of the fullscreen card. Hide it whenever
any card is fullscreen, using the same `fullscreenCardId` Redux flag from Task 1/2.

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`

- [ ] **Step 1: Read the fullscreen flag**

`DashboardCanvas.tsx` is currently a pure presentational component (all props, no direct
`useAppSelector` calls) — this is a deliberate, minimal exception to that pattern since
threading one boolean through `useDashboardController` and every intermediate prop would be
disproportionate for a single visibility flag. Add near the top of the component body (find
where the component's props are destructured, e.g. a line starting `}) => {`):

```typescript
  const fullscreenCardId = useAppSelector((s) => s.tempState.fullscreenCardId);
```

Add the import at the top of the file, alongside the other imports:

```typescript
import { useAppSelector } from '@/shared/hooks';
```

### Step 2: Hide the floating header overlay

Find the floating header's wrapper `Box`:

```typescript
      {/* Floating header overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          pointerEvents: 'none',
```

Change the opening tag to conditionally render:

```typescript
      {/* Floating header overlay; hidden while any card is fullscreen so it can't paint over the top of it. */}
      {!fullscreenCardId && (
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          pointerEvents: 'none',
```

Find that same `Box`'s closing tag (it should be the matching close for the `Box` that
contains the inner `Box` wrapping `<DashboardHeader ... />`) — it looks like:

```typescript
        </Box>
      </Box>
```

(the outer of these two closes the floating-header wrapper `Box` you just made conditional).
Change it to:

```typescript
        </Box>
      </Box>
      )}
```

Verify by reading the surrounding JSX carefully — there may be multiple `</Box>\n      </Box>` sequences in this file; confirm you're closing the SAME element you opened in Step 2 by checking indentation and that it's the one immediately containing the `<DashboardHeader` component.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx
git commit -m "feat(dashboard): hide floating dashboard header while a card is fullscreen"
```

---

### Task 6: Add i18n strings

**Files:**
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: `frontend/src/shared/i18n/pt-BR.json`

- [ ] **Step 1: Add English strings**

In `frontend/src/shared/i18n/en.json`, find (around line 1090-1091):

```json
      "openAnotherWindow": "Open another window",
      "showToolbar": "Show toolbar",
```

Replace with:

```json
      "openAnotherWindow": "Open another window",
      "enterFullscreen": "Enter fullscreen",
      "exitFullscreen": "Exit fullscreen",
      "showToolbar": "Show toolbar",
```

- [ ] **Step 2: Add Portuguese strings**

In `frontend/src/shared/i18n/pt-BR.json`, find (around line 1090-1091):

```json
      "openAnotherWindow": "Abrir em outra janela",
      "showToolbar": "Mostrar a barra de ferramentas",
```

Replace with:

```json
      "openAnotherWindow": "Abrir em outra janela",
      "enterFullscreen": "Entrar em tela cheia",
      "exitFullscreen": "Sair da tela cheia",
      "showToolbar": "Mostrar a barra de ferramentas",
```

- [ ] **Step 3: Validate both JSON files parse**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/shared/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/shared/i18n/pt-BR.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(i18n): add fullscreen toggle strings for app card"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify pipeline**

Run: `npm run verify`
Expected: green — build + lint + typecheck + tests + golden smoke + call-home check all pass. Per `CLAUDE.md`, this must be run with `MAESTRO_MOCK_AGENT` unset for the backend suite (this feature touches frontend only, so no backend baseline change is expected).

- [ ] **Step 2: Manual smoke test**

Start the dev app (see `docs/HANDOFF.md` for the run command if unfamiliar with this repo's dev workflow). Then:
1. Open a dashboard with a running app card (or create one via the app builder).
2. Zoom the canvas in or out (not 100%) before testing, so a zoom-math bug isn't masked by the 1.0 no-op case.
3. Click the new fullscreen icon in the app card's header.
4. Confirm: the card expands to fill the window below the titlebar, the top nav island (search pill / agent status) disappears, the floating dashboard header disappears, the app content (webview/iframe) does not reload or flash, and its contents render at native (not zoomed) size.
5. Press `Escape`. Confirm: the card returns to its normal canvas position/size/zoom-scaled appearance, the nav island and floating header reappear.
6. Re-enter fullscreen, then click the fullscreen-exit icon in the toolbar. Confirm same behavior as Escape.
7. While fullscreen, switch to Code/Logs/Shell/History tabs and confirm they render correctly at full size.
8. While fullscreen, click the close ("X") button. Confirm the card is removed and the nav island + floating header are restored (the `useEffect` cleanup in Task 3 Step 4 clears `fullscreenCardId` on unmount).
9. While fullscreen, resize the OS window. Confirm the card's fullscreen size tracks the new window dimensions (Task 5's resize listener).

- [ ] **Step 3: Commit if any fixes were needed during smoke testing**

```bash
git add -A
git commit -m "fix: address issues found in fullscreen smoke test"
```

(Skip this step if no fixes were needed.)

---

## Self-Review Notes

- **Spec coverage:** toolbar button ✓ (Task 4), fullscreen sizing covering the canvas viewport area without reparenting ✓ (Task 5 revision 2), floating dashboard header hidden ✓ (Task 5b), nav island hidden via Redux flag ✓ (Tasks 1-2), Escape + button exit ✓ (Task 3 Step 4, Task 4 Step 4), no persistence to dashboard layout ✓ (plain `useState`, Task 3 Step 3), drag/resize disabled while fullscreen ✓ (Task 4 Steps 1-2), i18n strings ✓ (Task 6), webview/iframe not remounted ✓ (Task 5 never reparents the DOM node — sizing/scale only).
- **Type consistency:** `setFullscreenCardId`/`clearFullscreenCardId` names match between Task 1 (slice) and Task 3 (usage), with `clearFullscreenCardId` scoped to take the owning card's id (fixed post-Task-3-review to avoid one card's cleanup clobbering another's active fullscreen slot). `isFullscreen`/`handleToggleFullscreen` names match between Tasks 3, 4, and 5. Task 5's `getViewportEl`/`viewportRect`/`fsLeft`/`fsTop`/`fsWidth`/`fsHeight` follow the existing `getCanvasState` threading pattern (`useDashboardController` → `DashboardCanvas` → `DashboardCardLayer` → the card) rather than introducing a new one.
- **Design revision history:** Task 5 went through two rewrites during execution. Revision 1 (`createPortal` into `document.body`) was rejected after code review + research showed reparenting a live `<webview>`/`<iframe>` reloads it (see the design spec's "Rejected: portal-based fullscreen" section). Revision 1.5 (window-relative sizing, no reparent) was itself rejected after a second review pass found the card's actual containing chain — a resizable sidebar, insets, banners, and three `overflow: hidden` ancestors — makes window-relative math wrong and clips the result regardless. Revision 2 (this plan's current Task 5) sizes against the canvas viewport element's own measured rect instead, which is reachable without reparenting and isn't clipped since it fills exactly the space the viewport already occupies. Task 5b was added to address a consequence of keeping the card in the canvas tree (the floating header would otherwise cover it).
- **Out of scope confirmed:** no changes to `BrowserCard`, `AgentCard`, `NoteCard`, or OS-level Fullscreen API, per the approved spec.
