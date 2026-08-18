# App Card Fullscreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen toggle to app windows (`DashboardViewCard`) on the Dashboard canvas that fills the window's content area and hides the top nav island while active.

**Architecture:** A local `isFullscreen` boolean in `DashboardViewCard` controls sizing only — the card's DOM node is never reparented (an earlier portal-based design was rejected: reparenting a live `<webview>`/`<iframe>` reloads it). Instead, while fullscreen, the card computes a canvas-space rect and an inverse `scale(1/zoom)` so the ambient canvas pan/zoom transform lands it exactly over the window content area. A new `fullscreenCardId` field in the existing `tempStateSlice` (Redux), scoped so only the owning card can clear it, signals `AppShell` to hide `DynamicIsland` and `DashboardCanvas` to hide its floating header while any card is fullscreen. Escape key and a toolbar button both exit.

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

### Task 5: Size the card to fill the window when fullscreen, without reparenting it

**Superseded design note:** an earlier version of this task portaled the card into
`document.body` with `position: fixed`. Code review plus research into
`electron/electron#9529` (and related issues) established that moving a `<webview>`'s DOM
node to a new parent tears down and reloads its guest page, even via a non-destructive React
portal — the browser-process guestview attachment is driven by the custom element's native
DOM connect/disconnect lifecycle, not by React's reconciliation. The `<iframe>` path (srcdoc
apps) has the same failure by the HTML spec: moving an iframe always re-navigates it. Both
would silently reload the user's live app every time they toggle fullscreen. This replacement
task keeps the card's DOM node exactly where it already is — inside the canvas' zoomed/panned
content layer — and instead counter-transforms it so it visually fills the screen.

If a prior run of this plan already applied the portal version (commit message "feat(dashboard): portal app card fullscreen over the whole window"), first revert its content changes in `DashboardViewCard.tsx` back to pre-portal (position/left/top/width/height/zIndex all unconditional, single `return (<Box ...>...</Box>);` with no `cardTree` variable and no `createPortal(...)` call) before applying this task — do not layer this task on top of the reverted-away code. Do NOT `git revert` the commit (that would also revert the fullscreen-state groundwork in later diffs if any landed on top); instead hand-edit the file back to the pre-portal shape for just the `sx` block and the return statement, matching the "before" snippets shown in Step 2 and Step 3 below.

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`

### Background: the math

The canvas' content layer (`frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`)
wraps all cards in a `<div>` with `transform: translate(panX, panY) scale(zoom)` and
`transformOrigin: '0 0'`. For a point at canvas-space coordinate `(x, y)` inside that div, its
on-screen position is `(panX + x * zoom, panY + y * zoom)`.

`DashboardViewCard` already receives `zoom`, `panX`, `panY` as props (used elsewhere for drag
math). To make the card visually occupy the screen rect from `(0, TOP)` to
`(window.innerWidth, window.innerHeight)` (where `TOP = 38`, matching AppShell's
`TITLEBAR_HEIGHT`) while staying inside that transformed div:

- `fsLeft = -panX / zoom` (canvas-space left, so `panX + fsLeft * zoom = 0`)
- `fsTop = (TOP - panY) / zoom` (so `panY + fsTop * zoom = TOP`)
- `fsWidth = window.innerWidth * zoom` (canvas-space width — see below for why this is
  pre-multiplied by `zoom` rather than divided)
- `fsHeight = (window.innerHeight - TOP) * zoom`

The card itself will also carry `transform: scale(1 / zoom)` (see Step 2) so its own contents
(text, buttons, the webview/iframe) render at native size instead of visually shrunk or
enlarged by the ambient canvas zoom. CSS transforms on nested elements compose
multiplicatively as painted: the ambient transform scales the card's box by `zoom`, then the
card's own `scale(1/zoom)` scales its rendered content by `1/zoom`, and `zoom * (1/zoom) = 1`.
Layout size (what `width`/`height` declare) is unaffected by either `transform` — only paint
is. So the box's *declared* `width`/`height` should equal the desired on-screen size directly,
with no extra multiplication by `zoom`: `fsWidth = window.innerWidth`,
`fsHeight = window.innerHeight - TOP` (both already in canvas units, since a `transform` never
changes what value `width`/`height` need to be for a given rendered size once the two scale
factors cancel). Verify this holds empirically in Step 6 rather than trusting the algebra
alone — check the rendered `getBoundingClientRect()` of the fullscreen card matches the
window's inner size regardless of what zoom level was active when fullscreen was entered.

- [ ] **Step 1: Compute fullscreen-aware position/size/scale constants**

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
  // Matches AppShell's TITLEBAR_HEIGHT (frontend/src/app/components/Layout/AppShell.tsx) so fullscreen starts right below the OS titlebar row.
  const FULLSCREEN_TOP_OFFSET = 38;
  const FULLSCREEN_Z_INDEX = 999998;
  // Window size, recomputed on resize below. Kept in state (not read live in sx) so the card re-renders when the OS window is resized while fullscreen.
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    if (!isFullscreen) return;
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isFullscreen]);
  // Card stays in the canvas' zoomed/panned tree (never reparented — reparenting a live <webview>/<iframe> reloads it). Instead it's sized in canvas-space so the ambient transform (translate(panX,panY) scale(zoom)) lands it exactly over the window, then its own inverse scale(1/zoom) undoes the zoom for its own content.
  const fsLeft = -panX / zoom;
  const fsTop = (FULLSCREEN_TOP_OFFSET - panY) / zoom;
  const fsWidth = viewportSize.w;
  const fsHeight = viewportSize.h - FULLSCREEN_TOP_OFFSET;
```

