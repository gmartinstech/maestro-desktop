# Canvas Element Cards — T1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new persisted `elements` card collection to the dashboard canvas with a draggable, resizable, closable element card and a toolbar button that creates one — the skeleton every later ticket builds on.

**Architecture:** A new `Record<string, ElementPosition>` collection on `dashboardLayoutSlice`, wired through all fifteen layout touchpoints; an `ElementCard.tsx` component that copies `NoteCard`'s drag/resize machinery but `AgentCard`'s pan/zoom performance pattern (`getCanvasState` + the `maestro:canvas-pan-changed` listener, no `panX`/`panY` props); and a toolbar button cloned from Add Note. Because the frontend has no way to display a local file until the asset route lands (T2), T1's card renders a typed empty state — see "Deviation from the spec" below.

**Tech Stack:** React 18 + TypeScript, Redux Toolkit (`createSlice`, object-form reducers), MUI 7, `react-i18next`, Vitest (added by Task 1).

**Spec:** `docs/specs/2026-08-17-canvas-element-cards-design.md`

## Global Constraints

- **Never call `*.openswarm.com`.** Models go through provedor-ia (`https://llm.martinstech.net/v1`).
- **`npm run verify` must be green** before any task is considered done: frontend lint + build, Playwright golden e2e (needs a packaged app), backend pytest, callhome check. For frontend-only tasks, `cd frontend && npm run lint && npm run build` plus the new `npm test` is the practical per-task gate; run full `verify` before opening the PR.
- **Run backend tests with `MAESTRO_MOCK_AGENT` UNSET.** Baseline: 6 pre-existing failures, 1745 passing.
- **i18n: every user-visible string goes through `t('dashboard.toolbar.<camelCaseKey>')`**, and **both** `frontend/src/shared/i18n/en.json` and the pt-BR file must be updated **in the same commit**. A key present in one and missing in the other is a bug.
- **Small diffs, one ticket per branch.** T1 is frontend-only. Do not touch the backend, do not add a Pydantic model, do not extract a shared drag/resize hook.
- **No new persisted field may carry content bytes.** The whole layout is one JSON blob rewritten on a 500 ms debounce (spec C1).
- Retain LICENSE (© Haik Decie). Brand = Maestro Studio.

## Deviation from the spec, and why

The spec's T1 says "inline render of `kind=image`/`svg`/`file-preview` from an already-on-disk path." That is not implementable frontend-only: spec constraint **C8** establishes there is *no* working path today to show a local file in the renderer — no protocol handler in `electron/main.js`, no file-read bridge in `preload.js`, and `file://` subresources are blocked from the packaged renderer's `http://127.0.0.1` origin. The serve routes that exist open in text mode and 500 on a PNG.

So T1 ships the card **skeleton**: the collection, persistence, chrome, drag/resize, z-order, selection, close/reopen, toolbar creation, and a typed empty state ("Image — no asset yet"). The `asset_id` field exists in the record from day one but resolves to nothing until T2 lands the asset store and the binary serve route. This keeps T1 independently mergeable and honest; T2's first task is to make the same card render real content.

---

## File Structure

**Create:**
- `frontend/vitest.config.ts` — test runner config with the `@` alias
- `frontend/src/shared/state/dashboardLayoutSlice.test.ts` — reducer tests
- `frontend/src/app/pages/Dashboard/cards/ElementCard.tsx` — the card component

**Modify:**
- `frontend/package.json` — vitest devDep + `test` script
- `scripts/verify.mjs` — new `frontend-test` step
- `frontend/src/shared/state/dashboardLayoutSlice.ts` — the collection and its fifteen touchpoints
- `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx` — render the collection
- `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx` — thread the props
- `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts` — select the collection, expose the create handler
- `frontend/src/app/pages/Dashboard/DashboardToolbar.tsx` — the Add Element button
- `frontend/src/app/pages/Dashboard/geometry/contentBounds.ts` — count elements toward fit-to-view
- `frontend/src/app/pages/Dashboard/canvas/DashboardOverlays.tsx` + `controls/Minimap.tsx` — show elements on the minimap
- `frontend/src/shared/i18n/en.json` and the pt-BR locale file — toolbar strings

---

## Decisions locked here (the spec left these open)

- **`tidyLayout`: elements do NOT participate.** They mirror notes — the user parked them, tidy leaves them alone. Consequence, accepted: a tidy pass can reflow other cards on top of an element card, exactly as it can today with notes.
- **`computeContentBounds`: elements DO count.** Unlike notes (sticky annotations, deliberately excluded), an element card is content the user wants fit-to-view to frame.
- **Ctrl/Cmd+Shift+T reopen: elements DO participate**, via a new `ClosedCard` variant.

---

### Task 1: Frontend test harness

