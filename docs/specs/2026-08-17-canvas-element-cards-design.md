# Canvas Element Cards — design

**Date:** 2026-08-17
**Status:** approved (design); implementation split into four tickets
**Author:** brainstormed with the user; integration points and risks verified by a 7-agent recon + adversarial critique pass over the repo.

---

## 1. What we are building

Freeform-style **element cards** on the Maestro dashboard canvas: lightweight, no-process, no-port cards holding an image, a dropped file, an SVG/diagram, or a block of static HTML.

Three creation paths, all landing on the same card type:

1. **Agent-invokable** — a running agent calls an MCP tool mid-turn ("put this diagram on the canvas") and the card appears next to its own agent card.
2. **Drag-and-drop / paste** — the user drops an image, PDF, or file onto the canvas, or pastes an image/SVG.
3. **Toolbar Add menu** — an explicit `+` menu on the dashboard toolbar.

### Why this is not App Builder

`CreateApp` (`backend/apps/outputs/outputs.py:260`) seeds a full Vite workspace: `shutil.copytree` of the webapp template, `link_node_modules`, `find_free_port`, a `run.sh` dev server, plus runtime log forwarding and an orphan-recovery path. That is the right machinery for an interactive app and absurd overhead for "drop a diagram on the canvas." The gap this fills is the **cheap** option. If the element card ever grows a process, a port, or a script engine, it has become App Builder and should be deleted in favour of it.

### Explicit non-goals

- **No script execution.** Element cards never run JavaScript. Interactive or script-bearing content routes to `CreateApp`.
- **No `kind=markdown`.** `NotePosition` already persists free text, `NoteCard.tsx` already has drag/resize/close wired, and `react-markdown ^10.1.0` + `remark-gfm ^4.0.1` are already dependencies with `WindowedMarkdown.tsx` rendering markdown today. Rendered markdown on the canvas is a `render?: 'plain' | 'markdown'` flag on `NotePosition` plus a toggle in `NoteCard` — a ~40-line diff, filed separately. Do not create a second text-bearing persisted collection.
- **No `useCardDragResize` extraction.** Drag/resize is duplicated verbatim across `AgentCard.tsx` (1242 lines), `BrowserCard.tsx` (1635), `DashboardViewCard.tsx` (925), `NoteCard.tsx` (429) and `WorkflowsAppCard.tsx`. Unifying them touches every card and blows CLAUDE.md's small-diff rule. File it separately.

---

## 2. Constraints discovered in the codebase

These are load-bearing; the design is shaped around them.

**C1 — Layout state is one JSON blob, rewritten constantly.** `useLayoutSave.ts` PUTs the entire layout to `/dashboards/{id}` on a 500 ms debounce; `backend/apps/dashboards/dashboards.py` writes it with `atomic_write_json` to `DATA_ROOT/dashboards/{id}.json`. A live file measured 126,099 bytes, 124,738 of which is a base64 `thumbnail`. There is no size cap, no compression, no pagination. **Card body bytes must never enter layout state.**

**C2 — Nested Pydantic card models silently drop unknown fields.** Only the outer `DashboardLayout` sets `extra="allow"`; nested `CardPosition`/`ViewCardPosition`/`BrowserCardPosition`/`NotePosition` use the default `extra="ignore"`. `zOrder` is dropped on every save today — verified against real data in `backend/data/dashboards/*.json`, whose cards carry only `['session_id','x','y','width','height']`. Stacking order is therefore not durable across restart. **The new collection gets no nested Pydantic model** — it rides `DashboardLayout`'s `extra="allow"` and round-trips intact.

**C3 — There is no layout schema version.** `frontend/src/shared/migrations.ts` has an empty `MIGRATIONS` array. Forward-compat is ad hoc inside `fetchLayout` (`?? {}` defaults, `if (!c.zOrder) c.zOrder = 0`). An old file loads into a new build fine; a new file in an old build silently drops the unknown collection. Acceptable, but the new collection must tolerate absence.