- [ ] **Step 2: Branch the root `Box`'s positioning `sx`**

Find the root `Box`'s `sx` prop. The current `sx` starts:

```typescript
      sx={{
        position: 'absolute',
        // contain + willChange: own compositor layer so paint stays scoped (see AgentCard for full rationale).
        contain: 'layout style',
        willChange: 'transform',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        borderRadius: `${c.radius.lg}px`,
```

Replace those specific lines (`position` through `borderRadius`) with:

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

Leave the rest of the `sx` object (border, bgcolor, boxShadow, overflow, display,
flexDirection, transition, hover rules, highlight animation) unchanged, except the `zIndex`
line. Find:

```typescript
        zIndex: (isDragging || isResizing) ? 999999 : cardZOrder,
```

Replace with:

```typescript
        zIndex: isFullscreen ? FULLSCREEN_Z_INDEX : (isDragging || isResizing) ? 999999 : cardZOrder,
```

(`999999` is still used elsewhere in this same `sx` object for the drag/resize case, so
`FULLSCREEN_Z_INDEX = 999998` intentionally sits just under it — fullscreen and
drag/resize-in-progress can't both be true for the same card at once in practice, since drag
is disabled while fullscreen, but keeping fullscreen slightly below that value avoids the two
constants colliding if that ever changes.)

- [ ] **Step 3: Confirm the return statement is unchanged (no portal, no `cardTree` split)**

The component should still have exactly one `return (<Box ...> ... </Box>);` — the same
shape it had before Task 5 was ever attempted. If a previous attempt introduced `const
cardTree = (...)` and `return isFullscreen ? createPortal(cardTree, document.body) :
cardTree;`, revert that back to a single unconditional `return (<Box ...>...</Box>);` as part
of this task (see the superseded-design note above this task).

- [ ] **Step 4: `createPortal` import**

This task does not use `createPortal` for the fullscreen path. `createPortal` may still be
imported and used elsewhere in this file for the unrelated reload-menu popover — leave that
usage and its import alone; do not remove it.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual math sanity check**

This step exists because the sizing math above is easy to get subtly wrong (double-applying
`zoom`). After implementing, temporarily run the dev app (see `docs/HANDOFF.md`), open a
dashboard with an app card at a non-1.0 zoom level (zoom in or out on the canvas first), then
toggle that card's fullscreen button. In the browser/Electron devtools console, run:

```js
document.querySelector('[data-select-type="view-card"]').getBoundingClientRect()
```

Expected: `x` ≈ 0, `y` ≈ 38, `width` ≈ `window.innerWidth`, `height` ≈
`window.innerHeight - 38`, regardless of what the canvas zoom level was when you entered
fullscreen. If the numbers are off by a factor matching the zoom level (e.g. width is `zoom`
times too large or too small), the `fsWidth`/`fsHeight`/`transform: scale(...)` combination
has a sign or multiplication error — re-derive from the "Background: the math" section above
rather than guessing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
git commit -m "feat(dashboard): size app card to fill window on fullscreen via inverse zoom transform"
```

---

### Task 5b: Hide the floating dashboard header while a card is fullscreen

**Context:** `DashboardCanvas.tsx` renders a floating `DashboardHeader` overlay positioned
above the canvas viewport (`position: absolute, top: 0, zIndex: 10`). Since the fullscreen
card (Task 5) stays inside the canvas viewport rather than escaping to `document.body`, this
floating header would otherwise paint over the top ~38-48px of the fullscreen card. Hide it
whenever any card is fullscreen, using the same `fullscreenCardId` Redux flag from Task 1/2.

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`

- [ ] **Step 1: Read the fullscreen flag**

`DashboardCanvas.tsx` is currently a pure presentational component (all props, no direct
`useAppSelector` calls) — this is a deliberate, minimal exception to that pattern since
threading one boolean through `useDashboardController` (`frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`) and every intermediate prop would be
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

- **Spec coverage:** toolbar button ✓ (Task 4), fullscreen sizing covering window content area without reparenting ✓ (Task 5), floating dashboard header hidden ✓ (Task 5b), nav island hidden via Redux flag ✓ (Tasks 1-2), Escape + button exit ✓ (Task 3 Step 4, Task 4 Step 4), no persistence to dashboard layout ✓ (plain `useState`, Task 3 Step 3), drag/resize disabled while fullscreen ✓ (Task 4 Steps 1-2), i18n strings ✓ (Task 6), webview/iframe not remounted ✓ (Task 5 never reparents the DOM node — sizing/scale only).
- **Type consistency:** `setFullscreenCardId`/`clearFullscreenCardId` names match between Task 1 (slice) and Task 3 (usage), with `clearFullscreenCardId` scoped to take the owning card's id (fixed post-Task-3-review to avoid one card's cleanup clobbering another's active fullscreen slot). `isFullscreen`/`handleToggleFullscreen` names match between Tasks 3, 4, and 5. Task 5's `viewportSize`/`fsLeft`/`fsTop`/`fsWidth`/`fsHeight` are local to `DashboardViewCard` and don't leak into other tasks' code.
- **Design revision:** Task 5 was rewritten mid-execution after code review + research showed the original `createPortal` design would reload the app inside the card on every fullscreen toggle (see the design spec's "Rejected: portal-based fullscreen" section and Task 5's superseded-design note). Task 5b was added to address a consequence of keeping the card in the canvas tree (the floating header would otherwise cover it).
- **Out of scope confirmed:** no changes to `BrowserCard`, `AgentCard`, `NoteCard`, or OS-level Fullscreen API, per the approved spec.