There is no frontend unit-test runner in this repo — `npm run verify` runs frontend lint + build, Playwright golden e2e against a *packaged* app, and backend pytest. TDD is mandatory for every following task, so the harness comes first. This task is complete when a test of **existing** behaviour passes; it adds no product code.

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/shared/state/dashboardLayoutSlice.test.ts`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (run from `frontend/`) executes Vitest once and exits; a `frontend-test` step in `npm run verify`.

- [ ] **Step 1: Add Vitest to the frontend devDependencies**

```bash
cd frontend && npm install --save-dev vitest@^2.1.0
```

- [ ] **Step 2: Add the test script**

In `frontend/package.json`, inside `"scripts"`, after `"clean"`:

```json
    "test": "vitest run"
```

- [ ] **Step 3: Create the Vitest config**

Create `frontend/vitest.config.ts`. The `@` alias must match `webpack.config.js:55-57` and `tsconfig.json`'s `paths`, or every `@/shared/...` import fails to resolve:

```ts
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Node environment is enough: these are pure reducer tests, no DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

Note `frontend/tsconfig.json` already excludes `**/*.test.ts`, so test files will not enter the production typecheck or build.

- [ ] **Step 4: Write a test of existing behaviour, to prove the harness works**

Create `frontend/src/shared/state/dashboardLayoutSlice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import reducer, { addNote } from '@/shared/state/dashboardLayoutSlice';

describe('dashboardLayout harness', () => {
  it('addNote puts a note into the notes collection', () => {
    const state = reducer(undefined, addNote({ expandedSessionIds: [] }));
    const notes = Object.values(state.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0].width).toBeGreaterThan(0);
    expect(notes[0].height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd frontend && npm test`
Expected: PASS, 1 test. If it fails on module resolution, the alias in Step 3 is wrong. If `addNote`'s payload shape differs, read `dashboardLayoutSlice.ts`'s `addNote` reducer and match it — do not change the reducer.

- [ ] **Step 6: Add the step to verify.mjs**

In `scripts/verify.mjs`, in the `steps` array, add a line immediately after the `lint` entry:

```js
  ['frontend-test', 'cd frontend && npm test'],
```

- [ ] **Step 7: Confirm the new step runs**

Run: `node scripts/verify.mjs`
Expected: the `frontend-test` step appears and passes. Other steps may fail for pre-existing reasons (golden needs a packaged app) — that is fine here; you are only confirming your step is wired in and green.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/shared/state/dashboardLayoutSlice.test.ts scripts/verify.mjs
git commit -m "test(frontend): add vitest harness and wire it into verify"
```

---

### Task 2: The `elements` collection — types, state, and the save/load round-trip

**Files:**
- Modify: `frontend/src/shared/state/dashboardLayoutSlice.ts`
- Test: `frontend/src/shared/state/dashboardLayoutSlice.test.ts`

**Interfaces:**
- Consumes: the Vitest harness from Task 1.
- Produces:
  - `export type ElementKind = 'image' | 'svg' | 'file';`
  - `export interface ElementPosition { element_id: string; kind: ElementKind; asset_id: string; title: string; x: number; y: number; width: number; height: number; zOrder: number; created_by_session_id?: string | null; }`
  - `export const DEFAULT_ELEMENT_W = 320;` / `export const DEFAULT_ELEMENT_H = 240;`
  - `state.elements: Record<string, ElementPosition>` and `state.pendingFocusElementId: string | null`
  - `CardType` gains `'element'`; `LayoutPayload` gains `elements`

- [ ] **Step 1: Write the failing round-trip test**

Append to `frontend/src/shared/state/dashboardLayoutSlice.test.ts`:

```ts
import reducerDefault, { fetchLayout, type ElementPosition } from '@/shared/state/dashboardLayoutSlice';

const anElement = (id: string): ElementPosition => ({
  element_id: id,
  kind: 'image',
  asset_id: '',
  title: 'Untitled',
  x: 10, y: 20, width: 320, height: 240,
  zOrder: 3,
});

describe('elements collection', () => {
  it('starts empty', () => {
    const state = reducerDefault(undefined, { type: '@@INIT' });
    expect(state.elements).toEqual({});
  });

  it('a fresh load replaces elements from the payload', () => {
    const payload = {
      cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
      workflowsHub: null, notes: {}, expandedSessionIds: [],
      elements: { e1: anElement('e1') },
    };
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload,
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.elements.e1.title).toBe('Untitled');
  });

  it('a fresh load with no elements key does not crash (old saved layouts)', () => {
    const payload = {
      cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
      workflowsHub: null, notes: {}, expandedSessionIds: [],
    } as never;
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload,
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.elements).toEqual({});
  });

  it('a reconnect refetch merges without clobbering a live element', () => {
    const withLive = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: { ...anElement('e1'), x: 999 } },
      },
      meta: { arg: { dashboardId: 'd1' } },
    });
    const merged = reducerDefault(withLive, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: anElement('e1'), e2: anElement('e2') },
      },
      meta: { arg: { dashboardId: 'd1', isReconnect: true } },
    });
    expect(merged.elements.e1.x).toBe(999);   // live position preserved
    expect(merged.elements.e2).toBeDefined(); // missing card recovered
  });

  it('rescans element zOrder when computing nextZOrder', () => {
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: { ...anElement('e1'), zOrder: 7 } },
      },
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.nextZOrder).toBe(8);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npm test`
Expected: FAIL — `ElementPosition` is not exported, and `state.elements` is undefined.

- [ ] **Step 3: Add the types**

In `dashboardLayoutSlice.ts`, extend the `CardType` union at line 34:

```ts
export type CardType = 'agent' | 'view' | 'browser' | 'note' | 'workflow' | 'workflows-hub' | 'workflows-monitor' | 'element';
```

After the `NotePosition` block (around line 120), add:

```ts
export type ElementKind = 'image' | 'svg' | 'file';