**C4 — A `srcdoc` iframe inherits the parent document's CSP.** The app's only CSP is a meta tag at `frontend/public/index.html:17-32`; `electron/main.js` sets no CSP response header. That CSP permits `img-src 'self' data: blob: file: http: https:`, `media-src ... http: https:`, `frame-src 'self' http: https:` and `connect-src http://127.0.0.1:*`. The `sandbox` attribute alone gives neither "strict CSP" nor "no network."

**C5 — `ViewPreview.tsx:476` uses `sandbox="allow-scripts allow-same-origin"`** on HTML that `inject_token_into_relative_urls` has stamped the install token into. That combination is not a template to copy.

**C6 — `sanitizeSvg.ts` is not a trust boundary.** Its `DANGEROUS_ATTR` set is only `href`/`xlink:href` — the `style` attribute is never stripped — and its output feeds the repo's only `dangerouslySetInnerHTML` (`ToolGroupBubble.tsx:45`). Its `BLOCKED_TAGS` also includes `style` and `foreignobject`, the two things mermaid output depends on.

**C7 — No HTML sanitizer exists in the repo.** No DOMPurify, no `sanitize-html`, no `xss` in `frontend/package.json`. "Sanitized allowlist" is not an implementable requirement here; the design must specify a mechanism instead.

**C8 — There is no working path today to show a local binary file in the renderer.** `electron/main.js` registers no protocol handler, `preload.js` exposes no file-read bridge, and `file://` subresources are blocked from the packaged renderer's `http://127.0.0.1` origin. The existing serve routes (`outputs.py:104`, `:121`) open in **text mode** — a PNG raises `UnicodeDecodeError` and 500s — set no `X-Content-Type-Options`, and fall back to `text/plain` via `mimetypes.guess_type`.

**C9 — The existing path-confinement guard is prefix-weak.** `outputs.py:97` does `normpath` + `startswith(normpath(folder))` with no trailing separator, so an assets dir `…/assets/d1` matches `…/assets/d1extra`.

**C10 — Cards that take `panX/panY/zoom` as props re-render on every pan frame.** `NoteCard`, `DashboardViewCard` and `BrowserCard` all do (`DashboardCardLayer.tsx:263-265`). `AgentCard` already fixed this; the comment at `AgentCard.tsx:267` reads: *"Stable getter, cards read pan/zoom on demand."*

**C11 — Live-frame ceilings already exist and are needed.** `useWebviewSuspend.ts:24` sets `MAX_LIVE_WEBVIEWS = 8` with farthest-from-centre eviction (`distFromCenter`, line 185) and hysteresis (`SUSPEND_MARGIN_PX 320`, `RESUME_MARGIN_PX 96`, `SETTLE_MS 800`, `RESUME_MIN_CARD_PX 220`).

**C12 — Nothing in this app can photograph a plain `<iframe>`.** `webview.capturePage()` exists only on `<webview>` tags; `maestro.capturePage(rect)` (`preload.js:77` → `main.js:3197`) captures the **main window's** webContents cropped to a rect, so it cannot capture an off-viewport card. A "static poster on suspend" must be captured *while the card is on-screen* and cached, mirroring `useWebviewSuspend`'s `lastFrames` cache (`FRAME_TTL_MS 45_000`, `FRAME_CACHE_CAP 30`).

**C13 — The agent → canvas transport already exists end-to-end.** agent → stdio MCP server (`backend/apps/agents/apps_mcp_server.py`) → authenticated HTTP POST to `127.0.0.1:{MAESTRO_PORT}` → FastAPI handler → `ws_manager.broadcast_global(event, data)` → `/ws/dashboard` → `WebSocketManager.ts` switch → Redux. No new transport is needed.

**C14 — Every agent-facing endpoint inherits full backend authority.** `MAESTRO_AUTH_TOKEN` is baked into each MCP server's env at spawn and carried as a bearer token; there is no per-tool scoping at the HTTP layer.

**C15 — No drag-and-drop exists on the canvas.** Zero `onDrop`/`dataTransfer` handlers anywhere under `frontend/src/app/pages/Dashboard` — verified by grep. T2 is net-new, not an extension.

---

## 3. Data model

One new persisted collection on `dashboardLayoutSlice`. **Primitives only** (C1, C2):

