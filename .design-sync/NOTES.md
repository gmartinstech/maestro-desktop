# design-sync notes — Maestro Studio UI

Project: `Maestro Studio UI` — https://claude.ai/design/p/dbe5756d-fa67-4ef4-8991-69569bf964bb

## 2026-08-18 correction — the dashboard is a canvas, not a KPI page

The first sync's `DashboardScreen` was a generic KPI-tiles-and-runs-table layout, invented
without checking the real app. **It was wrong.** The actual dashboard
(`frontend/src/app/pages/Dashboard/canvas/DashboardCanvas.tsx`) is a hand-rolled pan/zoom
canvas holding absolutely-positioned cards (agents, browser sessions, generated apps, sticky
notes) over a dotted grid, with a floating bottom toolbar dock and a zoom pill — there is no
KPI row anywhere in the real product.

`DashboardScreen` now renders that canvas faithfully, and four new card components live under
`design-system/src/components/canvas/` — these are the pieces meant to be edited individually,
not the screen wrapper:
- **`AgentCard`** — the primary card, ported from `AgentCard.tsx`. Deliberately spare: title,
  status word, optional memory chip, one close button. No avatar, no kebab menu.
- **`BrowserCard`** — a live browser session, ported from `BrowserCard.tsx`. Only
  back/forward/reload in the nav bar.
- **`ViewCard`** — a generated app/output card, ported from `DashboardViewCard.tsx`. Its header
  carries the 4-way Preview/Code/Terminal/History segmented pill.
- **`NoteCard`** — a sticky note, ported from `NoteCard.tsx`. The one card that is paper, not
  surface: a fixed pastel palette, not the theme tokens.
- **`CanvasCardFrame`**, **`CanvasDock`**, **`CanvasZoomControls`**, **`CanvasEmptyState`** — the
  shared frame and canvas chrome these compose from.

**What was deliberately not replicated** (this is a static mockup surface, not the live app):
real pan/zoom physics (inertia, boundary spring-back), the elbow-shaped tether connector lines
between related cards, framer-motion spawn/exit animations, invisible-until-hover resize
handles, and the browser card's agent-driving theatre (scan-sweep, click ripples, frosted
shield). If the design agent's mockups need any of these to look convincing, add them then —
they weren't needed for a static illustration.

**Bugs the visual review caught, fixed before sync:** the sub-label in `CanvasEmptyState`
overlapped the headline (a `-12px` margin was too aggressive); `NoteCard`'s hardcoded
`border: none !important` silently ate the `#3b82f6` selection ring — needed an explicit
`.mds-notecard.mds-canvas-card--selected` override; the first `DashboardScreen` demo
composition let the browser/view cards overflow past the visible canvas edge.

Selection blue (`#3b82f6`) and the accent highlight halo are **hardcoded to match the app
exactly** — the real app has no token for either, so don't "fix" that by tokenizing it here.

## What this repo syncs

This repo is an Electron **application**, not a design-system library. There is no Storybook and
no publishable component package. The synced DS lives at **`design-system/`** and was authored
during the first sync (2026-08-17) specifically to drive UI/UX work on the Windows app.

- Its token layer is a faithful port of `frontend/src/shared/styles/claudeTokens.ts`
  (light + dark, navy `#003566` / gold `#F5CC00`, 8px radius, cool-tinted neutrals). **If those
  app tokens change, update `design-system/src/styles/tokens.css` and `src/tokens.ts` to match** —
  nothing enforces this automatically.
- Components are **new code written to match the app's visual language**, not extracts of the live
  app components (those are wired to Redux, i18n and Electron IPC and cannot bundle standalone).
  They are intended to be shippable back into `frontend/`.
- Chrome metrics are taken from the real `AppShell.tsx`: 38px titlebar, 260px sidebar (160–400,
  boots collapsed), 138px Windows control gutter, 78px macOS traffic-light inset.
- The brand skill at `~/.claude/skills/martinstech-design-system` holds a second, **different**
  system (`.mt`, "MartinsConnect Maritime Precision", DM Sans + Fira Code). It was deliberately
  NOT used as the token source — only its Inter/IBM Plex Mono font files were reused. Don't
  conflate the two.

## Build

- `npm --prefix design-system run build` (tsc → `dist/`, plus `scripts/copy-assets.mjs` which
  concatenates `tokens.css` + `components.css` into one flat `dist/maestro-ds.css` and copies fonts).
  One flat CSS file with no `@import` is deliberate — it keeps the design-sync scrape and app
  consumers on the same bytes.
