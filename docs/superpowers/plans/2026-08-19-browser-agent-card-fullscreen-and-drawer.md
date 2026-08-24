# Browser/Agent Card Fullscreen + Agent Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing app-card fullscreen feature to `BrowserCard` and `AgentCard`, and add a new slide-in drawer + previous-chats dropdown to `AgentCard`.

**Architecture:** `BrowserCard` gets a direct port of `DashboardViewCard`'s fullscreen mechanism (already ships: `fullscreenCardId` Redux flag, `getViewportEl`-based sizing, inverse `scale(1/zoom)`, no reparenting). `AgentCard` gets the same mechanism, but reads live pan/zoom only while fullscreen (via a `maestro:canvas-pan-changed` subscription, matching its existing drag-only subscription pattern) to preserve its no-re-render-on-pan optimization, and auto-expands via the existing `expandSession` action since fullscreen only makes sense on the full chat view. `AgentCard` additionally gets an independent `drawerCardId` Redux flag (parallel to `fullscreenCardId`) that renders the same embedded `AgentChat` in a MUI `Drawer`, plus a previous-chats dropdown that reassigns the card's `CardPosition` entry to a different session id (new `reassignCardSession` reducer, modeled on the existing `moveBrowserTab` reducer).

**Tech Stack:** React 18, MUI (`Box`, `IconButton`, `Tooltip`, `Drawer`, `Menu`, `MenuItem`), Redux Toolkit (`tempStateSlice`, `dashboardLayoutSlice`, `agentsSlice`), Vitest.

---

### Task 1: BrowserCard fullscreen — state, sizing, and toggle button

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/BrowserCard.tsx`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: `frontend/src/shared/i18n/pt-BR.json`

`BrowserCard` already receives `zoom`/`panX`/`panY` as live props (same shape as `DashboardViewCard` had), so this ports the mechanism directly — no perf adjustment needed (that's only required for `AgentCard`, see Task 3).

- [ ] **Step 1: Add icon imports and the two new Redux action imports**

In `frontend/src/app/pages/Dashboard/cards/BrowserCard.tsx`, find:

```typescript
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
```

Replace with:

```typescript
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
```

Find:

```typescript
import {
  setBrowserCardPosition,
  setBrowserCardSize,
  resumeBrowserCard,
  cancelBrowserCardEnding,
  addBrowserTab,
  removeBrowserTab,
  setActiveBrowserTab,
  updateBrowserTabUrl,
  updateBrowserTabTitle,
  updateBrowserTabFavicon,
  reorderBrowserTab,
  moveBrowserTab,
  recordClosedCard,
  type BrowserTab,
} from '@/shared/state/dashboardLayoutSlice';
```

Add immediately after it:

```typescript
import { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';
```

- [ ] **Step 2: Add `getViewportEl` to `Props` and destructure it**

Find:

```typescript
interface Props {
  browserId: string;
  tabs: BrowserTab[];
  activeTabId: string;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  cmdHeld?: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  // Belongs to a non-active dashboard but kept mounted-hidden so its webContents + sessionStorage survive the switch.
  keepAliveHidden?: boolean;
  onCardSelect?: (id: string, type: 'agent' | 'view' | 'browser', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  cardZOrder?: number;
  onDoubleClick?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onBringToFront?: (id: string, type: 'agent' | 'view' | 'browser') => void;
}
```

Replace with (adds `getViewportEl` at the end):

```typescript
interface Props {
  browserId: string;
  tabs: BrowserTab[];
  activeTabId: string;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  cmdHeld?: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  // Belongs to a non-active dashboard but kept mounted-hidden so its webContents + sessionStorage survive the switch.
  keepAliveHidden?: boolean;
  onCardSelect?: (id: string, type: 'agent' | 'view' | 'browser', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  cardZOrder?: number;
  onDoubleClick?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onBringToFront?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  // On-demand getter (see DashboardViewCard's fullscreen implementation for the same pattern) for the canvas viewport element, so this card can measure and ResizeObserver it while entering fullscreen.
  getViewportEl: () => HTMLDivElement | null;
}
```

Find:

```typescript
const BrowserCard: React.FC<Props> = ({
  browserId, tabs, activeTabId, cardX, cardY, cardWidth, cardHeight, zoom = 1, panX = 0, panY = 0, cmdHeld = false,
  isSelected = false, isHighlighted = false, keepAliveHidden = false, multiDragDelta, onCardSelect, onDragStart, onDragMove, onDragEnd,
```

Replace with:

```typescript
const BrowserCard: React.FC<Props> = ({
  browserId, tabs, activeTabId, cardX, cardY, cardWidth, cardHeight, zoom = 1, panX = 0, panY = 0, cmdHeld = false,
  isSelected = false, isHighlighted = false, keepAliveHidden = false, multiDragDelta, onCardSelect, onDragStart, onDragMove, onDragEnd,
  getViewportEl,
```

(Leave the rest of that destructuring line — `cardZOrder`, `onDoubleClick`, `onBringToFront`, the closing `}) => {` — exactly as it already is; only the `getViewportEl` name is new.)

- [ ] **Step 3: Add `isFullscreen` state and its effect, next to `dispatch`**

Find `const dispatch = useAppDispatch();` near the top of the component body (search for it — it's declared once, early in the component). Immediately after that line, add:

```typescript
  // Local-only, resets on reload/dashboard switch, never persisted to dashboard layout — matches DashboardViewCard's isFullscreen treatment.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isFullscreen) return;
    dispatch(setFullscreenCardId(browserId));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dispatch(clearFullscreenCardId(browserId));
    };
  }, [isFullscreen, dispatch, browserId]);
```

- [ ] **Step 4: Add the fullscreen sizing block next to the existing computed-layout block**

Find:

```typescript
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const displayX = localResize?.x ?? localDragPos?.x ?? (cardX + mdDx);
  const displayY = localResize?.y ?? localDragPos?.y ?? (cardY + mdDy);
  const displayW = localResize?.w ?? cardWidth;
  const displayH = localResize?.h ?? cardHeight;
  const noTransition = isDragging || isResizing || (isSelected && !!multiDragDelta);

  const isSecure = activeUrl.startsWith('https://');
```

Replace with:

```typescript
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const displayX = localResize?.x ?? localDragPos?.x ?? (cardX + mdDx);
  const displayY = localResize?.y ?? localDragPos?.y ?? (cardY + mdDy);
  const displayW = localResize?.w ?? cardWidth;
  const displayH = localResize?.h ?? cardHeight;
  const noTransition = isDragging || isResizing || (isSelected && !!multiDragDelta);
  const FULLSCREEN_Z_INDEX = 999998;
  // Viewport's own layout rect, re-measured via ResizeObserver on the real element (not a window 'resize' listener, so a sidebar drag or banner Collapse still re-measures it).
  const [viewportRect, setViewportRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!isFullscreen) return;
    const target = getViewportEl();
    if (!target) return undefined;
    const observer = new ResizeObserver(() => setViewportRect(target.getBoundingClientRect()));
    observer.observe(target);
    return () => {
      observer.disconnect();
      setViewportRect(null);
    };
  }, [isFullscreen, getViewportEl]);
  // Never reparented — reparenting a live <webview> reloads it. Sized in canvas-space so the ambient transform (translate(panX,panY) scale(zoom)) lands it exactly over the viewport's rect, then the card's own inverse scale(1/zoom) undoes the zoom for its own content.
  const fsLeft = viewportRect ? -panX / zoom : displayX;
  const fsTop = viewportRect ? -panY / zoom : displayY;
  const fsWidth = viewportRect ? viewportRect.width : displayW;
  const fsHeight = viewportRect ? viewportRect.height : displayH;

  const isSecure = activeUrl.startsWith('https://');
```

- [ ] **Step 5: Branch the root `Box`'s positioning `sx`**

Find:

```typescript
      sx={{
        position: 'absolute',
        // Kept-alive card from another dashboard: parked far off-screen so its webview surface can't bleed onto the dashboard you're viewing; click-through, webContents stays mounted.
        pointerEvents: keepAliveHidden ? 'none' : undefined,
        // contain: webview repaints don't shake neighbor cards.
        contain: 'layout style',
        // Own compositor layer so hover/paint invalidations stay contained to this card. See AgentCard for full rationale.
        willChange: 'transform',
        left: keepAliveHidden ? -100000 : displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        borderRadius: `${c.radius.lg}px`,
        border: agentBorder,
        bgcolor: c.bg.surface,
        boxShadow: agentShadow,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: (isDragging || isResizing) ? 999999 : cardZOrder,
```

Replace with:

```typescript
      sx={{
        position: 'absolute',
        // Kept-alive card from another dashboard: parked far off-screen so its webview surface can't bleed onto the dashboard you're viewing; click-through, webContents stays mounted.
        pointerEvents: keepAliveHidden ? 'none' : undefined,
        // contain: webview repaints don't shake neighbor cards.
        contain: 'layout style',
        // Own compositor layer so hover/paint invalidations stay contained to this card. See AgentCard for full rationale.
        willChange: 'transform',
        left: keepAliveHidden ? -100000 : (isFullscreen ? fsLeft : displayX),
        top: isFullscreen ? fsTop : displayY,
        width: isFullscreen ? fsWidth : displayW,
        height: isFullscreen ? fsHeight : displayH,
        // Cancels the ambient canvas zoom (transformOrigin '0 0' matches the canvas content layer's own origin) so the tab bar, nav bar, and page content render at native size.
        transform: isFullscreen ? `scale(${1 / zoom})` : 'none',
        transformOrigin: '0 0',
        borderRadius: isFullscreen ? 0 : `${c.radius.lg}px`,
        border: agentBorder,
        bgcolor: c.bg.surface,
        boxShadow: agentShadow,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: isFullscreen ? FULLSCREEN_Z_INDEX : (isDragging || isResizing) ? 999999 : cardZOrder,
```

- [ ] **Step 6: Guard the tab-bar drag handlers and hide resize handles while fullscreen**

Find:

```typescript
      <Box
        ref={tabBarRef}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        sx={{
          position: 'relative',
```

Replace with:

```typescript
      <Box
        ref={tabBarRef}
        onPointerDown={isFullscreen ? undefined : handleDragPointerDown}
        onPointerMove={isFullscreen ? undefined : handleDragPointerMove}
        onPointerUp={isFullscreen ? undefined : handleDragPointerUp}
        sx={{
          position: 'relative',
```

Find:

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
            zIndex: 20,
            ...sx,
          }}
        />
      ))}
```

Replace the opening line with a fullscreen guard:

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
            zIndex: 20,
            ...sx,
          }}
        />
      ))}
```

- [ ] **Step 7: Add the toggle handler next to `handleRemove`**

Find:

```typescript
  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(recordClosedCard({ kind: 'browser', id: browserId }));
    removeBrowserCardCleanly(browserId, dispatch);
  }, [dispatch, browserId]);
```

Replace with:

```typescript
  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(recordClosedCard({ kind: 'browser', id: browserId }));
    removeBrowserCardCleanly(browserId, dispatch);
  }, [dispatch, browserId]);

  const handleToggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFullscreen((v) => !v);
  }, []);