```ts
export type ElementKind = 'image' | 'file' | 'svg' | 'html';

export interface ElementCardPosition {
  element_id: string;        // server-minted uuid4 hex
  kind: ElementKind;
  asset_id: string;          // server-minted; resolves to a file in the dashboard assets dir
  title: string;             // short, host-rendered in the card header; length-capped
  x: number; y: number; width: number; height: number;
  zOrder: number;
  created_by_session_id?: string | null;  // '' / null for user-created
}
```

`CardType` gains `'element'`. Every byte of content — HTML source, SVG source, dropped file, agent-authored body — lives as a file under the per-dashboard assets directory and is read over HTTP. Nothing content-shaped goes through Redux.

**Assets directory:** `DATA_ROOT/dashboard_assets/{dashboard_id}/{asset_id}.{ext}`, with a sibling `{asset_id}.json` holding metadata (original filename, mime, size, sha256, creating session). `DATA_ROOT` comes from `backend/config/paths.py:36`, the same root the dashboards JSON already uses.

---

## 4. Rendering — tiered by kind

The security gradient is the opposite of the intuitive one: **a sandboxed frame is the safe path; inline React rendering is the privileged path**, because inline content lands in the host renderer origin that holds the install token and the preload bridge. Every kind that cannot be reduced to an `<img>` or plain text defaults *into* the frame, not out of it.

| kind | mechanism | rationale |
|---|---|---|
| `image` | `<img src={assetUrl}>` | no trust path |
| `file` | header + icon + size; text/code previews via the existing `react-syntax-highlighter`; PDFs offered as open-externally, never inlined | no trust path |
| `svg` | `<img src="data:image/svg+xml;base64,…">` | SVG loaded through `<img>` cannot run script and cannot fetch subresources at all — strictly stronger than any allowlist, and it keeps `sanitizeSvg.ts` (C6) out of the trust path entirely |
| `html` | `srcdoc` iframe, **`sandbox=""` — no `allow-scripts`**, host-authored document shell | real HTML/CSS layout fidelity with zero script execution, zero network, and no sanitizer to get wrong (C7) |

### The `kind=html` contract

The **host**, never the agent, builds the `srcdoc` document. Fixed shell, agent content inserted only in the marked body slot:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;
               font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