// A lightweight canvas element (image / svg / dropped file). Deliberately primitives only:
// the whole layout is one JSON blob PUT on a 500ms debounce, so content bytes live as files
// in the dashboard assets dir (T2) and are referenced by asset_id, never inlined here.
export interface ElementPosition {
  element_id: string;
  kind: ElementKind;
  asset_id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrder: number;
  created_by_session_id?: string | null;
}

export const DEFAULT_ELEMENT_W = 320;
export const DEFAULT_ELEMENT_H = 240;
```

Add the reopen-stack variant to the `ClosedCard` union (line ~122), after the `note` variant:

```ts
  | { uid: string; kind: 'element'; closedAt: number; element: ElementPosition }
```

- [ ] **Step 4: Add the state fields**

In `DashboardLayoutState` (line ~135), after `notes: Record<string, NotePosition>;`:

```ts
  elements: Record<string, ElementPosition>;
```

and after `pendingFocusNoteId: string | null;`:

```ts
  pendingFocusElementId: string | null;
```

In `initialState` (line ~185), after `notes: {},` add `elements: {},`; after `pendingFocusNoteId: null,` add `pendingFocusElementId: null,`.

- [ ] **Step 5: Add the wire plumbing**

In `LayoutPayload` (line ~215), after `notes: Record<string, NotePosition>;`:

```ts
  elements: Record<string, ElementPosition>;
```

In the `fetchLayout` return object (line ~250), after the `notes` line:

```ts
      elements: (layout.elements ?? {}) as Record<string, ElementPosition>,
```

Keep the `?? {}` — that default is what lets an old saved layout with no `elements` key load without crashing.

In `saveLayout`'s PUT body (line ~266), after `notes: payload.notes,`:

```ts
          elements: payload.elements,
```

`SaveLayoutPayload extends LayoutPayload`, so **every existing `saveLayout` call site must now pass `elements`** or TypeScript breaks. Find them with `grep -rn "saveLayout(" frontend/src` and add `elements` from `state.dashboardLayout.elements` at each.

- [ ] **Step 6: Add the three edits inside `fetchLayout.fulfilled`**

In the **replace** branch (line ~1585), after `state.notes = action.payload.notes || {};`:

```ts
          state.elements = action.payload.elements || {};
```

In the **reconnect-merge** branch (line ~1609), after the `addMissingCards(state.notes, ...)` line:

```ts
          addMissingCards(state.elements, action.payload.elements || {}, occupied);
```

(`addMissingCards` is generic over `{x,y,width,height}`, so `ElementPosition` satisfies it unchanged.)

In the `maxZ` rescan, before `state.nextZOrder = maxZ + 1;`:

```ts
        for (const e of Object.values(state.elements)) {
          if (!e.zOrder) e.zOrder = 0;
          if (e.zOrder > maxZ) maxZ = e.zOrder;
        }
```

- [ ] **Step 7: Wipe elements on dashboard switch**

In `resetLayout` (line ~1552), alongside `state.cards = {};` and its siblings, add:

```ts
      state.elements = {};
```

- [ ] **Step 8: Run the tests**

Run: `cd frontend && npm test`
Expected: PASS, all five element tests plus the harness test.

- [ ] **Step 9: Typecheck and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean. A failure here is almost certainly a `saveLayout` call site from Step 5 that still omits `elements`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/shared/state/dashboardLayoutSlice.ts frontend/src/shared/state/dashboardLayoutSlice.test.ts
git commit -m "feat(canvas): add the elements collection with save/load round-trip"
```

---

### Task 3: Element reducers — add, move, resize, remove, z-order, collision

**Files:**
- Modify: `frontend/src/shared/state/dashboardLayoutSlice.ts`
- Test: `frontend/src/shared/state/dashboardLayoutSlice.test.ts`

**Interfaces:**
- Consumes: `ElementPosition`, `DEFAULT_ELEMENT_W/H`, `state.elements` from Task 2.
- Produces these action creators, used by Tasks 4 and 5:
  - `addElement({ kind, title, expandedSessionIds, x?, y? })` → places a new element, sets `pendingFocusElementId`
  - `setElementPosition({ elementId, x, y })`
  - `setElementSize({ elementId, width, height })`
  - `removeElement({ elementId })`
  - `bringToFront({ id, type: 'element' })` now works for elements
  - `recordClosedCard` / `restoreClosedCard` handle the `'element'` kind