```

- [ ] **Step 8: Add the fullscreen toggle button to the tab bar's right-side controls**

Find:

```typescript
          <Tooltip title={t('dashboard.browserCard.closeBrowser')} placement="top">
            <IconButton
              size="small"
              onClick={handleRemove}
              onPointerDown={(e) => e.stopPropagation()}
              sx={{ color: c.text.ghost, p: 0.4, '&:hover': { color: c.status.error } }}
            >
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
```

Replace with (adds the fullscreen button immediately before the close button):

```typescript
          <Tooltip title={isFullscreen ? t('dashboard.browserCard.exitFullscreen') : t('dashboard.browserCard.enterFullscreen')} placement="top">
            <IconButton
              size="small"
              onClick={handleToggleFullscreen}
              onPointerDown={(e) => e.stopPropagation()}
              sx={{ color: c.text.ghost, p: 0.4, '&:hover': { color: c.text.primary } }}
            >
              {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 15 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 15 }} />}
            </IconButton>
          </Tooltip>

          <Tooltip title={t('dashboard.browserCard.closeBrowser')} placement="top">
            <IconButton
              size="small"
              onClick={handleRemove}
              onPointerDown={(e) => e.stopPropagation()}
              sx={{ color: c.text.ghost, p: 0.4, '&:hover': { color: c.status.error } }}
            >
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
```

- [ ] **Step 9: Thread `getViewportEl` in `DashboardCardLayer.tsx`**

In `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`, find the `<BrowserCard ... />` call site:

```typescript
      {Object.values({ ...browserCards, ...keepAliveBrowserCards }).map((bc) => (
        <BrowserCard
          key={`browser-${bc.browser_id}`}
          keepAliveHidden={!!bc.dashboard_id && bc.dashboard_id !== dashboardId}
          browserId={bc.browser_id}
          tabs={bc.tabs}
          activeTabId={bc.activeTabId}
          cardX={bc.x}
          cardY={bc.y}
          cardWidth={bc.width}
          cardHeight={bc.height}
          cardZOrder={bc.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          cmdHeld={cmdHeld}
          isSelected={selection.isSelected(bc.browser_id)}
          isHighlighted={highlightedCardId === bc.browser_id}
          multiDragDelta={multiDragDelta}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDoubleClick={onDoubleClick}
          onBringToFront={onBringToFront}
        />
      ))}
```

Add `getViewportEl={getViewportEl}` alongside the other props (e.g. right after `cmdHeld={cmdHeld}`):

```typescript
      {Object.values({ ...browserCards, ...keepAliveBrowserCards }).map((bc) => (
        <BrowserCard
          key={`browser-${bc.browser_id}`}
          keepAliveHidden={!!bc.dashboard_id && bc.dashboard_id !== dashboardId}
          browserId={bc.browser_id}
          tabs={bc.tabs}
          activeTabId={bc.activeTabId}
          cardX={bc.x}
          cardY={bc.y}
          cardWidth={bc.width}
          cardHeight={bc.height}
          cardZOrder={bc.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          cmdHeld={cmdHeld}
          getViewportEl={getViewportEl}
          isSelected={selection.isSelected(bc.browser_id)}
          isHighlighted={highlightedCardId === bc.browser_id}
          multiDragDelta={multiDragDelta}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDoubleClick={onDoubleClick}
          onBringToFront={onBringToFront}
        />
      ))}
```

`getViewportEl` is already a prop on `DashboardCardLayerProps` and already destructured in this component (added when `DashboardViewCard`'s fullscreen shipped) — verify with:

Run: `grep -n "getViewportEl" frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`
Expected: at least 3 matches (interface field, destructure, and the `DashboardViewCard` call site) before this step's edit; 4 after.

- [ ] **Step 10: Add i18n strings**

In `frontend/src/shared/i18n/en.json`, find:

```json
    "browserCard": {
      "newTab": "New Tab",
```

Replace with:

```json
    "browserCard": {
      "newTab": "New Tab",
      "enterFullscreen": "Enter fullscreen",
      "exitFullscreen": "Exit fullscreen",
```

In `frontend/src/shared/i18n/pt-BR.json`, find the same `"browserCard": {` opening (it starts identically) and its `"newTab"` line — check the actual pt-BR translation for `newTab` first with:

Run: `grep -n -A2 '"browserCard": {' frontend/src/shared/i18n/pt-BR.json`

Then insert the two new keys the same way, translated:

```json
      "enterFullscreen": "Entrar em tela cheia",
      "exitFullscreen": "Sair da tela cheia",
```

placed immediately after the opening `"browserCard": {` line's first entry, matching the en.json insertion point exactly (same key order in both files).

- [ ] **Step 11: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 12: Validate JSON**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/shared/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/shared/i18n/pt-BR.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 13: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/BrowserCard.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(dashboard): add fullscreen toggle to browser cards"
```

---

### Task 2: BrowserCard fullscreen — manual verification

**Files:** none (verification only)

- [ ] **Step 1: Manual smoke test**

Start the dev app (frontend `npm run dev` + electron `npm run dev`, per `docs/HANDOFF.md`). Open a dashboard with a browser card. Zoom the canvas to a non-100% level first. Click the new fullscreen icon in the browser card's tab bar (before the close button). Confirm: the card fills the canvas viewport area, the top nav island and floating dashboard header disappear, the tab bar and nav bar (back/forward/reload/URL) remain visible and usable, the page content doesn't reload. Press Escape — confirm it returns to normal size and both hidden UI pieces reappear. Re-enter fullscreen and click the fullscreen-exit icon instead of Escape — same result. Drag the sidebar wider/narrower while fullscreen — the card should keep tracking the available space (ResizeObserver, not a window resize listener).

---

### Task 3: AgentCard fullscreen — perf-scoped live pan/zoom subscription

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx`

`AgentCard` deliberately reads `zoom`/`panX`/`panY` only on demand via `getCanvasState()`, to avoid re-rendering every agent card on the canvas on every pan/zoom tick (see the existing comment on `OuterProps.getCanvasState`). This task adds a **local live-zoom subscription that exists only while `isFullscreen` is true**, matching the existing `maestro:canvas-pan-changed` subscription this file already uses (only while dragging) — see `AgentCard.tsx`'s `onPanChange` effect (around line 494-502) for the precedent this task follows.

- [ ] **Step 1: Add icon imports and the new Redux action imports**

Find:

```typescript
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import TerminalIcon from '@mui/icons-material/Terminal';
```

Replace with:

```typescript
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import TerminalIcon from '@mui/icons-material/Terminal';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
```

Find:

```typescript
import {
  setCardPosition,
  setCardSize,
  fadeGlowingAgentCard,
  clearGlowingAgentCard,
  removeCard,
  recordClosedCard,
} from '@/shared/state/dashboardLayoutSlice';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
```

Replace with:

```typescript
import {
  setCardPosition,
  setCardSize,
  fadeGlowingAgentCard,
  clearGlowingAgentCard,
  removeCard,
  recordClosedCard,
} from '@/shared/state/dashboardLayoutSlice';
import { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
```

Find (in the same existing import block from `agentsSlice`):

```typescript
import {
  AgentSession,
  handleApproval,
  collapseSession,
  closeSession,
  renameSession,
} from '@/shared/state/agentsSlice';
```

Replace with (adds `expandSession`, needed in Step 4 to auto-expand a collapsed card when entering fullscreen):

```typescript
import {
  AgentSession,
  handleApproval,
  collapseSession,
  expandSession,
  closeSession,
  renameSession,
} from '@/shared/state/agentsSlice';
```

- [ ] **Step 2: Add `getViewportEl` to `OuterProps` and `Props`**

Find:

```typescript
interface OuterProps {
  sessionId: string;
  expanded: boolean;
  // Stable getter, cards read pan/zoom on demand (drag math) instead of receiving them as props. Without this, every wheel/pan tick on the canvas re-rendered every card, even though the canvas root's CSS transform is what actually moves them visually. Cards only need the values inside drag callbacks; making it a ref-backed getter keeps pan/zoom out of memo equality entirely.
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  spawnFrom?: { x: number; y: number; type?: 'branch' };
  exitTarget?: { x: number; y: number };
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  onCardSelect?: (id: string, type: 'agent' | 'view', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'agent' | 'view') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  onBranch?: (sourceSessionId: string, newSessionId: string) => void;
  onMeasuredHeight?: (sessionId: string, height: number) => void;
  snapColumn?: { x: number; width: number };
  autoFocusInput?: boolean;
  onDoubleClick?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onBringToFront?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  shakeDirection?: 'left' | 'right' | 'up' | 'down' | null;
}
```

Replace with (adds `getViewportEl` and `dashboardId` — `dashboardId` is needed by Task 8's dropdown, added now since it touches the same interface):

```typescript
interface OuterProps {
  sessionId: string;
  expanded: boolean;
  // Stable getter, cards read pan/zoom on demand (drag math) instead of receiving them as props. Without this, every wheel/pan tick on the canvas re-rendered every card, even though the canvas root's CSS transform is what actually moves them visually. Cards only need the values inside drag callbacks; making it a ref-backed getter keeps pan/zoom out of memo equality entirely.
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  // On-demand getter (same rationale as getCanvasState) for the canvas viewport element, used only while this card is fullscreen.
  getViewportEl: () => HTMLDivElement | null;
  dashboardId: string;
  spawnFrom?: { x: number; y: number; type?: 'branch' };
  exitTarget?: { x: number; y: number };
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  onCardSelect?: (id: string, type: 'agent' | 'view', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'agent' | 'view') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  onBranch?: (sourceSessionId: string, newSessionId: string) => void;
  onMeasuredHeight?: (sessionId: string, height: number) => void;
  snapColumn?: { x: number; width: number };
  autoFocusInput?: boolean;
  onDoubleClick?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  onBringToFront?: (id: string, type: 'agent' | 'view' | 'browser') => void;
  shakeDirection?: 'left' | 'right' | 'up' | 'down' | null;
}
```

Find:

```typescript
interface Props extends Omit<OuterProps, 'sessionId'> {
  session: AgentSession;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  cardZOrder: number;
  getCanvasState: () => { panX: number; panY: number; zoom: number };
}
```

Replace with:

```typescript
interface Props extends Omit<OuterProps, 'sessionId'> {
  session: AgentSession;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  cardZOrder: number;
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  getViewportEl: () => HTMLDivElement | null;
}
```

Find:

```typescript
const AgentCard: React.FC<Props> = ({
  session, expanded, cardX, cardY, cardWidth, cardHeight, getCanvasState, spawnFrom, exitTarget,
  isSelected = false, isHighlighted = false, multiDragDelta, onCardSelect, onDragStart, onDragMove, onDragEnd,
  onBranch, onMeasuredHeight, snapColumn, autoFocusInput, cardZOrder = 0, onDoubleClick, onBringToFront,
  shakeDirection,
}) => {
```

Replace with:

```typescript
const AgentCard: React.FC<Props> = ({
  session, expanded, cardX, cardY, cardWidth, cardHeight, getCanvasState, getViewportEl, dashboardId, spawnFrom, exitTarget,
  isSelected = false, isHighlighted = false, multiDragDelta, onCardSelect, onDragStart, onDragMove, onDragEnd,
  onBranch, onMeasuredHeight, snapColumn, autoFocusInput, cardZOrder = 0, onDoubleClick, onBringToFront,
  shakeDirection,
}) => {
```

- [ ] **Step 3: Add `isFullscreen` state and its effect**

Find `const dispatch = useAppDispatch();` near the top of the component body. Immediately after it, add:

```typescript
  // Local-only, resets on reload/dashboard switch, never persisted — matches DashboardViewCard's isFullscreen treatment.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isFullscreen) return;
    dispatch(setFullscreenCardId(session.id));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dispatch(clearFullscreenCardId(session.id));
    };
  }, [isFullscreen, dispatch, session.id]);
```

- [ ] **Step 4: Add the toggle handler (auto-expands the card) next to `handleRemove`**

Find:

```typescript
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (linkedWorkflowSidecarId) {
      dispatch(setCardSidecar({ workflowId: linkedWorkflowSidecarId, sessionId: null, kind: null }));
    }
    // Record for Cmd+Shift+T BEFORE removeCard wipes the position, but only on a real close (the glow branch just clears a tether, it doesn't close the session).
    if (!glowEntry) dispatch(recordClosedCard({ kind: 'agent', id: session.id }));
    dispatch(collapseSession(session.id));
    dispatch(removeCard(session.id));
    if (glowEntry) {
      setTimeout(() => {
        dispatch(clearGlowingAgentCard(session.id));
      }, 500);
    } else {
      dispatch(closeSession({ sessionId: session.id }));
    }
  };
```

Replace with (adds `handleToggleFullscreen` after `handleRemove`, unchanged otherwise):

```typescript
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (linkedWorkflowSidecarId) {
      dispatch(setCardSidecar({ workflowId: linkedWorkflowSidecarId, sessionId: null, kind: null }));
    }
    // Record for Cmd+Shift+T BEFORE removeCard wipes the position, but only on a real close (the glow branch just clears a tether, it doesn't close the session).
    if (!glowEntry) dispatch(recordClosedCard({ kind: 'agent', id: session.id }));
    dispatch(collapseSession(session.id));
    dispatch(removeCard(session.id));
    if (glowEntry) {
      setTimeout(() => {
        dispatch(clearGlowingAgentCard(session.id));
      }, 500);
    } else {
      dispatch(closeSession({ sessionId: session.id }));
    }
  };

  // Fullscreen only makes sense on the full chat view, so entering it also expands a collapsed card (expandSession is a no-op if already expanded).
  const handleToggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFullscreen((v) => {
      if (!v) dispatch(expandSession(session.id));
      return !v;
    });
  };
```

- [ ] **Step 5: Add the fullscreen-scoped live pan/zoom subscription and sizing math**

Find the existing drag-only pan-change subscription (for context, do not modify this block):

```typescript
  // Dashboard dispatches maestro:canvas-pan-changed during edge-pan/wheel-zoom; only subscribed while dragging.
  useEffect(() => {
    if (!isDragging) return;
    const onPanChange = () => {
      if (didDrag.current) recomputeDragPos();
    };
    window.addEventListener('maestro:canvas-pan-changed', onPanChange);
    return () => window.removeEventListener('maestro:canvas-pan-changed', onPanChange);
  }, [isDragging, recomputeDragPos]);
```

Immediately after that block, add a new, separate effect and the fullscreen sizing math:

```typescript
  // Live pan/zoom, subscribed ONLY while fullscreen — this is the one case where AgentCard needs a value that updates on every pan/zoom tick instead of on demand. Kept as a separate, narrowly-scoped subscription (not a permanent live prop) specifically so a non-fullscreen AgentCard never re-renders on pan/zoom, preserving the getCanvasState optimization above for the common case.
  const [fullscreenCanvasState, setFullscreenCanvasState] = useState<{ panX: number; panY: number; zoom: number } | null>(null);
  useEffect(() => {
    if (!isFullscreen) {
      setFullscreenCanvasState(null);
      return undefined;
    }
    const sync = () => setFullscreenCanvasState(getCanvasState());
    sync();
    window.addEventListener('maestro:canvas-pan-changed', sync);
    return () => window.removeEventListener('maestro:canvas-pan-changed', sync);
  }, [isFullscreen, getCanvasState]);

  const FULLSCREEN_Z_INDEX = 999998;
  const [fullscreenViewportRect, setFullscreenViewportRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!isFullscreen) return;
    const target = getViewportEl();
    if (!target) return undefined;
    const observer = new ResizeObserver(() => setFullscreenViewportRect(target.getBoundingClientRect()));
    observer.observe(target);
    return () => {
      observer.disconnect();
      setFullscreenViewportRect(null);
    };
  }, [isFullscreen, getViewportEl]);

  const fsZoom = fullscreenCanvasState?.zoom ?? 1;
  const fsPanX = fullscreenCanvasState?.panX ?? 0;
  const fsPanY = fullscreenCanvasState?.panY ?? 0;
  const fsLeft = fullscreenViewportRect ? -fsPanX / fsZoom : cardX;
  const fsTop = fullscreenViewportRect ? -fsPanY / fsZoom : cardY;
  const fsWidth = fullscreenViewportRect ? fullscreenViewportRect.width : cardWidth;
  const fsHeight = fullscreenViewportRect ? fullscreenViewportRect.height : cardHeight;
```

- [ ] **Step 6: Apply the fullscreen position/scale to the outer `motion.div` and size to the inner `Box`**

`AgentCard`'s position/zIndex live on the wrapping `motion.div` (via its `style` prop and framer-motion's `animate`), while width/height/border/etc. live on the inner `Box` — different from `BrowserCard`/`DashboardViewCard`'s single-element approach. Find:

```typescript
  return (
    <motion.div
      layout={false}
      initial={spawnInitial}
      animate={{ opacity: 1, scale: 1, left: activeX, top: activeY }}
      exit={exitAnimation}
      transition={spawnTransition}
      onPointerDownCapture={() => onBringToFront?.(session.id, 'agent')}
      style={{
        position: 'absolute',
        zIndex: isDragging || isResizing ? 999999 : cardZOrder,
      }}
    >
```

Replace with:

```typescript
  return (
    <motion.div
      layout={false}
      initial={spawnInitial}
      animate={{
        opacity: 1,
        scale: isFullscreen ? 1 / fsZoom : 1,
        left: isFullscreen ? fsLeft : activeX,
        top: isFullscreen ? fsTop : activeY,
      }}
      exit={exitAnimation}
      transition={isFullscreen ? { duration: 0 } : spawnTransition}
      onPointerDownCapture={() => onBringToFront?.(session.id, 'agent')}
      style={{
        position: 'absolute',
        transformOrigin: '0 0',
        zIndex: isFullscreen ? FULLSCREEN_Z_INDEX : (isDragging || isResizing ? 999999 : cardZOrder),
      }}
    >
```

Find the inner `Box`'s `sx` (search for `ref={cardBoxRef}` then its `sx={{` block):

```typescript
      sx={{
        position: 'relative',
        // contain: streaming chat updates inside don't reflow the dashboard. Skipping `paint` here because the highlighted/selected/glow boxShadows legitimately extend past the card border, `paint` containment would clip those visuals.
        contain: 'layout style',
        // Each card gets its own compositor layer; hover-cross used to cost 100-200ms PRESENTATION by re-painting the whole canvas.
        willChange: 'transform',
        width: localResize ? activeW : Math.max(cardWidth, MIN_W),
        height: localResize ? activeH : (expanded ? Math.max(EXPANDED_OVERLAY_H, cardHeight) : 'auto'),
```

Replace with:

```typescript
      sx={{
        position: 'relative',
        // contain: streaming chat updates inside don't reflow the dashboard. Skipping `paint` here because the highlighted/selected/glow boxShadows legitimately extend past the card border, `paint` containment would clip those visuals.
        contain: 'layout style',
        // Each card gets its own compositor layer; hover-cross used to cost 100-200ms PRESENTATION by re-painting the whole canvas.
        willChange: 'transform',
        width: isFullscreen ? fsWidth : (localResize ? activeW : Math.max(cardWidth, MIN_W)),
        height: isFullscreen ? fsHeight : (localResize ? activeH : (expanded ? Math.max(EXPANDED_OVERLAY_H, cardHeight) : 'auto')),
```

(Leave every other field in that `sx` object — `bgcolor`, `border`, `borderRadius`, `p`, `cursor`, `transition`, `boxShadow`, `display`, `flexDirection`, `overflow`, the `shakeDirection`/`isHighlighted` spreads — exactly as they are.)

- [ ] **Step 7: Guard the drag zone and hide resize handles while fullscreen**

Find (the drag zone wrapping the header):

```typescript
      {/* Drag zone: header + metadata , entire region above separator is draggable */}
      <Box
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        sx={{
          position: 'relative',
          zIndex: 16,
          mx: -2,
          mt: -2,
          px: 2,
          pt: 2,
          pb: 1.5,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
```

Replace with:

```typescript
      {/* Drag zone: header + metadata , entire region above separator is draggable */}
      <Box
        onPointerDown={isFullscreen ? undefined : handleDragPointerDown}
        onPointerMove={isFullscreen ? undefined : handleDragPointerMove}
        onPointerUp={isFullscreen ? undefined : handleDragPointerUp}
        sx={{
          position: 'relative',
          zIndex: 16,
          mx: -2,
          mt: -2,
          px: 2,
          pt: 2,
          pb: 1.5,
          cursor: isFullscreen ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          touchAction: 'none',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
```

Find `{HANDLE_DEFS.map(({ dir, sx }) => (` (the resize handles block inside the inner `Box`):

```typescript
      {HANDLE_DEFS.map(({ dir, sx }) => (
        <Box
          key={dir}
          onPointerDown={handleResizeDown(dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute',
            ...sx,
            cursor: CURSOR_MAP[dir],
```

Replace the opening line with a fullscreen guard (leave the rest of the block, including its closing, unchanged):

```typescript
      {!isFullscreen && HANDLE_DEFS.map(({ dir, sx }) => (
        <Box
          key={dir}
          onPointerDown={handleResizeDown(dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute',
            ...sx,
            cursor: CURSOR_MAP[dir],
```

- [ ] **Step 8: Add the fullscreen toggle button to the header's control row**

Find:

```typescript
          <Box
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 0.5 }}
          >
            <Tooltip title={isDraft ? t('common.remove') : t('dashboard.agentCard.closeChat')}>
              <IconButton
                size="small"
                onClick={handleRemove}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{
                  color: c.text.ghost,
                  p: 0.5,
                  '&:hover': { color: c.status.error, bgcolor: `${c.status.errorBg}` },
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
```

Replace with (adds the fullscreen toggle before the close button; hidden for a draft/welcome card since there's no real chat to fullscreen yet):

```typescript
          <Box
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 0.5 }}
          >
            {!isDraft && (
              <Tooltip title={isFullscreen ? t('dashboard.agentCard.exitFullscreen') : t('dashboard.agentCard.enterFullscreen')}>
                <IconButton
                  size="small"
                  onClick={handleToggleFullscreen}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: c.text.ghost,
                    p: 0.5,
                    '&:hover': { color: c.text.primary },
                  }}
                >
                  {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 16 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={isDraft ? t('common.remove') : t('dashboard.agentCard.closeChat')}>
              <IconButton
                size="small"
                onClick={handleRemove}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{
                  color: c.text.ghost,
                  p: 0.5,
                  '&:hover': { color: c.status.error, bgcolor: `${c.status.errorBg}` },
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
```

`isDraft` (`const isDraft = session.status === 'draft';`) is already declared earlier in this component and used elsewhere (e.g. `display: isDraft && !expanded ? 'none' : 'flex'`) — no new declaration needed.

- [ ] **Step 9: Thread `getViewportEl` and `dashboardId` through `AgentCardOuter`**

`AgentCardOuter` already spreads `{...props}` into the inner `MemoAgentCard`, so no change is needed there — confirm with:

Run: `grep -n -A15 "const AgentCardOuter" frontend/src/app/pages/Dashboard/cards/AgentCard.tsx`
Expected: the block still reads `<MemoAgentCard {...props} session={session} cardX={...} ... />` — since `getViewportEl` and `dashboardId` are now part of `OuterProps`, they flow through this spread automatically once the call site in `DashboardCardLayer.tsx` passes them (next step).

- [ ] **Step 10: Pass `getViewportEl` and `dashboardId` at the `AgentCard` call site in `DashboardCardLayer.tsx`**

Find:

```typescript
          <AgentCard
            key={sid}
            sessionId={sid}
            expanded={expandedSessionIds.includes(sid)}
            getCanvasState={getCanvasState}
            spawnFrom={origin}
```

Replace with:

```typescript
          <AgentCard
            key={sid}
            sessionId={sid}
            expanded={expandedSessionIds.includes(sid)}
            getCanvasState={getCanvasState}
            getViewportEl={getViewportEl}
            dashboardId={dashboardId}
            spawnFrom={origin}
```

(`getViewportEl` is already destructured in this component's props per Step 9's verification in Task 1; `dashboardId` is already a prop on `DashboardCardLayerProps` per the existing `keepAliveHidden={!!bc.dashboard_id && bc.dashboard_id !== dashboardId}` usage on the `BrowserCard` call site — confirm both with a quick read of the component's own prop destructuring before editing.)

- [ ] **Step 11: Add i18n strings**

In `frontend/src/shared/i18n/en.json`, find:

```json
    "agentCard": {
      "queued": "queued",
```

Replace with:

```json
    "agentCard": {
      "queued": "queued",
      "enterFullscreen": "Enter fullscreen",
      "exitFullscreen": "Exit fullscreen",
```

In `frontend/src/shared/i18n/pt-BR.json`, find the matching `"agentCard": {` block's first entry and insert the translated equivalents at the same position:

```json
      "enterFullscreen": "Entrar em tela cheia",
      "exitFullscreen": "Sair da tela cheia",
```

- [ ] **Step 12: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 13: Validate JSON**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/shared/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/shared/i18n/pt-BR.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 14: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/AgentCard.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(dashboard): add fullscreen toggle to agent cards"
```

---

### Task 4: AgentCard fullscreen — manual verification

**Files:** none (verification only)

- [ ] **Step 1: Manual smoke test**

Start the dev app. Open a dashboard with a collapsed (not-yet-expanded) agent card. Zoom the canvas to a non-100% level. Click the new fullscreen icon in its header. Confirm: the card auto-expands (shows the full `AgentChat` UI, not just the summary), then fills the canvas viewport, nav island + floating header disappear, message content renders at native size (not zoomed). Send a message while fullscreen — confirm the chat still streams normally. Press Escape — confirm the card returns to its normal position/size AND stays expanded (collapsing on exit was not part of this feature; only entering auto-expands). Pan the canvas while fullscreen (e.g. via the minimap or edge-pan) — confirm the card's fullscreen position stays pinned to the viewport (this exercises the `maestro:canvas-pan-changed` live subscription from Step 5). Test on a `isDraft`/welcome card — confirm the fullscreen button is absent there.

---

### Task 5: `drawerCardId` Redux state

**Files:**
- Modify: `frontend/src/shared/state/tempStateSlice.ts`
- Modify: `frontend/src/shared/state/tempStateSlice.test.ts`

- [ ] **Step 1: Write the failing tests**

Find the existing test file `frontend/src/shared/state/tempStateSlice.test.ts` and add these tests to it (append inside the existing `describe` block, or add a new adjacent `describe` — match whatever the file's current structure is; if the file has a single top-level `describe('tempState fullscreenCardId', ...)`, add a new sibling `describe` block after it):

```typescript
describe('tempState drawerCardId', () => {
  it('starts null', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.drawerCardId).toBeNull();
  });

  it('setDrawerCardId stores the card id', () => {
    const state = reducer(undefined, setDrawerCardId('session-abc123'));
    expect(state.drawerCardId).toBe('session-abc123');
  });

  it('clearDrawerCardId resets to null when the id matches', () => {
    const withId = reducer(undefined, setDrawerCardId('session-abc123'));
    const cleared = reducer(withId, clearDrawerCardId('session-abc123'));
    expect(cleared.drawerCardId).toBeNull();
  });

  it('clearDrawerCardId is a no-op when a different card owns the slot', () => {
    const withId = reducer(undefined, setDrawerCardId('session-abc123'));
    const unchanged = reducer(withId, clearDrawerCardId('session-other'));
    expect(unchanged.drawerCardId).toBe('session-abc123');
  });
});
```

Update the file's import line to include the two new actions — find:

```typescript
import reducer, { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';
```

Replace with:

```typescript
import reducer, { setFullscreenCardId, clearFullscreenCardId, setDrawerCardId, clearDrawerCardId } from '@/shared/state/tempStateSlice';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/shared/state/tempStateSlice.test.ts`
Expected: FAIL — `setDrawerCardId`/`clearDrawerCardId` not exported.

- [ ] **Step 3: Implement the slice change**

Replace the full contents of `frontend/src/shared/state/tempStateSlice.ts` with:

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TempState {
  pendingBrowserUrl: string | null;
  pendingFocusAgentId: string | null;
  lastDashboardId: string | null;
  fullscreenCardId: string | null;
  drawerCardId: string | null;
}

const initialState: TempState = {
  pendingBrowserUrl: null,
  pendingFocusAgentId: null,
  lastDashboardId: null,
  fullscreenCardId: null,
  drawerCardId: null,
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
    clearFullscreenCardId(state, action: PayloadAction<string>) {
      if (state.fullscreenCardId === action.payload) state.fullscreenCardId = null;
    },
    setDrawerCardId(state, action: PayloadAction<string>) {
      state.drawerCardId = action.payload;
    },
    clearDrawerCardId(state, action: PayloadAction<string>) {
      if (state.drawerCardId === action.payload) state.drawerCardId = null;
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
  setDrawerCardId,
  clearDrawerCardId,
} = tempStateSlice.actions;

export default tempStateSlice.reducer;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/shared/state/tempStateSlice.test.ts`
Expected: PASS (8 tests: 4 existing `fullscreenCardId` + 4 new `drawerCardId`)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/state/tempStateSlice.ts frontend/src/shared/state/tempStateSlice.test.ts
git commit -m "feat(state): add drawerCardId to tempState slice"
```

---

### Task 6: `reassignCardSession` reducer in `dashboardLayoutSlice`

**Files:**
- Modify: `frontend/src/shared/state/dashboardLayoutSlice.ts`
- Test: `frontend/src/shared/state/dashboardLayoutSlice.test.ts`

Moves an existing agent card's `CardPosition` (x/y/width/height/zOrder) from one session id key to another, leaving the old session with no canvas position (it remains reachable via history/search, just not pinned to a canvas slot) and the new session occupying that spot. Modeled on the existing `moveBrowserTab` reducer's move-between-keys pattern.

- [ ] **Step 1: Write the failing test**

`frontend/src/shared/state/dashboardLayoutSlice.test.ts` is currently 168 lines, structured as several `describe` blocks each with their own `import ... from '@/shared/state/dashboardLayoutSlice'` line (this file's established convention — do not try to consolidate imports at the top). Append a new import line and `describe` block at the end of the file (after line 168, the closing `});` of the `element reducers` block):

```typescript

import reducerCard, { reassignCardSession, fetchLayout as fetchLayoutCard } from '@/shared/state/dashboardLayoutSlice';

describe('reassignCardSession', () => {
  it('moves the position from the old session id to the new one', () => {
    const withCard = reducerCard(undefined, {
      type: fetchLayoutCard.fulfilled.type,
      payload: {
        cards: {
          'session-a': { session_id: 'session-a', x: 10, y: 20, width: 400, height: 300, zOrder: 5 },
        },
        viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [], elements: {},
      },
      meta: { arg: { dashboardId: 'd1' } },
    });
    const state = reducerCard(withCard, reassignCardSession({ fromSessionId: 'session-a', toSessionId: 'session-b' }));
    expect(state.cards['session-a']).toBeUndefined();
    expect(state.cards['session-b']).toEqual({ session_id: 'session-b', x: 10, y: 20, width: 400, height: 300, zOrder: 5 });
  });

  it('is a no-op when the source session has no card', () => {
    const state = reducerCard(undefined, reassignCardSession({ fromSessionId: 'missing', toSessionId: 'session-b' }));
    expect(state.cards['session-b']).toBeUndefined();
  });
});
```

(`reducerCard`/`fetchLayoutCard` are aliased on import because the file already has a `reducerDefault`/`fetchLayout` pair and a `reducerEl` pair from earlier blocks — a fresh alias avoids a name collision, matching how the file already disambiguates `reducer`/`reducerDefault`/`reducerEl` across its existing blocks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shared/state/dashboardLayoutSlice.test.ts`
Expected: FAIL — `reassignCardSession` is not exported.

- [ ] **Step 3: Implement the reducer**

In `frontend/src/shared/state/dashboardLayoutSlice.ts`, find:

```typescript
    removeCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload];
    },
```

Add immediately after it:

```typescript
    // Moves an agent card's canvas position from one session to another (e.g. the previous-chats dropdown swapping which session a card shows). The old session keeps no canvas position; it remains reachable via history/search.
    reassignCardSession(
      state,
      action: PayloadAction<{ fromSessionId: string; toSessionId: string }>,
    ) {
      const { fromSessionId, toSessionId } = action.payload;
      if (fromSessionId === toSessionId) return;
      const card = state.cards[fromSessionId];
      if (!card) return;
      delete state.cards[fromSessionId];
      state.cards[toSessionId] = { ...card, session_id: toSessionId };
    },
```

Find the actions export block:

```typescript
export const {
  setCardPosition,
  placeCard,
  setCardSize,
  removeCard,
  bringToFront,
```

Replace with:

```typescript
export const {
  setCardPosition,
  placeCard,
  setCardSize,
  removeCard,
  reassignCardSession,
  bringToFront,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/shared/state/dashboardLayoutSlice.test.ts`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/state/dashboardLayoutSlice.ts frontend/src/shared/state/dashboardLayoutSlice.test.ts
git commit -m "feat(state): add reassignCardSession reducer for the agent card session dropdown"
```

---

### Task 7: AgentCard drawer mode

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx`

Adds a second, independent expanded view: a MUI `Drawer` (matching `ContextDrawer.tsx`'s pattern) that renders the same embedded `AgentChat`, coexisting with the canvas rather than covering it. Drawer and fullscreen are mutually exclusive on the SAME card (its own toggle buttons don't both apply at once) but independent across different cards — opening a drawer never force-closes a fullscreen card elsewhere, per the approved design.

- [ ] **Step 1: Add imports**

Find:

```typescript
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
```

Replace with:

```typescript
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import Drawer from '@mui/material/Drawer';
```

Find:

```typescript
import { setFullscreenCardId, clearFullscreenCardId } from '@/shared/state/tempStateSlice';
```

Replace with:

```typescript
import { setFullscreenCardId, clearFullscreenCardId, setDrawerCardId, clearDrawerCardId } from '@/shared/state/tempStateSlice';
```

- [ ] **Step 2: Add `isDrawerOpen` state and its effect, next to `isFullscreen`**

Find the `isFullscreen` effect added in Task 3 Step 3:

```typescript
  // Local-only, resets on reload/dashboard switch, never persisted — matches DashboardViewCard's isFullscreen treatment.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isFullscreen) return;
    dispatch(setFullscreenCardId(session.id));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dispatch(clearFullscreenCardId(session.id));
    };
  }, [isFullscreen, dispatch, session.id]);
```

Add immediately after it:

```typescript
  // Independent of isFullscreen: a drawer coexists with a fullscreen card elsewhere on the canvas. Same local-only, non-persisted treatment.
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  useEffect(() => {
    if (!isDrawerOpen) return;
    dispatch(setDrawerCardId(session.id));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dispatch(clearDrawerCardId(session.id));
    };
  }, [isDrawerOpen, dispatch, session.id]);
```

- [ ] **Step 3: Add the drawer toggle handler next to `handleToggleFullscreen`**

Find the `handleToggleFullscreen` handler added in Task 3 Step 4:

```typescript
  // Fullscreen only makes sense on the full chat view, so entering it also expands a collapsed card (expandSession is a no-op if already expanded).
  const handleToggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFullscreen((v) => {
      if (!v) dispatch(expandSession(session.id));
      return !v;
    });
  };
```

Add immediately after it:

```typescript
  // Mutually exclusive with fullscreen on THIS card (opening one closes the other locally); does not touch any other card's state.
  const handleToggleDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDrawerOpen((v) => {
      const next = !v;
      if (next) {
        setIsFullscreen(false);
        dispatch(expandSession(session.id));
      }
      return next;
    });
  };
```

- [ ] **Step 4: Add the drawer toggle button to the header's control row**

Find the block added in Task 3 Step 8 (the fullscreen button inside the header controls `Box`):

```typescript
            {!isDraft && (
              <Tooltip title={isFullscreen ? t('dashboard.agentCard.exitFullscreen') : t('dashboard.agentCard.enterFullscreen')}>
                <IconButton
                  size="small"
                  onClick={handleToggleFullscreen}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: c.text.ghost,
                    p: 0.5,
                    '&:hover': { color: c.text.primary },
                  }}
                >
                  {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 16 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </Tooltip>
            )}
```

Replace with (adds the drawer toggle right after the fullscreen toggle):

```typescript
            {!isDraft && (
              <Tooltip title={isFullscreen ? t('dashboard.agentCard.exitFullscreen') : t('dashboard.agentCard.enterFullscreen')}>
                <IconButton
                  size="small"
                  onClick={handleToggleFullscreen}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: c.text.ghost,
                    p: 0.5,
                    '&:hover': { color: c.text.primary },
                  }}
                >
                  {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 16 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </Tooltip>
            )}
            {!isDraft && (
              <Tooltip title={isDrawerOpen ? t('dashboard.agentCard.closeDrawer') : t('dashboard.agentCard.openInDrawer')}>
                <IconButton
                  size="small"
                  onClick={handleToggleDrawer}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: isDrawerOpen ? c.accent.primary : c.text.ghost,
                    p: 0.5,
                    '&:hover': { color: c.text.primary },
                  }}
                >
                  <OpenInNewRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
```

- [ ] **Step 5: Render the drawer**

`{expanded && (...)}` (renders `AgentChat` on the canvas card) and `{!expanded && (...)}` (renders the collapsed preview) are two independent sibling blocks — find the exact point between them:

```typescript
          <AgentChat
            key={session.id}
            sessionId={session.id}
            onClose={() => dispatch(collapseSession(session.id))}
            embedded
            autoFocus={autoFocusInput}
            isGlowing={isGlowingRedux && !glowFading}
            onDismissGlow={dismissGlow}
            onBranch={onBranch ? (newId: string) => onBranch(session.id, newId) : undefined}
          />
        </Box>
      )}

      {!expanded && (
```

Replace with (inserts the `Drawer` between the two sibling blocks, changing nothing else):

```typescript
          <AgentChat
            key={session.id}
            sessionId={session.id}
            onClose={() => dispatch(collapseSession(session.id))}
            embedded
            autoFocus={autoFocusInput}
            isGlowing={isGlowingRedux && !glowFading}
            onDismissGlow={dismissGlow}
            onBranch={onBranch ? (newId: string) => onBranch(session.id, newId) : undefined}
          />
        </Box>
      )}

      <Drawer
        anchor="right"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        PaperProps={{ sx: { width: 480, bgcolor: c.bg.surface, color: c.text.primary, display: 'flex', flexDirection: 'column' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, borderBottom: `1px solid ${c.border.subtle}`, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayChatTitle(session)}
          </Typography>
          <IconButton size="small" onClick={() => setIsDrawerOpen(false)} sx={{ color: c.text.tertiary, flexShrink: 0 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {isDrawerOpen && (
            <AgentChat
              key={session.id}
              sessionId={session.id}
              embedded
            />
          )}
        </Box>
      </Drawer>

      {!expanded && (
```

`isDrawerOpen && (<AgentChat .../>)` (rather than always rendering and toggling `open`) keeps a closed drawer from mounting a second live `AgentChat` instance (with its own WebSocket subscription) alongside the one already rendered by the `{expanded && (...)}` block when the card is also expanded on the canvas. `displayChatTitle` and `AgentChat` are already imported in this file (used elsewhere) — no new imports needed for this step.

- [ ] **Step 6: Add i18n strings**

In `frontend/src/shared/i18n/en.json`, find (the two keys added in Task 3 Step 11):

```json
      "enterFullscreen": "Enter fullscreen",
      "exitFullscreen": "Exit fullscreen",
```

(inside the `"agentCard": {` block specifically — there are now two blocks with these exact key names in the file, `browserCard` and `agentCard`; make sure this edit targets `agentCard`'s copy) — replace with:

```json
      "enterFullscreen": "Enter fullscreen",
      "exitFullscreen": "Exit fullscreen",
      "openInDrawer": "Open in drawer",
      "closeDrawer": "Close drawer",
```

Apply the equivalent addition to `frontend/src/shared/i18n/pt-BR.json`'s `agentCard` block:

```json
      "openInDrawer": "Abrir na gaveta",
      "closeDrawer": "Fechar gaveta",
```

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Validate JSON**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/shared/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/shared/i18n/pt-BR.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/AgentCard.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(dashboard): add drawer mode to agent cards"
```

---

### Task 8: AgentCard drawer — manual verification

**Files:** none (verification only)

- [ ] **Step 1: Manual smoke test**

Start the dev app. Open a dashboard with at least two agent cards, one fullscreen-toggled and one not. Click the new "open in drawer" icon (external-link style) on the non-fullscreen card. Confirm: a panel slides in from the right showing that card's chat; the canvas (including the OTHER, fullscreen card) remains visible and interactive to the left; the nav island and floating dashboard header are still visible (drawer does NOT hide them, unlike fullscreen). Send a message in the drawer — confirm it streams normally. Close the drawer (X button) — confirm the canvas card is unaffected (still there, still fullscreen if it was). Reopen the drawer, then click the SAME card's fullscreen button — confirm the drawer closes (mutually exclusive on one card) without affecting the other card's fullscreen state. Press Escape while the drawer is open — confirm it closes.

---

### Task 9: Previous-chats dropdown — component

**Files:**
- Create: `frontend/src/app/pages/Dashboard/cards/AgentCardHistoryMenu.tsx`
- Modify: `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx`
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: `frontend/src/shared/i18n/pt-BR.json`

A small, focused component (kept separate from the already-large `AgentCard.tsx`, matching this codebase's file-per-responsibility convention) that lists this dashboard's sessions (excluding the one currently shown) and, on selection, dispatches `reassignCardSession`.

- [ ] **Step 1: Write the component**

Create `frontend/src/app/pages/Dashboard/cards/AgentCardHistoryMenu.tsx`:

```typescript
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import InputBase from '@mui/material/InputBase';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SearchIcon from '@mui/icons-material/Search';
import { useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { displaySessionName } from '@/shared/state/sessionDisplay';

interface Props {
  dashboardId: string;
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
}

interface Entry {
  id: string;
  name: string;
  // Recency key for sorting: closed_at (most recently finished) falling back to created_at. Neither AgentSession nor HistorySession has an updated_at field.
  recencyKey: string;
}

const AgentCardHistoryMenu: React.FC<Props> = ({ dashboardId, currentSessionId, onSelect }) => {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const sessions = useAppSelector((s) => s.agents.sessions);
  const history = useAppSelector((s) => s.agents.history);

  const entries = useMemo<Entry[]>(() => {
    const map = new Map<string, Entry>();
    for (const s of Object.values(sessions)) {
      if (s.id === currentSessionId || s.dashboard_id !== dashboardId) continue;
      map.set(s.id, { id: s.id, name: displaySessionName(s.name), recencyKey: s.closed_at || s.created_at });
    }
    for (const h of Object.values(history)) {
      if (h.id === currentSessionId || h.dashboard_id !== dashboardId || map.has(h.id)) continue;
      map.set(h.id, { id: h.id, name: h.name ? displaySessionName(h.name) : t('overlays.globalSearch.untitled'), recencyKey: h.closed_at || h.created_at });
    }
    const q = query.trim().toLowerCase();
    return Array.from(map.values())
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => b.recencyKey.localeCompare(a.recencyKey))
      .slice(0, 30);
  }, [sessions, history, dashboardId, currentSessionId, query, t]);

  return (
    <>
      <Tooltip title={t('dashboard.agentCard.switchChat')}>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
          onMouseDown={(e) => e.stopPropagation()}
          sx={{ color: c.text.ghost, p: 0.5, '&:hover': { color: c.text.primary } }}
        >
          <HistoryRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => { setAnchorEl(null); setQuery(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 400 } } }}
      >
        <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: `1px solid ${c.border.subtle}` }}>
          <SearchIcon sx={{ fontSize: 15, color: c.text.ghost }} />
          <InputBase
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={t('dashboard.agentCard.searchChats')}
            sx={{ fontSize: '0.8rem', flex: 1 }}
          />
        </Box>
        {entries.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary={t('dashboard.agentCard.noOtherChats')} />
          </MenuItem>
        ) : (
          entries.map((entry) => (
            <MenuItem
              key={entry.id}
              onClick={() => {
                onSelect(entry.id);
                setAnchorEl(null);
                setQuery('');
              }}
            >
              <ListItemText
                primary={entry.name}
                slotProps={{ primary: { sx: { fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } } }}
              />
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
};

export default AgentCardHistoryMenu;
```

Field names used above (`closed_at`, `created_at`, `dashboard_id`, `name`, `id`) match `AgentSession` and `HistorySession`'s actual definitions in `frontend/src/shared/state/agentsSlice.ts` — neither interface has an `updated_at` field, which is why `recencyKey` falls back to `created_at`.

- [ ] **Step 2: Typecheck the new file in isolation**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/AgentCardHistoryMenu.tsx
git commit -m "feat(dashboard): add AgentCardHistoryMenu component for the previous-chats dropdown"
```

---

### Task 10: Wire the previous-chats dropdown into AgentCard

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx`
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: `frontend/src/shared/i18n/pt-BR.json`

- [ ] **Step 1: Import the new component and the reducer**

Find:

```typescript
import {
  setCardPosition,
  setCardSize,
  fadeGlowingAgentCard,
  clearGlowingAgentCard,
  removeCard,
  recordClosedCard,
} from '@/shared/state/dashboardLayoutSlice';
```

Replace with:

```typescript
import {
  setCardPosition,
  setCardSize,
  fadeGlowingAgentCard,
  clearGlowingAgentCard,
  removeCard,
  recordClosedCard,
  reassignCardSession,
} from '@/shared/state/dashboardLayoutSlice';
import AgentCardHistoryMenu from './AgentCardHistoryMenu';
```

- [ ] **Step 2: Add the selection handler next to `handleToggleDrawer`**

Find the `handleToggleDrawer` handler added in Task 7 Step 3. Immediately after it, add:

```typescript
  const handleSwitchSession = (newSessionId: string) => {
    dispatch(reassignCardSession({ fromSessionId: session.id, toSessionId: newSessionId }));
  };
```

- [ ] **Step 3: Render the dropdown in the header, next to the drawer toggle**

Find the block added in Task 7 Step 4 (the drawer toggle `IconButton`, right after the fullscreen toggle). Immediately after that `{!isDraft && ( ... )}` block (still inside the same enclosing `Box`, before its closing `</Box>` and before the existing close-button `Tooltip`), add:

```typescript
            {!isDraft && (
              <AgentCardHistoryMenu
                dashboardId={dashboardId}
                currentSessionId={session.id}
                onSelect={handleSwitchSession}
              />
            )}
```

- [ ] **Step 4: Add i18n strings**

In `frontend/src/shared/i18n/en.json`, inside the `agentCard` block (find the `"closeDrawer"` key added in Task 7 Step 6), add immediately after it:

```json
      "closeDrawer": "Close drawer",
      "switchChat": "Switch to a previous chat",
      "searchChats": "Search chats...",
      "noOtherChats": "No other chats on this dashboard",
```

In `frontend/src/shared/i18n/pt-BR.json`'s `agentCard` block, add the equivalent:

```json
      "switchChat": "Trocar para uma conversa anterior",
      "searchChats": "Buscar conversas...",
      "noOtherChats": "Nenhuma outra conversa neste painel",
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Validate JSON**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/shared/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/shared/i18n/pt-BR.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/AgentCard.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(dashboard): wire the previous-chats dropdown into agent cards"
```

---

### Task 11: Previous-chats dropdown — manual verification

**Files:** none (verification only)

- [ ] **Step 1: Manual smoke test**

Start the dev app. Open a dashboard with at least two agent card sessions where one is pinned to a canvas card and the other exists only in history (closed, or never pinned — if none exists, close a second card first so its session moves to history). On the pinned card, click the new history/dropdown icon. Confirm: a small menu opens listing the OTHER session(s) on this dashboard (not the current one, not sessions from other dashboards). Type a few characters to filter — confirm the list narrows. Select an entry. Confirm: the card at that same position/size now shows the PICKED session's chat (title, messages) instead of the original one. Reload the dashboard (navigate away and back) — confirm the picked session is still the one shown at that position (the reassignment persisted through `dashboardLayoutSlice`, which is already wired to the layout save/load path). Confirm the ORIGINAL session is still reachable via `GlobalSearchPalette` (Cmd/Ctrl+K) — it wasn't deleted, just unpinned from this canvas slot.

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify pipeline**

Run: `npm run verify`
Expected: green — build + lint + typecheck + tests + golden smoke + call-home check. Per `CLAUDE.md`, run with `MAESTRO_MOCK_AGENT` unset for the backend suite. This feature touches frontend only, so no backend baseline change is expected; if the environment can't run the backend suite or produce a packaged build (no Python venv / no `electron/dist` build), note that explicitly rather than claiming a false pass — this happened during the original `DashboardViewCard` fullscreen work too, and is an environment gap, not a code issue.

- [ ] **Step 2: Address anything `npm run verify` flags**

If lint, typecheck, or the frontend test suite fail, fix the specific failure and re-run. Do not proceed to a final commit with a red frontend gate.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in full verify pass"
```

(Skip if nothing needed fixing.)

---

## Self-Review Notes

- **Spec coverage:** BrowserCard fullscreen ✓ (Tasks 1-2), AgentCard fullscreen with perf-preserving live-pan-zoom subscription ✓ (Tasks 3-4), AgentCard drawer mode independent of fullscreen ✓ (Tasks 5, 7-8), previous-chats dropdown scoped to the current dashboard, reassigning canvas position via `reassignCardSession` ✓ (Tasks 6, 9-11), i18n strings for all new UI ✓ (each task's own steps), no reparenting anywhere (all three card types use the viewport-rect + inverse-scale approach, never `createPortal`) ✓.
- **Type consistency:** `getViewportEl: () => HTMLDivElement | null` used identically across `BrowserCard`, `AgentCard` (`OuterProps` and `Props`), and `DashboardCardLayer`. `setFullscreenCardId`/`clearFullscreenCardId(id)` and the new `setDrawerCardId`/`clearDrawerCardId(id)` follow the exact same owner-scoped-clear shape. `reassignCardSession({ fromSessionId, toSessionId })` matches `CardPosition`'s existing field names (`session_id`, `x`, `y`, `width`, `height`, `zOrder`).
- **Sequencing:** Tasks are ordered so `AgentCard`'s fullscreen (Task 3) lands before its drawer (Task 7), since the drawer's toggle handler references `setIsFullscreen` to enforce mutual exclusion on the same card — Task 7 depends on Task 3's code existing first. Tasks 5 and 6 (the two new reducers) are independent of each other and of Tasks 1-4, so could run in parallel if using subagent-driven-development's dispatch, but are listed sequentially here for a single reader's clarity.
- **Verification-heavy:** given the added structural complexity in `AgentCard` (motion.div positioning, auto-expand-on-fullscreen, mutual exclusion with the drawer), each feature task is paired with its own manual-verification task (2, 4, 8, 11) rather than deferring everything to one final smoke test — catch integration issues closer to the code that caused them.