```

The meta CSP is the **first element** of the document (C4 — the inherited parent CSP is permissive and cannot be relied on). Iframe attributes are pinned exactly:

```html
<iframe sandbox="" allow="" referrerpolicy="no-referrer" loading="lazy" srcdoc={shell}>
```

`sandbox=""` (no `allow-scripts`) is what makes the other flags moot: no scripts means no `allow-forms`/`allow-popups`/`allow-top-navigation`/`allow-modals`/`allow-downloads` escape surface to reason about, and no opaque-origin storage failures. Images inside a `kind=html` card are `data:` URIs inlined by the host at render time — never token-bearing URLs (C13/C5: nothing containing the auth token is ever interpolated into `srcdoc`).

### Testable security invariants

Land these tests with the feature:

1. The `srcdoc` document's first element is the host's `default-src 'none'` meta CSP.
2. The iframe carries exactly `sandbox=""` and `allow=""`.
3. No string containing the auth token is ever interpolated into `srcdoc`.
4. No `dangerouslySetInnerHTML`, no `rehype-raw`, no `innerHTML =` anywhere under the element-card source directory (lint rule or test, so a future "legitimate-looking" addition is caught).

---

## 5. Asset ingest and serving

**Write path.** The server mints everything; the client supplies no path and no id (C9).

- `asset_id = uuid4().hex`.
- Extension derived from **magic-byte sniffing** against an allowlist, reusing `sniff_file_kind` (`backend/apps/settings/settings.py:405`) — never from the uploaded filename. Original name is metadata only.
- Collision-safe write reusing the `O_EXCL` retry loop from the same module.
- Do **not** reuse `UPLOAD_DIR` (`tempfile.gettempdir()/maestro-uploads`, 7-day GC) — dashboard assets must outlive it. Leave a comment saying why.
- FormData POST shape reused from `useContextFiles.ts:49`.
- Size cap per asset, and a per-dashboard total cap.

**Read path.** A new purpose-built route — do not extend `outputs.py`'s serve routes, which are text-mode, token-in-query, and mime-guessing by design for the App Builder preview (C8).

- `FileResponse` / binary `'rb'`.
- `X-Content-Type-Options: nosniff`.
- Explicit `Content-Type` from a server-side extension→mime allowlist; never `guess_type`'s `text/plain` fallback.
- `Content-Disposition: attachment` + `application/octet-stream` for anything outside the inline-safe set (png/jpeg/gif/webp/svg-as-download/plain text).
- Confinement by `os.path.realpath` + `os.path.commonpath([real, root]) == root` — not `startswith` (C9).

---

## 6. Agent-facing path

Clone the `CreateApp` shape exactly (C13):

- New `backend/apps/agents/element_mcp_server.py`, modelled on `apps_mcp_server.py` (hand-written stdio JSON-RPC, `call_backend` auto-injecting `parent_session_id` from `MAESTRO_PARENT_SESSION_ID`).
- Registered in `backend/apps/agents/manager/register_builtin_mcp_servers.py` as `mcp_servers["maestro-element"]` with the `MAESTRO_PORT` / `MAESTRO_AUTH_TOKEN` / `MAESTRO_PARENT_SESSION_ID` env trio, plus `MAESTRO_DASHBOARD_ID` (as `maestro-schedule` already does).
- New endpoint `POST /api/dashboards/{dashboard_id}/elements` that writes the asset, appends the layout record, and fires `ws_manager.broadcast_global("dashboard:element_added", {...})`.
- Frontend consumes it with a new `case` in `WebSocketManager.ts` (the switch at :471 dispatches straight into Redux).
- Discovery: a line in `compose_turn_system_prompt.py` alongside the `<apps_capability>` block, or the agent will never call the tool.
- Built-in skill markdown documenting the tool, seeded via `p_built_in_skill_registry()` (`skills.py:75`) with a path constant next to `APP_BUILDER_SKILL_SOURCE_PATH`.

### Anti-spoofing

A prompt-injected agent — and this app reads hostile pages via browser cards — can paint a pixel-accurate fake Maestro dialog asking for a provider API key. Sandboxing does not help: the content *is* the attack. Mitigations, all host-side:

- **Non-suppressible provenance chrome** drawn by the host outside the iframe clip region: "created by agent `<name>` · `<session>`". The guest cannot paint over it.
- **Server-side width/height clamp** so no card can approximate a full-canvas modal.
- **Reject creates with no resolvable `parent_session_id`** (this also avoids the invisible-card failure mode: `useDashboardLifecycle`'s auto-open effect is gated on the session resolving to the current dashboard).
- **Per-session rate/count limit** on element creation.

### Delivery caveats to handle

- `broadcast_global` bypasses `seq_log`, so an event sent while the renderer socket is half-open is lost with no replay. The card must also be recoverable from the persisted layout on refetch — treat the broadcast as an optimisation, not the source of truth.
- Built-in skill upgrades are hash-gated: once a user edits `~/.claude/skills/<id>.md`, that install never receives bundled updates. Keep the skill markdown thin and put behaviour in the tool description.

---

## 7. Performance

- **Card chrome copies `AgentCard`, not `NoteCard`** (C10): take `getCanvasState: () => {panX,panY,zoom}` (already threaded `useDashboardController.ts:100` → `DashboardCanvas.tsx:269` → `DashboardCardLayer.tsx:172`), take no pan/zoom props, and re-pin during drag by subscribing to the `maestro:canvas-pan-changed` window event only while dragging. Gate the multi-drag prop as `isSel ? multiDragDelta : null`.
- **`MAX_LIVE_ELEMENT_IFRAMES`** with farthest-from-centre eviction ported from `useWebviewSuspend.ts:185` (C11). Viewport-intersection plus a zoom threshold is unbounded by construction — zoom into a dense cluster and every frame is legitimately visible.
- **Suspension is per-card `IntersectionObserver`** (root = `viewportRef`) with local state — *not* a Redux-dispatching global effect like `useWebviewSuspend`, whose effect deps include `panX/panY/zoom`.
- **Posters** (C12): capture via `maestro.capturePage` with the card's client rect *while on-screen and unoccluded*, cache the dataURL with a TTL and cap mirroring `lastFrames`, render the cache on suspend, fall back to a styled placeholder. Since `sandbox=""` cards run no script, suspend/resume is lossless — no guest state to preserve, so hysteresis can be looser than the browser path.
- **Do not touch `computeContentBounds`** — it is `useMemo`'d on collection identity (`useDashboardController.ts:66-70`) and is a linear min/max. Minimap cost is likewise not a concern.

**Acceptance is a measurement, not an opinion:** 200 inline element cards plus the iframe ceiling's worth of `kind=html` cards on one dashboard, recording (a) frames dropped during a 3 s pan at zoom 1 and zoom 0.3, (b) renderer process count and total RSS, (c) the byte size of the resulting `dashboards/{id}.json`.

---

## 8. Ticket split

CLAUDE.md: *"Small diffs. One ticket per branch/worktree."* Each ticket must be independently mergeable and green under `npm run verify`.

**T1 — card type and inline kinds (frontend only).**
New `elements` collection, `ElementCardPosition`, `CardType` gains `'element'`, `ElementCard.tsx` on the `AgentCard` pattern, toolbar Add menu, `image`/`svg`/`file` rendered from an already-on-disk path. No DnD, no agent path, no `kind=html`.

The ~15 layout touchpoints, to be listed verbatim in the ticket body: slice state, `initialState`, `LayoutPayload`, `fetchLayout` (**both** the replace branch and the reconnect-merge branch), `saveLayout`, `collectOccupiedRects`, `bringToFront`, `tidyLayout`, `resetLayout`, `moveCards`, `useDashboardController`, `DashboardCardLayer`, `contentBounds`, `Minimap`, `recordClosedCard`/undo. None of these are exhaustiveness-checked by the compiler — missing one fails silently. **No backend Pydantic model** (C2).

**T2 — asset store, binary serve route, drop/paste.**
Per-dashboard assets dir, ingest with magic-byte sniffing and server-minted ids, the new binary route with `nosniff` + mime allowlist + `realpath`/`commonpath` confinement, and net-new canvas `onDrop`/paste handlers (C15) with drop-position → canvas-coordinate mapping.

**T3 — agent path.**
`element_mcp_server.py`, registration, endpoint, `broadcast_global` + `WebSocketManager` case, prompt discovery line, built-in skill, provenance chrome, size clamp, rate limit. Test copies `backend/tests/test_agent_create_app.py`.

**T4 — `kind=html` static tier, then mermaid.**
Host-authored `srcdoc` shell, pinned sandbox attributes, the four security invariant tests, iframe ceiling, poster capture. Mermaid last and optional: lazy code-split `import('mermaid')` at *create* time only, persist the resulting SVG so the card renders on the cheap `<img>` path, and never load mermaid on a dashboard with no diagram card. Configure `htmlLabels: false` and inline theming as presentation attributes, since `sanitizeSvg.ts` blocks `style` and `foreignobject` (C6) — though on the `<img>` path the sanitizer is bypassed anyway.

---

## 9. Pre-existing bugs surfaced — file separately, do not absorb

1. **`sanitizeSvg.ts` does not strip the `style` attribute** and its scheme check is bypassable. Live today via `ToolGroupBubble.tsx:45`, the repo's only `dangerouslySetInnerHTML`.
2. **`scripts/check-callhome.mjs` scans `frontend/build`** while webpack outputs to `frontend/dist`, and its `walk()` is wrapped in a swallow — so the frontend is effectively unscanned. Its `FORBIDDEN` list is also openswarm-only and would not catch a CDN script tag.
3. **`zOrder` is dropped on every layout save** (C2), so stacking order does not survive a restart.
4. **`ensure_webapp_workspace_seeded_and_registered` swallows exceptions** and leaves a partial workspace (possibly with an allocated port) on disk for `recover_orphan_workspaces()` to resurrect.