- [ ] **Step 1: Write the failing tests**

Append to `dashboardLayoutSlice.test.ts`:

```ts
import reducerEl, {
  addElement, setElementPosition, setElementSize, removeElement, bringToFront, addNote as addNoteEl,
} from '@/shared/state/dashboardLayoutSlice';

describe('element reducers', () => {
  it('addElement creates a card with the default size and a title', () => {
    const state = reducerEl(undefined, addElement({ kind: 'image', title: 'Diagram', expandedSessionIds: [] }));
    const els = Object.values(state.elements);
    expect(els).toHaveLength(1);
    expect(els[0].kind).toBe('image');
    expect(els[0].title).toBe('Diagram');
    expect(els[0].width).toBe(320);
    expect(els[0].height).toBe(240);
    expect(state.pendingFocusElementId).toBe(els[0].element_id);
  });

  it('a second element does not land on top of the first', () => {
    const one = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const two = reducerEl(one, addElement({ kind: 'image', title: 'B', expandedSessionIds: [] }));
    const [a, b] = Object.values(two.elements);
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps).toBe(false);
  });

  it('an element does not land on top of an existing note', () => {
    const withNote = reducerEl(undefined, addNoteEl({ expandedSessionIds: [] }));
    const n = Object.values(withNote.notes)[0];
    const withEl = reducerEl(withNote, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const e = Object.values(withEl.elements)[0];
    const overlaps = n.x < e.x + e.width && n.x + n.width > e.x && n.y < e.y + e.height && n.y + n.height > e.y;
    expect(overlaps).toBe(false);
  });

  it('setElementPosition moves it', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, setElementPosition({ elementId: id, x: 42, y: 84 }));
    expect(s1.elements[id].x).toBe(42);
    expect(s1.elements[id].y).toBe(84);
  });

  it('setElementSize clamps to the minimum', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, setElementSize({ elementId: id, width: 10, height: 10 }));
    expect(s1.elements[id].width).toBe(160);
    expect(s1.elements[id].height).toBe(120);
  });

  it('removeElement deletes it', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, removeElement({ elementId: id }));
    expect(s1.elements[id]).toBeUndefined();
  });

  it('bringToFront raises an element above every other card', () => {
    const s0 = reducerEl(undefined, addNoteEl({ expandedSessionIds: [] }));
    const s1 = reducerEl(s0, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const noteId = Object.values(s1.notes)[0].note_id;
    const elId = Object.values(s1.elements)[0].element_id;
    const s2 = reducerEl(s1, bringToFront({ id: noteId, type: 'note' }));
    const s3 = reducerEl(s2, bringToFront({ id: elId, type: 'element' }));
    expect(s3.elements[elId].zOrder).toBeGreaterThan(s3.notes[noteId].zOrder);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npm test`
Expected: FAIL — `addElement` is not exported.

- [ ] **Step 3: Teach the collision system about elements**

In `collectOccupiedRects` (line ~288), after the `state.notes` loop and before `return rects;`:

```ts
  for (const e of Object.values(state.elements)) {
    if (exclude?.type === 'element' && exclude.id === e.element_id) continue;
    rects.push({ x: e.x, y: e.y, w: e.width, h: e.height });
  }
```

This one function is the single collision source of truth for `findOpenGridCell`, `findOpenSpotNear`, `placeBesideCard`, `placeBelowCard`, `placeInParentColumn` and `computeSpawnPosition`. Omit it and every future card spawn lands on top of element cards.

- [ ] **Step 4: Add the four reducers**

In the object-form `reducers: { ... }` block, next to the note reducers:

```ts
    addElement(
      state,
      action: PayloadAction<{
        kind: ElementKind;
        title: string;
        expandedSessionIds: string[];
        x?: number;
        y?: number;
      }>,
    ) {
      const { kind, title, expandedSessionIds, x, y } = action.payload;
      const element_id = `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const occupied = collectOccupiedRects(state, expandedSessionIds);
      const spot = typeof x === 'number' && typeof y === 'number'
        ? { x, y }
        : findOpenGridCell(occupied, DEFAULT_ELEMENT_W, DEFAULT_ELEMENT_H);
      state.elements[element_id] = {
        element_id,
        kind,
        asset_id: '',
        title,
        x: spot.x,
        y: spot.y,
        width: DEFAULT_ELEMENT_W,
        height: DEFAULT_ELEMENT_H,
        zOrder: state.nextZOrder++,
        created_by_session_id: null,
      };
      state.pendingFocusElementId = element_id;
    },

    setElementPosition(state, action: PayloadAction<{ elementId: string; x: number; y: number }>) {
      const el = state.elements[action.payload.elementId];
      if (!el) return;
      el.x = action.payload.x;
      el.y = action.payload.y;
    },

    setElementSize(state, action: PayloadAction<{ elementId: string; width: number; height: number }>) {
      const el = state.elements[action.payload.elementId];
      if (!el) return;
      el.width = Math.max(MIN_ELEMENT_W, action.payload.width);
      el.height = Math.max(MIN_ELEMENT_H, action.payload.height);
    },

    removeElement(state, action: PayloadAction<{ elementId: string }>) {
      delete state.elements[action.payload.elementId];
      if (state.pendingFocusElementId === action.payload.elementId) {
        state.pendingFocusElementId = null;
      }
    },
