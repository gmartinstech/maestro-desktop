# Frontend Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three HIGH-impact frontend findings from the 2026-08-18 fluidity audit — the eagerly-bundled CodeMirror/xterm dependencies, the unmemoized canvas re-render cascade during pan/zoom, and the Minimap's per-frame layout rebuild — so cold start is faster and panning/zooming stays smooth regardless of dashboard size.

**Architecture:** Task 1 introduces `React.lazy` boundaries around the code/shell/terminal panels, mirroring the existing `Settings`/`Analytics` lazy pattern already in the codebase. Task 2 narrows the `sessions` selector and memoizes the two canvas components that currently re-render on every animation frame. Task 3 memoizes `Minimap`. No new state management or abstractions — every fix works within the existing Redux + component structure.

**Tech Stack:** React 18, TypeScript (strict), Redux (RTK) with `useAppSelector`, MUI, webpack.

**Conventions (from `frontend/CLAUDE.md`, apply to every step below):**
- No leading `_` on any name; no barrel `index.ts` files.
- Single-purpose file naming — one-export files are named after their export.
- Strict typing — no bare untyped objects.
- Comments are ONE line each (`//`) — no multi-line blocks; WHY/gotcha only.
- No gratuitous blank lines (never stack 2+).

---

### Task 1: Lazy-load CodeMirror, xterm, and the terminal panel

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx:1-40`
- Test: manual verification (bundle analysis + browser check) — this codebase's test suite is Vitest-based per `CLAUDE.md`'s "frontend 9" gate; no existing unit test covers bundle composition, so verification here is a build-output check, not a new automated test.

**Context:** `DashboardViewCard.tsx:27-30` statically imports `TerminalPanel`, `AppCodePanel`, and `ShellPanel`. Each pulls in a heavy dependency (`@codemirror/*`, `@xterm/xterm`) that only needs to exist once a user opens that specific tab. The codebase already has this exact pattern for `Settings` and `Analytics` — find and copy it.

- [ ] **Step 1: Find the existing lazy-loading pattern**

Run: `grep -rn "React.lazy\|lazy(" frontend/src/app --include=*.tsx -l`

Read the file(s) found (expect the route-level component that lazy-loads `Settings`/`Analytics`) to see the exact `Suspense` fallback convention used in this codebase before writing new code:

```
Read <the file found above>
```

- [ ] **Step 2: Confirm the three panels' current usage sites inside `DashboardViewCard.tsx`**

Run: `grep -n "TerminalPanel\|AppCodePanel\|ShellPanel" frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`

Read the surrounding JSX for each usage (the `view`/`code`/`shell`/`history` tab switch, per the audit — search for the `AppCardView` type used at line 41 and where `activeView`/`view` state drives conditional rendering):

```
Read frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
```

Note the exact prop signatures passed to each of `TerminalPanel`, `AppCodePanel`, `ShellPanel` — lazy-loading must preserve every prop exactly.

- [ ] **Step 3: Replace the static imports with `React.lazy`**

Change (in `DashboardViewCard.tsx`, near line 27-30):

```typescript
import TerminalPanel, { TerminalLine } from '@/app/pages/Views/TerminalPanel';
import AppCodePanel from '@/app/pages/Views/AppCodePanel';
import HistoryPanel from '@/app/pages/Views/HistoryPanel';
import { ShellPanel } from '@/app/pages/Views/ShellPanel';
```

to:

```typescript
import { lazy, Suspense } from 'react';
import type { TerminalLine } from '@/app/pages/Views/TerminalPanel';
import HistoryPanel from '@/app/pages/Views/HistoryPanel';

const TerminalPanel = lazy(() => import('@/app/pages/Views/TerminalPanel'));
const AppCodePanel = lazy(() => import('@/app/pages/Views/AppCodePanel'));
const ShellPanel = lazy(() =>
  import('@/app/pages/Views/ShellPanel').then((m) => ({ default: m.ShellPanel })),
);
```

Note `ShellPanel` is a named export (`import { ShellPanel } from ...`) per the original import at line 30, so its lazy wrapper needs the `.then((m) => ({ default: m.ShellPanel }))` adapter — `TerminalPanel` and `AppCodePanel` are default exports and don't need this. Confirm `lazy`/`useState`/`useRef`/`useCallback`/`useEffect` are already imported at the top of the file (line 1) and merge the new `lazy, Suspense` into that existing import statement rather than adding a second one from `'react'`.

- [ ] **Step 4: Wrap each lazy component's render site in `Suspense`**

Find each JSX usage from Step 2 and wrap it. Match the fallback style found in Step 1's existing pattern (likely a MUI `CircularProgress` or similar — use the exact same fallback component so the loading experience is visually consistent across the app, not a bespoke one for this component). Example shape (adjust the fallback to match Step 1's finding):

```typescript
<Suspense fallback={<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><CircularProgress size={24} /></Box>}>
  <TerminalPanel {...existingPropsUnchanged} />
</Suspense>
```

Apply the same wrapping to the `AppCodePanel` and `ShellPanel` render sites, preserving every existing prop exactly as found in Step 2.

- [ ] **Step 5: Add the `CircularProgress` import if not already present**

Run: `grep -n "CircularProgress" frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx`
If no output and Step 4 used it, add `import CircularProgress from '@mui/material/CircularProgress';` next to the other MUI imports (lines 4-8), keeping the codebase's one-import-per-component MUI style.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. `TerminalLine` is now a `type`-only import — confirm nothing in the file uses it as a value (e.g. `new TerminalLine(...)` or `TerminalLine.something`) — if it does, the type-only import will fail to compile and `TerminalLine` needs a normal (non-type) named import alongside the lazy default.

- [ ] **Step 7: Build and inspect bundle output**

Run: `cd frontend && npm run build`

Confirm the build succeeds, then check for a separate chunk for the lazy-loaded modules:

Run: `ls -la frontend/dist/*.js 2>/dev/null || ls -la frontend/build/*.js 2>/dev/null`

Expect to see new chunk files beyond the single `bundle.js` (or whatever the main bundle is named per this project's webpack output config) — if everything is still one file, `webpack.config.js` may need `output.chunkFilename` configured; check:

Run: `grep -n "chunkFilename\|output:" frontend/webpack.config.js`

If `chunkFilename` is missing, add it alongside the existing `filename` config so lazy chunks get emitted with content hashes:

```javascript
chunkFilename: '[name].[contenthash].chunk.js',
```

Only make this webpack config change if Step 7's `ls` shows the split didn't actually happen — if separate chunks are already emitted, skip this sub-step entirely (don't touch working config).

- [ ] **Step 8: Manually verify in the running app**

This project's UI verification step (per the root `CLAUDE.md` "For UI or frontend changes, start the dev server...") applies here.

Run: `cd frontend && npm run dev` (or the project's documented dev-server command — check `frontend/package.json` scripts first if `npm run dev` doesn't exist)

Then in a browser:
1. Open the app, open a dashboard, do NOT open a code/shell/terminal tab.
2. Open browser DevTools → Network tab, filter by JS.
3. Confirm the CodeMirror/xterm chunk has NOT loaded.
4. Click the "code" tab on a view card.
5. Confirm the chunk loads at that point (a new network request appears), the `Suspense` fallback briefly shows, then the code panel renders correctly with syntax highlighting working.
6. Repeat for the "shell" tab (confirm xterm renders and is interactive) and the terminal panel.
7. Confirm no console errors.

- [ ] **Step 9: Run the existing frontend test suite**

Run: `cd frontend && npm test` (or the documented test command — check `package.json` if this doesn't match)
Expected: same pass count as before this change (per root `CLAUDE.md`, "frontend 9" tests pass on `main` — confirm this still holds).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx frontend/webpack.config.js
git commit -m "perf(frontend): lazy-load CodeMirror, xterm, and the terminal panel

DashboardViewCard statically imported all three regardless of which tab
was active, so every cold start paid for CodeMirror's language packs and
xterm even when the user never opened a code or shell tab. Now split into
their own chunks, downloaded only when that tab is actually opened."
```

---

### Task 2: Stop the dashboard canvas from re-rendering on every pan/zoom frame

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelectors.ts:9`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx:340` (export line — wrap in memo)
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx:362` (export line — wrap in memo)
- Test: `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.test.tsx` (check existing location; the audit's memory notes a recent `canvas-element-cards-spec` merge with vitest coverage in this directory)

**Context:** Two independent problems combine here. First, `useDashboardSelectors.ts:9` reads `state.agents.sessions` — the entire dict across every dashboard — with no `shallowEqual`, meaning a background session's cost/status update on a DIFFERENT dashboard re-renders the currently-viewed `Dashboard`. RTK/Immer only creates a new dict reference when one of its values actually changes (confirmed by the inline comment at `useDashboardController.ts:41`), so `shallowEqual` on the object reference alone won't help here — the fix must be to stop consuming the full dict where only a summary is needed. Second, `DashboardCanvas` and `DashboardCardLayer` are plain function components with no `React.memo`, so React re-renders their full bodies on every parent re-render, including every `requestAnimationFrame` tick during a pan/zoom gesture (`useCanvasControls.ts` drives `panX`/`panY`/`zoom` state through an rAF loop).

- [ ] **Step 1: Confirm which Dashboard-level code actually reads `sessions` beyond passing it through**

Run: `grep -n "sessions" frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`

From the earlier read, `sessions` appears at lines 34, 41 (used to derive `sessionList` via `useMemo`), 147, 172, 221, and 321 (passed to `DashboardCanvas`). Read the surrounding context of lines 140-230 to see whether any of those 3 middle usages do real computation with `sessions` beyond passing it to a child, or deriving `sessionList`:

```
Read frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts
```

If `sessions` is used only to (a) build `sessionList` and (b) pass straight through to children that themselves only read individual sessions by id (per the audit's finding that `AgentCard` already self-subscribes to its own session), then the full dict is not actually needed at the `Dashboard`/`DashboardCanvas` level except for `sessionList` and the pass-through to `DashboardHeader`/`DashboardOverlays` (verify what those two do with `sessions` too — grep them):

Run: `grep -n "sessions" frontend/src/app/pages/Dashboard/canvas/DashboardHeader.tsx frontend/src/app/pages/Dashboard/canvas/DashboardOverlays.tsx`

- [ ] **Step 2: Add `shallowEqual` to the sessions selector as the first, low-risk improvement**

Even though RTK already dict-swaps only on real changes (per the existing comment), the selector itself doesn't currently use `shallowEqual`, which means React-Redux's default reference-equality check is the only guard — this is already correct for the top-level dict swap case, so this step's real value is documenting the guarantee explicitly and matching the pattern the codebase already uses elsewhere (per the audit finding #6, `AppShell.tsx:172-188` already does this for `dashboards.items`/`outputs.items`). Read that existing pattern first:

```
Read frontend/src/app/pages/AppShell.tsx (lines 172-188)
```

Apply the same `shallowEqual` pattern to `useDashboardSelectors.ts:9`:

```typescript
import { useAppSelector } from '@/shared/hooks';
import { shallowEqual } from 'react-redux';
```

```typescript
const sessions = useAppSelector((state) => state.agents.sessions, shallowEqual);
```

- [ ] **Step 3: Verify `shallowEqual` is exported and used the same way elsewhere**

Run: `grep -n "shallowEqual" frontend/src/app/pages/AppShell.tsx`

Confirm the import path and usage pattern matches exactly (react-redux's `shallowEqual` vs. a project-local wrapper) — if `AppShell.tsx` imports it from a different path (e.g. a shared utils re-export), use that same path instead of `react-redux` directly, to stay consistent with the codebase's existing convention.

- [ ] **Step 4: Wrap `DashboardCanvas` in `React.memo`**

`DashboardCanvas.tsx:340` currently exports `export default DashboardCanvas;` where `DashboardCanvas` is defined as `const DashboardCanvas: React.FC<DashboardCanvasProps> = ({ ... }) => { ... }` (line 97). Change the export:

```typescript
export default React.memo(DashboardCanvas);
```

This is safe because every prop passed to `DashboardCanvas` (per the `DashboardCanvasProps` interface at lines 32-95) already comes from stable sources: `canvas` and `selection` are hook return values (stable object references unless their internal state changes), callback props (`onViewportMouseDown` etc.) are passed from the parent controller hook, and data props (`sessions`, `cards`, etc.) are Redux selector results. `React.memo`'s default shallow-prop comparison will correctly skip re-renders when none of these actually changed, INCLUDING the rAF-driven `canvas.panX`/`panY`/`zoom` ticks — but only if `canvas` itself is NOT a freshly-constructed object literal on every render of the parent. Verify this before proceeding:

Run: `grep -n "const canvas = useCanvasControls" frontend/src/app/pages/Dashboard/Dashboard.tsx`

Read `useCanvasControls.ts` to see whether its return value is a stable object (memoized) or a fresh object literal returned on every call (which would defeat `React.memo` immediately, since `canvas` would be prop-unequal on every single render regardless of whether its contents changed):

```
Read frontend/src/app/pages/Dashboard/hooks/interaction/useCanvasControls.ts
```

If the hook returns a fresh object literal every call (e.g. `return { panX, panY, zoom, actions, ... }` without `useMemo`), `React.memo` on `DashboardCanvas` alone will NOT prevent re-renders, because the `canvas` prop reference changes every render regardless of memoization. In that case, this step must be paired with wrapping the hook's return value in `useMemo` — do that first:

```typescript
return useMemo(() => ({
  panX, panY, zoom, isPanning, spaceHeld, cmdHeld, viewportRef, contentRef, actions,
  // ...every other field the hook currently returns, unchanged
}), [panX, panY, zoom, isPanning, spaceHeld, cmdHeld, actions]);
```

Use the ACTUAL field list from the hook's current return statement (found in the Read above) — do not guess field names; copy them exactly from the source.

- [ ] **Step 5: Wrap `DashboardCardLayer` in `React.memo`**

Same pattern at `DashboardCardLayer.tsx:362`:

```typescript
export default React.memo(DashboardCardLayer);
```

`DashboardCardLayer`'s props (interface at lines 32-68) include `zoom`, `panX`, `panY` as plain numbers passed directly from `DashboardCanvas` (lines 277-279 in `DashboardCanvas.tsx`: `zoom={canvas.zoom} panX={canvas.panX} panY={canvas.panY}`) — these DO change every rAF tick during a pan/zoom gesture by design, since the card layer's `transform` needs them... wait, re-check: the transform itself is applied on the PARENT `div` in `DashboardCanvas.tsx:255-260` (`transform: translate(...) scale(...)`), NOT inside `DashboardCardLayer`. Confirm what `DashboardCardLayer` actually uses `zoom`/`panX`/`panY` for internally:

Run: `grep -n "zoom\b\|panX\b\|panY\b" frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`

These three props are then forwarded to `DashboardViewCard`, `BrowserCard`, `NoteCard`, `ElementCard` (visible at lines 212-214, 241-243, 265-267 in the earlier read) — meaning `DashboardCardLayer` itself changes props (hence re-renders) on every pan/zoom tick REGARDLESS of `React.memo`, because `zoom`/`panX`/`panY` are genuinely different values each tick. `React.memo` on `DashboardCardLayer` will NOT stop this specific re-render — memoizing it only helps for re-renders caused by unrelated parent state changes (e.g. a sibling session updating). This is an important correction to the audit's finding: the memo is still worth adding for the "unrelated re-render" case, but the pan/zoom-frame re-render of `DashboardCardLayer`'s outer function body is inherent to passing live pan/zoom values to children, not fixable by memoizing this component alone.

Add the memo anyway (it is still a net improvement for the non-pan/zoom re-render case, e.g. session/card data changing on an unrelated dashboard) but do NOT claim it eliminates all per-frame re-renders — verify the actual remaining cost is now confined to the `Object.values(cards).map(...)`/`Object.entries(viewCards).map(...)` mapping work re-running each tick (cheap, since each mapped child is itself `React.memo`'d per the audit's "already good" notes) rather than any expensive computation inside `DashboardCardLayer`'s own body. Read the full component body again to confirm nothing expensive sits above the `.map()` calls (the `useAppSelector` calls at lines 108-110 and the `useEffect` at 112-114 are cheap and unaffected by pan/zoom).

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from the `React.memo` wraps or `shallowEqual` addition.

- [ ] **Step 7: Run the existing canvas/dashboard test suite**

Run: `cd frontend && npx vitest run frontend/src/app/pages/Dashboard --reporter=verbose`
Expected: all existing tests pass. Per project memory, canvas-element-cards tests exist and were at 16/16 passing as of the last merge — confirm that count still holds.

- [ ] **Step 8: Manual verification — pan/zoom smoothness**

Run: `cd frontend && npm run dev`

In the browser, with React DevTools' "Highlight updates when components render" enabled:
1. Open a dashboard with several agent cards.
2. Pan the canvas by dragging.
3. Confirm `DashboardCanvas` no longer highlights on every frame (or highlights far less than before) — some highlighting from `DashboardCardLayer` re-rendering with new `zoom`/`panX`/`panY` is expected and correct per Step 5's finding, but individual `AgentCard`/`BrowserCard` instances should NOT highlight during a pure pan (they read canvas state via the stable `getCanvasState()` callback, per the audit's "already good" notes).
4. Open a second dashboard in another window/tab if possible, or simulate a background session update (e.g. send a message from a different session) while watching the first dashboard — confirm it does NOT re-render.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelectors.ts frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx frontend/src/app/pages/Dashboard/hooks/interaction/useCanvasControls.ts
git commit -m "perf(frontend): memoize dashboard canvas components, shallowEqual sessions selector

DashboardCanvas and DashboardCardLayer had no React.memo, so any unrelated
session update anywhere in the app re-rendered the currently-viewed
canvas. Memoizing both (plus stabilizing useCanvasControls' return value)
confines re-renders to actual prop changes."
```

---

### Task 3: Memoize Minimap so it doesn't rebuild its layout on every pan/zoom frame

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/controls/Minimap.tsx:195` (export line)
- Test: `frontend/src/app/pages/Dashboard/controls/Minimap.test.tsx` (check existing location first)

**Context:** `Minimap`'s `layout` `useMemo` (lines 69-115) depends on `panX`/`panY`/`zoom`, which change every rAF tick during any pan/zoom/inertia gesture (per Task 2's investigation, these are genuinely live-changing values, not artifacts of missing memoization upstream). Since `Minimap` itself has no `React.memo`, its parent (`DashboardHeader`, via the `minimapProps` object built inline at `DashboardCanvas.tsx:202-213`) re-rendering also forces `Minimap` to re-run its full body — but the `layout` `useMemo` already correctly scopes recomputation to only when `panX`/`panY`/`zoom`/`allCards` actually change, so the real question is whether `DashboardHeader` re-renders `Minimap` with a fresh `minimapProps` object reference even when nothing inside it changed.

- [ ] **Step 1: Check how `minimapProps` reaches `Minimap`**

Run: `grep -n "minimapProps\|Minimap" frontend/src/app/pages/Dashboard/canvas/DashboardHeader.tsx`

Read the relevant section:

```
Read frontend/src/app/pages/Dashboard/canvas/DashboardHeader.tsx
```

Confirm whether `DashboardHeader` spreads `minimapProps` into individual props on `<Minimap .../>` (in which case `React.memo`'s shallow prop comparison works normally) or passes the whole object as a single prop (in which case the object literal built fresh at `DashboardCanvas.tsx:202-213` on every `DashboardCanvas` render would defeat memoization, since it's a new reference every time regardless of contents).

- [ ] **Step 2: If `minimapProps` is built as a fresh object literal every render, memoize it at the source**

If `DashboardCanvas.tsx:202-213`'s inline `minimapProps={{ panX: canvas.panX, panY: canvas.panY, ... }}` is passed as a single object prop, wrap it in `useMemo` right where it's constructed:

```typescript
const minimapProps = useMemo(() => ({
  panX: canvas.panX,
  panY: canvas.panY,
  zoom: canvas.zoom,
  viewportRef: canvas.viewportRef,
  cards,
  viewCards,
  browserCards,
  workflowCards,
  workflowsHub,
  elements,
}), [canvas.panX, canvas.panY, canvas.zoom, canvas.viewportRef, cards, viewCards, browserCards, workflowCards, workflowsHub, elements]);
```

Then reference `minimapProps` in the `<DashboardHeader minimapProps={minimapProps} .../>` call instead of the inline literal. NOTE: since `panX`/`panY`/`zoom` are IN this dependency array and DO change every rAF tick, this `useMemo` alone does not reduce how often `minimapProps` changes reference — it only prevents an EXTRA unnecessary reference change on renders where pan/zoom didn't move (e.g. a sibling session update). The real fix for the "recomputes on every rAF tick" complaint is Step 3.

- [ ] **Step 3: Wrap `Minimap` itself in `React.memo`**

Change `Minimap.tsx:195` from `export default Minimap;` to:

```typescript
export default React.memo(Minimap);
```

Given Step 2's finding that `panX`/`panY`/`zoom` genuinely change every tick during a gesture, `React.memo` will NOT stop `Minimap` from re-rendering during an active pan/zoom — this is correct behavior, since the minimap's viewport rectangle SHOULD track the real viewport live. What `React.memo` DOES fix: `Minimap` re-rendering when an UNRELATED prop changes (e.g. a session update elsewhere causing `DashboardCanvas` to re-render without pan/zoom changing) — combined with Task 2's fixes, this closes that path.

- [ ] **Step 4: Address the actual "layout recomputes every frame" cost directly — throttle the SVG rect rebuild**

Since panning genuinely changes `panX`/`panY` every frame and the minimap SHOULD visually track this, the real lever is reducing HOW OFTEN the minimap re-renders during a drag, not whether it re-renders at all (per the audit's own suggested fix: "throttle the displayed viewport rect... it doesn't need 60fps precision"). Add a throttle inside `Minimap` using a ref-based frame skip:

```typescript
import React, { useRef, useCallback, useMemo, useState, useEffect } from 'react';
```

Add state for the throttled pan/zoom values and an effect that updates them at a lower rate:

```typescript
const [throttled, setThrottled] = useState({ panX, panY, zoom });
const lastUpdateRef = useRef(0);
useEffect(() => {
  const now = performance.now();
  const MIN_INTERVAL_MS = 66; // ~15fps is plenty for a secondary viewport indicator
  if (now - lastUpdateRef.current >= MIN_INTERVAL_MS) {
    lastUpdateRef.current = now;
    setThrottled({ panX, panY, zoom });
  } else {
    const timeout = setTimeout(() => {
      lastUpdateRef.current = performance.now();
      setThrottled({ panX, panY, zoom });
    }, MIN_INTERVAL_MS - (now - lastUpdateRef.current));
    return () => clearTimeout(timeout);
  }
}, [panX, panY, zoom]);
```

Then change the `layout` `useMemo`'s dependency array and body (lines 69-115) to read `throttled.panX`/`throttled.panY`/`throttled.zoom` instead of the raw props everywhere they currently appear inside that memo. Do NOT change the raw `panX`/`panY`/`zoom` props used elsewhere in the component (e.g. if `allCards` or anything else legitimately needs the live value) — only the `layout` computation should use the throttled values, since that's the expensive per-frame recompute the audit flagged.

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Run existing tests**

Run: `cd frontend && npx vitest run frontend/src/app/pages/Dashboard/controls --reporter=verbose`
Expected: all pass. If no test file exists for `Minimap` yet, this step has nothing to run — proceed to Step 7's manual check instead of blocking on missing coverage (do not invent a new full test suite for this one component as part of a performance fix; that's out of scope).

- [ ] **Step 7: Manual verification**

Run: `cd frontend && npm run dev`

In the browser:
1. Open a dashboard with several cards spread across the canvas.
2. Drag-pan the canvas continuously for 2-3 seconds while watching the minimap's viewport rectangle.
3. Confirm the rectangle still tracks the pan smoothly (a ~66ms/15fps update rate should look continuous to the eye for a small secondary UI element, not choppy) — if it looks visibly stepped, lower `MIN_INTERVAL_MS` to 33 (30fps) and re-check.
4. With React DevTools "Highlight updates" on, confirm the highlight frequency on `Minimap` during a drag has visibly dropped compared to before the change (was every frame, now capped to the throttle interval).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/pages/Dashboard/controls/Minimap.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx
git commit -m "perf(frontend): memoize Minimap and throttle its layout recompute to ~15fps

Minimap rebuilt its full card-bounding-box scan and SVG rect list on
every pan/zoom animation frame. A secondary viewport indicator doesn't
need 60fps precision; throttling the layout recompute while keeping the
component itself memoized cuts this cost during the most latency-
sensitive interaction in the app."
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1-3 cover the three HIGH-impact frontend findings (bundle splitting, canvas/card-layer memoization, minimap throttling). The MEDIUM/LOW findings (PixelChart mousemove redraw, AgentChat height estimation cache, AppShell dict subscription, FileTreeItem memoization) are deliberately deferred to a follow-up plan — each is independent and lower-impact, and bundling them here would make this plan's tasks less atomic to review/revert individually.
- **Placeholder scan:** every step includes literal code, not descriptions. Task 2 Step 4 and Task 3 Step 1-2 include conditional "if X, do Y" branches gated on grep/read results the plan can't predict ahead of time — these are documented decision points with both outcomes' full code shown, not vague placeholders.
- **Type consistency:** `throttled` (Minimap), `minimapProps` (DashboardCanvas), and the `React.memo` wraps reference the same prop/field names used in the original component definitions read at the start of this plan.
- **Correction to the source audit:** Task 2 Step 5 and Task 3 Step 3 both explicitly note where `React.memo` alone does NOT achieve the audit's stated goal (stopping re-renders during active pan/zoom, since pan/zoom values are genuinely live) — the plan calls this out rather than silently overstating what the fix accomplishes, and supplies the additional throttling step needed to address the real per-frame cost.
