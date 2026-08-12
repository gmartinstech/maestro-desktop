# Upstream policy — merging from openswarm-ai/openswarm

**Read this before taking anything from upstream.** A careless merge silently undoes the detach.

## The situation

- Fork base: `e7aa032b` (upstream **v1.5.7**, 2026-07-13).
- Upstream is on **v1.7.5**, ~881 commits ahead.
- `git merge upstream/main` produces **304 conflicted paths**, several of them unresolvable in
  principle: upstream keeps developing `backend/apps/auth/`, `backend/apps/subscription/`, and
  `publish_cloud.py`, all of which we deleted on purpose. Resolving those means re-litigating
  the whole detach.

**Never merge upstream wholesale. Cherry-pick individual commits onto a branch off `main`.**

## What must never come back

`scripts/check-fork-drift.mjs` enforces this and runs inside `npm run verify`. It fails on:

1. **Legacy identifiers** — `openswarm`, `self-swarm`, `Open Swarm` (note the space: it hid in
   user-facing onboarding copy through several sweeps), `OPENSWARM_*` env vars.
   Ours are `maestro` / `MAESTRO_*` / `~/.maestro`.
2. **Deleted subsystems** — `backend/apps/auth/`, `backend/apps/subscription/`,
   `openswarm-edge/`, `publish_{cloud,scan,build,common}.py`,
   `electron/installerFilenameAttribution.js`.
3. **Call-home hosts** — `api.openswarm.com` and any `*.openswarm.{com,ai,io,net}`.
   Models go through provedor-ia (`https://llm.martinstech.net/v1`).
   `scripts/check-callhome.mjs` guards the built output; this one guards source.

Both guards deliberately contain the forbidden literals. **Do not "clean them up".**

If a finding is legitimate — a new migration table needing the old key names — add its path to
`ALLOW` in the drift checker *with a reason*, rather than deleting the check.

This is not hypothetical: cherry-picking `10b019bd` reintroduced "a previous OpenSwarm" in a
docstring, and the guard caught it on its first run.

## Cherry-picking recipe

```bash
git fetch upstream
git checkout -b ups/<topic> main
git cherry-pick -x <sha>          # -x records the upstream sha in the message
node scripts/check-fork-drift.mjs # before you get attached to the result
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly   # flag UNSET, see CLAUDE.md
```

Then the Definition of Done in `docs/HANDOFF.md`: app builds, golden smoke, verify green, and a
**different-vendor model review** (`node harness/review.mjs --base main --head HEAD`).

### Judging a candidate

- `git show --stat <sha>` first. If it touches a deleted subsystem, stop.
- If it touches a file **absent from our fork**, it belongs to a feature we never had —
  upstream's `dock`, `canvas`, `voice`, and newer onboarding all trip this. A `DU`
  (deleted-by-us) conflict is the signal. Don't invent a partial port.
- Expect conflicts anywhere we renamed identifiers — most of `backend/apps/agents/**` and all
  of `electron/**`.
- A test commit without its implementation commit is worse than neither: the suite goes green
  on a fix that isn't there. Check that companion modules actually arrived
  (`ec4a044b` supplies what `292d87af` tests).

### What we are NOT chasing

Upstream's post-fork feature work: `voice:` (~54 commits, a feature we don't ship),
`canvas:` (~80), `onboarding:` (~77), `dock:` (~18). Also all `telemetry:` commits — that is
precisely what we removed. Take fixes, not features.

## Taken so far (branch `ups/upstream-fixes`)

| Upstream | Why |
|---|---|
| `3d8c6101` | **security**: 9router state dir was 0644 with live tokens in `db.json` |
| `ec4a044b` + `292d87af` | **security**: browser sub-agent relayed raw element indices to the user |
| `ec994182` | backend respawns on unexpected exit; a crash left a dead shell + orphaned runtimes |
| `bb5893ff` | boot reaps app runtimes no live backend owns (measured alive after 2d19h) |
| `0f6e110a` | recovers apps whose record vanished but whose work is still on disk |
| `d365f737` | bounds `capturePage` so a wedged screenshot fails instead of hanging |
| `42103a4e` | agent launch silently dropped its prompt (upstream's ENG-131 ghost hang) |

## Evaluated and deliberately skipped

| Upstream | Reason |
|---|---|
| `02cda4c4` | entirely `openswarm-edge/**` — subsystem deleted, does not apply |
| `ca20d6f3` | spans `InlineSurfaceEmbeds.tsx` / `DesktopDock.tsx`, absent from our fork |
| `cc24f5ad`, `b1f0f5b7` | target `dashboardSwitchTeardown.ts` / `deleteSelectedCards.ts`, absent here |
| `50d60108` | 1334-line browser refactor merge; surgical fixes above cover the same bugs |
| `2e0572ca` | whisper/voice — feature we don't ship |

Worth revisiting: `bb906d81`, `b537a4ed`, `dec16d78` refine the ghost reaper we just took. They
conflict only because our debrand commit sits between them and their base — mechanical to
resolve if the reaper needs sharpening. `f1f8464f` (idle browser-card reaping) and `8e904f21`
(evict a wedged card) are medium-risk and untried.