```

Add the minimum constants next to `DEFAULT_ELEMENT_W/H`:

```ts
export const MIN_ELEMENT_W = 160;
export const MIN_ELEMENT_H = 120;
```

Verify `findOpenGridCell`'s exact signature in the file before calling it and match it — if it takes `(occupied, w, h)` in a different order, use the file's order, not this snippet's.

- [ ] **Step 5: Add the three `bringToFront` lines**

All three are mandatory. In the `maxZ` tally, alongside the notes line:

```ts
      for (const e of Object.values(state.elements)) tally(e.zOrder);
```

In the `currentZ` chain, **before** the terminal `else`:

```ts
      else if (type === 'element') currentZ = state.elements[id]?.zOrder ?? 0;
```

Without this an element falls into the terminal `else`, is read as a browser card, `currentZ` is always 0, and every click mutates state — the exact bug the short-circuit comment in that reducer describes.

In the write chain, matching branch:

```ts
      else if (type === 'element') { const el = state.elements[id]; if (el) el.zOrder = z; }
```

- [ ] **Step 6: Wire the reopen stack**

In `recordClosedCard`, beside the `'note'` branch:

```ts
      } else if (payload.type === 'element') {
        const el = state.elements[payload.id];
        if (el) {
          state.recentlyClosed.push({
            uid: `${payload.id}-${Date.now()}`,
            kind: 'element',
            closedAt: Date.now(),
            element: { ...el },
          });
        }
      }
```

In `restoreClosedCard`, the matching branch:

```ts
      } else if (entry.kind === 'element') {
        state.elements[entry.element.element_id] = {
          ...entry.element,
          zOrder: state.nextZOrder++,
        };
        state.pendingFocusElementId = entry.element.element_id;
      }
```

Read the existing `'note'` branches first and match their exact local variable names, payload shape, and the `RECENTLY_CLOSED_CAP` trim that follows the push — the snippets above show the shape, not necessarily this file's identifiers.

- [ ] **Step 7: Export the actions**

Add `addElement, setElementPosition, setElementSize, removeElement` to the `export const { ... } = dashboardLayoutSlice.actions;` block at the bottom of the file.

- [ ] **Step 8: Run the tests**

Run: `cd frontend && npm test`
Expected: PASS, all seven element-reducer tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/shared/state/dashboardLayoutSlice.ts frontend/src/shared/state/dashboardLayoutSlice.test.ts
git commit -m "feat(canvas): element card reducers, collision and z-order"
```

---

### Task 4: The `ElementCard` component

Copy `NoteCard.tsx` as the structural template — it is the smallest card and has the full drag/resize machinery — but make **one deliberate substitution**: take `getCanvasState` instead of `panX`/`panY`/`zoom` props. `NoteCard`, `DashboardViewCard` and `BrowserCard` all take pan/zoom as props, which breaks `React.memo` equality on every rAF pan frame and re-runs every card's render body. `AgentCard` already fixed this; its comment at `useDashboardController.ts:99` reads *"Stable getter, AgentCards read pan/zoom on demand during drag math."* Element cards are created in bulk, so they must follow `AgentCard`.

**Files:**
- Create: `frontend/src/app/pages/Dashboard/cards/ElementCard.tsx`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`
- Modify: `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`

**Interfaces:**
- Consumes: `setElementPosition`, `setElementSize`, `removeElement`, `recordClosedCard` from Task 3; `getCanvasState` from `useDashboardController.ts:97-100`.
- Produces: `ElementCard` (default export) with props
  `{ elementId, kind, title, cardX, cardY, cardWidth, cardHeight, cardZOrder, cmdHeld, isSelected, isHighlighted, multiDragDelta, getCanvasState, onCardSelect, onDragStart, onDragMove, onDragEnd, onBringToFront }`.

  `asset_id` is deliberately **not** a prop in T1: nothing can render it yet (spec C8), and an unused destructured prop trips the lint gate. T2 adds it together with the renderer that consumes it.

- [ ] **Step 1: Create the component by copying NoteCard**

```bash
cp frontend/src/app/pages/Dashboard/cards/NoteCard.tsx frontend/src/app/pages/Dashboard/cards/ElementCard.tsx
```

- [ ] **Step 2: Rename the shell**

In `ElementCard.tsx`: rename the component and its default export to `ElementCard`; rename every `noteId` to `elementId`; replace the `NoteColor` import and the `NOTE_PALETTE` constant with nothing (element cards use theme tokens, not the sticky palette); swap the slice imports to `setElementPosition`, `setElementSize`, `removeElement`. Set `MIN_W = 160` and `MIN_H = 120` to match `MIN_ELEMENT_W/H`. Keep `EDGE_THICKNESS`, `CORNER_SIZE`, `HEADER_H`, `CURSOR_MAP` and `HANDLE_DEFS` verbatim.

- [ ] **Step 3: Make the performance substitution — delete the pan/zoom props**

In the props interface, **remove** `zoom`, `panX`, `panY` and **add**:

```ts
  getCanvasState: () => { panX: number; panY: number; zoom: number };