- Converter entry: `--entry ./design-system/dist/index.js --node-modules ./design-system/node_modules`.
- The DS has **no runtime dependencies** — icons are inline SVGs behind a single `Icon` component.
  `lucide-react` was deliberately dropped so the bundle is react-only.

## Gotchas learned the hard way

- **`cfg.provider` is mandatory.** Previews render components with no wrapper, and `.mds-root`
  (which `ThemeProvider` renders) is what sets `font-family`. Without the provider every card
  renders in browser-default **serif** while colours still look right — an easy thing to miss.
  Config already sets `provider: { component: "ThemeProvider", props: { theme: "light" } }`.
- **CSS source order bit us once**: `.mds-mono` is declared before `.mds-input`, so
  `font-family: inherit` won. Mono fields need the explicit
  `.mds-input.mds-mono, .mds-textarea.mds-mono, .mds-select.mds-mono` rule. Keep it.
- **`[FONT_MISSING] "Cascadia Code"`** is expected and suppressed via
  `runtimeFontPrefixes: ["Cascadia Code"]`. It is an OS-provided *fallback* in the mono stack,
  not a brand face — do not ship it. Inter + 3 IBM Plex Mono weights are shipped.
- **`guidelinesGlob` must stay narrow.** The default glob matched `docs/*.md` and swept all 42
  per-component docs into `guidelines/`. Pinned to `docs/guides/**/*.md` (which does not exist yet,
  so the build prints a harmless `not found — skipped`).
- **Escapes in JSX attributes are not processed.** `defaultValue="C:\\Users\\x"` renders doubled
  backslashes; use `defaultValue={'C:\\Users\\x'}`.
- **Playwright/chromium mismatch**: the repo pins playwright `1.62.1` → chromium build **1234**,
  but the shared cache had only 1208/1237. Ran `npx playwright install chromium
  chromium-headless-shell` once. Expect to repeat this on a new machine.
- 13 components carry `cardMode: "column"` overrides (`cfg.overrides`) — the four the validator
  flagged as wide (Tabs, Icon, ThemeProvider, Tooltip) plus the full-screen shell/template cards,
  set deliberately so they aren't cropped in a multi-column grid.

## Known render warns

None. The final validate run exits **clean with zero warnings** — so on a re-sync, *any* warn line
is new and should be investigated rather than assumed pre-existing. (`[RENDER_SKIPPED]` on a
no-change re-sync is the one expected exception.)

## Component docs

`design-system/docs/<Name>.md` — one per component, frontmatter `category:` drives the card group
in the DS pane (10 groups). Generated once during the first sync and then hand-owned; add a doc
whenever you add a component, or it lands in an untidy default group.

## Re-sync risks — what can silently go stale

- **Token drift.** The DS's tokens are a *copy* of `claudeTokens.ts`. If the app's tokens change
  and this copy doesn't, every design the agent produces is subtly off-brand. There is no test.
- **Chrome metric drift.** `--mds-titlebar-height`, `--mds-sidebar-width` and the two OS gutters
  are hard-coded from `AppShell.tsx` constants. If the app changes `SIDEBAR_DEFAULT` or
  `WINDOW_CONTROLS_GUTTER`, update `tokens.css`.
- **Preview copy names real things** (agents, workflows, `llm.martinstech.net/v1`, model ids like
  "Claude Opus 5"). It is illustrative content, not configuration — but it will read as dated if
  models or the provider name change. Note: `CLAUDE.md` now calls the provider "the Maestro
  provider"; a few previews and docs still say "provedor-ia". Cosmetic, worth a pass someday.
- **Screen templates duplicate layout logic** that the real app owns. They are reference layouts
  only; if the app's Dashboard/Settings/AgentChat structure changes materially, the templates
  become misleading and should be re-authored.
- **Only light theme is covered by the render check.** `cfg.provider` pins `theme: "light"`; dark
  mode is verified solely through the `ThemeProvider` and `MaestroLogo` previews that opt in
  explicitly. A dark-mode regression elsewhere would not be caught.
- Grades live in the gitignored `.design-sync/.cache/`; cross-machine carry-forward comes from the
  uploaded `_ds_sync.json`. A fresh clone re-verifies nothing as long as that anchor is intact.