```

Then delete these four lines (`NoteCard.tsx:94-97`):

```ts
  const panRef = useRef({ panX, panY });
  panRef.current = { panX, panY };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
```

Everywhere the copied code reads `panRef.current.panX` / `panRef.current.panY` / `zoomRef.current`, read the getter once at the top of that callback instead. `handleDragPointerDown` becomes:

```ts
  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cs = getCanvasState();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: cardX, origY: cardY,
      startPanX: cs.panX, startPanY: cs.panY,
    };
    lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    didDrag.current = false;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onDragStart?.(elementId, 'element');
  }, [cardX, cardY, elementId, onDragStart, getCanvasState]);
```

and `recomputeDragPos` becomes:

```ts
  const recomputeDragPos = useCallback(() => {
    const ds = dragState.current;
    if (!ds || !didDrag.current) return;
    const { clientX, clientY } = lastPointerRef.current;
    const cs = getCanvasState();
    const rawDx = clientX - ds.startX;
    const rawDy = clientY - ds.startY;
    const z = cs.zoom;
    const panDx = (cs.panX - ds.startPanX) / z;
    const panDy = (cs.panY - ds.startPanY) / z;
    const dx = rawDx / z - panDx;
    const dy = rawDy / z - panDy;
    setLocalDragPos({ x: ds.origX + dx, y: ds.origY + dy });
    onDragMove?.(dx, dy, clientX, clientY);
  }, [onDragMove, getCanvasState]);
```

- [ ] **Step 4: Replace the pan effect with the event listener**

Delete NoteCard's copied effect:

```ts
  useEffect(() => {
    if (isDragging && didDrag.current) recomputeDragPos();
  }, [panX, panY, isDragging, recomputeDragPos]);
```

It cannot work — there are no `panX`/`panY` props any more. Replace it with `AgentCard.tsx:493-502` verbatim:

```ts
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

The emitter already exists at `hooks/interaction/useCardDrag.ts:37-42` and needs no change. Apply the same `getCanvasState()` substitution inside the copied resize handlers (`computeResize` reads zoom).

- [ ] **Step 5: Replace the note body with the typed empty state**

Replace the textarea body with a placeholder that names the kind. Real rendering lands in T2 with the asset route:

```tsx
      <Box
        sx={{
          position: 'absolute', inset: `${HEADER_H}px 0 0 0`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 0.5,
          color: c.text.muted, fontSize: '0.75rem', userSelect: 'none',
        }}
      >
        <Box sx={{ fontWeight: 600 }}>{title}</Box>
        <Box sx={{ opacity: 0.7 }}>{t('dashboard.element.noAsset', { kind })}</Box>
      </Box>
```

Keep the copied close button, but have it dispatch `recordClosedCard` before `removeElement`, exactly as `NoteCard.tsx:242-246` does for notes. Drop the palette button.

- [ ] **Step 6: Render the collection in the card layer**

In `DashboardCardLayer.tsx`: import `ElementCard` and `ElementPosition`; add `elements: Record<string, ElementPosition>;` and `getCanvasState: () => { panX: number; panY: number; zoom: number };` to `DashboardCardLayerProps`; add both to the destructure in the same order. Then, after the notes `.map` block (line ~252-277) and before the `{workflowsHub && ...}` block:

```tsx
      {Object.values(elements).map((el) => (
        <ElementCard
          key={`element-${el.element_id}`}
          elementId={el.element_id}
          kind={el.kind}
          title={el.title}
          cardX={el.x}
          cardY={el.y}
          cardWidth={el.width}
          cardHeight={el.height}
          cardZOrder={el.zOrder ?? 0}
          cmdHeld={cmdHeld}
          getCanvasState={getCanvasState}
          isSelected={selection.isSelected(el.element_id)}
          isHighlighted={highlightedCardId === el.element_id}
          multiDragDelta={selection.isSelected(el.element_id) ? multiDragDelta : null}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onBringToFront={onBringToFront}
        />
      ))}
```

Note `multiDragDelta` is **gated** on selection here, matching `AgentCard`'s call site — notes pass it ungated, which is the older pattern.

- [ ] **Step 7: Thread the props through DashboardCanvas**

Three edits in `DashboardCanvas.tsx`: add `elements: Record<string, ElementPosition>;` to `DashboardCanvasProps`; add `elements` to the destructure; forward `elements={elements}` in the `<DashboardCardLayer ... />` JSX (`getCanvasState` is already declared, destructured and forwarded there at lines 64/127/269 — verify, do not duplicate).

In `useDashboardController.ts`, select the collection alongside the others and include `elements` in the returned object. `Dashboard.tsx` spreads the controller into `<DashboardCanvas {...controller} />`, so no edit is needed there.

- [ ] **Step 8: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 9: Manual check in the running app**

Launch the app, open a dashboard, and — until Task 5 adds the button — create one from the devtools console:

```js
window.__REDUX_STORE__ ?? 'no store exposed'  // if absent, skip to Task 5 and verify there
```

If the store is not exposed, defer this check to Task 5 Step 6 and note that in the commit message. Do not add a store-exposing debug hook to ship.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/ElementCard.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCardLayer.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts
git commit -m "feat(canvas): ElementCard component on the AgentCard pan/zoom pattern"
```

---

### Task 5: Toolbar button and i18n

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/DashboardToolbar.tsx`
- Modify: `frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts`
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: the pt-BR locale file in `frontend/src/shared/i18n/`

**Interfaces:**
- Consumes: `addElement` from Task 3.
- Produces: `onAddElement: () => void` on `DashboardToolbarProps`.

- [ ] **Step 1: Add the i18n keys to English**

In `frontend/src/shared/i18n/en.json`, under `dashboard.toolbar`, beside the existing `addNote`/`addNoteSub`:

```json
      "addElement": "Add element",
      "addElementSub": "Image, diagram or file",
```

and under a new `dashboard.element` block:

```json
      "noAsset": "No {{kind}} attached yet",
```

- [ ] **Step 2: Add the same keys to pt-BR**

In the pt-BR locale file, same paths:

```json
      "addElement": "Adicionar elemento",
      "addElementSub": "Imagem, diagrama ou arquivo",
```

```json
      "noAsset": "Nenhum {{kind}} anexado ainda",
```

Both files change in **this** commit. Find the pt-BR filename with `ls frontend/src/shared/i18n/`.

- [ ] **Step 3: Add the toolbar callback**

In `DashboardToolbar.tsx`: add `onAddElement: () => void;` to the props interface beside `onAddNote`, and add `onAddElement` to the `forwardRef` destructure list.

- [ ] **Step 4: Add the button**

Clone the Add Note `WarmTooltip` + `Box` unit (`DashboardToolbar.tsx:765-798`) immediately after it, with `t('dashboard.toolbar.addElement')` / `t('dashboard.toolbar.addElementSub')`, an `aria-label` of `t('dashboard.toolbar.addElement')`, `onClick={onAddElement}`, and a distinct MUI icon (`ImageOutlinedIcon`).

The `popIn(n)` index matters: current order is addApp=1, browser=2, workflows=3, addNote=4, history=5. Inserting after addNote makes the new button `popIn(5)` and **history must be renumbered to `popIn(6)`**. Miss this and two buttons animate in on the same beat.

- [ ] **Step 5: Wire the handler**

In `useDashboardController.ts`, add and return:

```ts
  const handleAddElement = useCallback(() => {
    dispatch(addElement({ kind: 'image', title: 'Untitled', expandedSessionIds }));
  }, [dispatch, expandedSessionIds]);
```

Pass it to the toolbar as `onAddElement` wherever `onAddNote` is passed.

- [ ] **Step 6: Verify by hand in the running app**

Launch the app and confirm, in order: the button appears with its tooltip; clicking it creates a card that does not overlap anything; the card drags smoothly (including while edge-panning); resize clamps at 160×120; close removes it; Ctrl/Cmd+Shift+T brings it back; reload restores it at the same position; switching dashboards and back does not leak it into the other dashboard.

- [ ] **Step 7: Lint, build, test**

Run: `cd frontend && npm run lint && npm run build && npm test`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/pages/Dashboard/DashboardToolbar.tsx frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts frontend/src/shared/i18n
git commit -m "feat(canvas): add-element toolbar button with en and pt-BR strings"
```

---

### Task 6: Fit-to-view and minimap

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/geometry/contentBounds.ts`
- Modify: `frontend/src/app/pages/Dashboard/controls/Minimap.tsx`
- Modify: `frontend/src/app/pages/Dashboard/canvas/DashboardOverlays.tsx`
- Test: `frontend/src/app/pages/Dashboard/geometry/contentBounds.test.ts` (create)

**Interfaces:**
- Consumes: `ElementPosition` from Task 2.
- Produces: `computeContentBounds(cards, viewCards, browserCards, workflowCards?, workflowsHub?, elements?)` — a 6th positional optional parameter.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/pages/Dashboard/geometry/contentBounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeContentBounds } from '@/app/pages/Dashboard/geometry/contentBounds';

describe('computeContentBounds', () => {
  it('includes element cards in the bounding box', () => {
    const bounds = computeContentBounds({}, {}, {}, {}, null, {
      e1: {
        element_id: 'e1', kind: 'image', asset_id: '', title: 'A',
        x: 100, y: 200, width: 300, height: 400, zOrder: 1,
      },
    });
    expect(bounds).toEqual({ minX: 100, minY: 200, maxX: 400, maxY: 600 });
  });

  it('returns undefined for a genuinely empty canvas', () => {
    expect(computeContentBounds({}, {}, {}, {}, null, {})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npm test`
Expected: FAIL — `computeContentBounds` takes only five parameters.

- [ ] **Step 3: Extend computeContentBounds**

Import `ElementPosition` in `contentBounds.ts`, add the 6th parameter with a default, and add the spread line to `allRects`:

```ts
  elements: Record<string, ElementPosition> = {},
```

```ts
    ...Object.values(elements).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height })),
```

Update the file's header comment — it currently says notes are intentionally excluded; add that elements are included, and why (they are content; notes are annotations).

- [ ] **Step 4: Update every call site**

Run `grep -rn "computeContentBounds(" frontend/src` and pass `elements` at each. The main one is the `useMemo` in `useDashboardController.ts:66-70`; add `elements` to its dependency array too, or fit-to-view will use a stale box.

- [ ] **Step 5: Run the test**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 6: Add elements to the minimap**

In `Minimap.tsx`: add `elements: Record<string, ElementPosition>;` to `MinimapProps` and the destructure; add `'element'` to `CardRect['type']`; add a push loop in the `allCards` `useMemo` plus `elements` in its dependency array; and add a `case 'element':` to `typeColor` returning a distinct token colour.

The `typeColor` switch has **no default** — a missing case returns `undefined` and the rects render silently unfilled rather than erroring, so this is easy to miss.

Thread the prop `useDashboardController` → `DashboardCanvas` → `DashboardOverlays` → `Minimap`.

- [ ] **Step 7: Verify by hand**

Launch the app, create two element cards far apart, press fit-to-view, and confirm both are framed and both appear as filled rects on the minimap.

- [ ] **Step 8: Full verify**

Run: `npm run verify`
Expected: green. If `golden` fails because no packaged app exists, build it first (`pwsh scripts\build-app-win.ps1`) — a stale or missing package makes that step meaningless, not passable.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/pages/Dashboard/geometry/contentBounds.ts frontend/src/app/pages/Dashboard/geometry/contentBounds.test.ts frontend/src/app/pages/Dashboard/controls/Minimap.tsx frontend/src/app/pages/Dashboard/canvas/DashboardOverlays.tsx frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts
git commit -m "feat(canvas): element cards count toward fit-to-view and the minimap"
```

---

## Touchpoint checklist

Tick every line before opening the PR. None of these are exhaustiveness-checked by the compiler — a missed one fails silently at runtime.

- [ ] `CardType` union gains `'element'`
- [ ] `DashboardLayoutState.elements` + `pendingFocusElementId`
- [ ] `initialState` — both fields
- [ ] `LayoutPayload.elements`
- [ ] `fetchLayout` return — `(layout.elements ?? {})`
- [ ] `saveLayout` PUT body — and every call site
- [ ] `fetchLayout.fulfilled` **replace** branch
- [ ] `fetchLayout.fulfilled` **reconnect-merge** branch
- [ ] `fetchLayout.fulfilled` `maxZ` rescan loop
- [ ] `collectOccupiedRects`
- [ ] `bringToFront` — tally, `currentZ` chain, write chain (three lines)
- [ ] `resetLayout`
- [ ] `recordClosedCard` / `restoreClosedCard`
- [ ] `tidyLayout` — **deliberately not touched** (mirrors notes; confirm this is a conscious skip)
- [ ] `computeContentBounds` + call sites + `useMemo` deps
- [ ] `Minimap` — prop, `CardRect` type, push loop, deps, `typeColor` case
- [ ] `DashboardCardLayer` — props, destructure, render block
- [ ] `DashboardCanvas` — props, destructure, forward
- [ ] `DashboardOverlays` — minimap threading
- [ ] i18n — **both** en and pt-BR

---

## Follow-on tickets (not this branch)

- **T2** — asset store, binary serve route, drag-and-drop/paste; makes `ElementCard` render real content.
- **T3** — agent-facing MCP tool, create endpoint, broadcast, built-in skill, provenance chrome.
- **T4** — `kind='html'` static tier (host-authored `srcdoc`, `sandbox=""`), then mermaid.
- **Separate bugfixes** — `sanitizeSvg.ts` style-attribute bypass; `check-callhome.mjs` scanning `frontend/build` instead of `frontend/dist`; `zOrder` dropped by the nested Pydantic card models.
