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
4. **i18n regressions** — a hardcoded English literal reintroduced into a JSX text node or a
   `label=`/`placeholder=`/`aria-label=` attribute, in a file that imports `useTranslation`.
   See "Upstream has no i18n" below.

Both guards deliberately contain the forbidden literals. **Do not "clean them up".**

If a finding is legitimate — a new migration table needing the old key names, or a deliberately
untranslated brand/feature name like "Skill Builder" — add its path (or the exact string, via
`ALLOW_STRINGS`) to the drift checker *with a reason*, rather than deleting the check.

This is not hypothetical: cherry-picking `10b019bd` reintroduced "a previous OpenSwarm" in a
docstring, and the guard caught it on its first run.

## Upstream has no i18n

Upstream (`openswarm-ai/openswarm`) ships **zero localization**. Every user-facing string there is
a hardcoded English literal — there is no `t()`, no `en.json`, no `pt-BR.json`. We localized on top
of that after the fork point, so **any upstream commit that touches a component we localized will
conflict on every `t('...')` call we added.**

That makes the failure mode specific and dangerous: resolving the conflict by "taking theirs" on a
file we localized is not a merge win, it is a silent regression. It compiles, it typechecks, it
passes every non-i18n test — and it ships plain English to every user, because **pt-BR is the
default language for every install**, not an opt-in locale. A reviewer skimming a diff for logic
correctness will not notice that a `<Typography>{t('foo.bar')}</Typography>` became
`<Typography>Foo Bar</Typography>`; the JSX shape is identical, only the payload regressed.

### Detection recipe — run after every cherry-pick that touches a localized file

1. **Locale parity, both directions.** Every key in `en.json` must exist in `pt-BR.json` and vice
   versa; a merge that adds a new upstream string without threading it through `t()` shows up here
   as a key present in code but absent from both locale files (see step 2), and a conflict
   resolution that drops a locale entry shows up as a key present in one file but not the other:

   ```bash
   node -e "
   const en=require('./frontend/src/shared/i18n/en.json');
   const pt=require('./frontend/src/shared/i18n/pt-BR.json');
   const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v!==null?flat(v,p+k+'.'):[p+k]);
   const enKeys=new Set(flat(en)), ptKeys=new Set(flat(pt));
   const missingInPt=[...enKeys].filter(k=>!ptKeys.has(k));
   const missingInEn=[...ptKeys].filter(k=>!enKeys.has(k));
   console.log('missing in pt-BR:', JSON.stringify(missingInPt));
   console.log('missing in en:', JSON.stringify(missingInEn));
   "
   ```

   Both arrays must print `[]`. Anything else means a key was added to one locale file but not the
   other — fix it before merging, don't just note it.

2. **Scan for reintroduced English literals in files that use `useTranslation`.** This is exactly
   `scripts/check-fork-drift.mjs`'s class 4 (item 4 above); it already runs inside `npm run verify`,
   but after a cherry-pick that touches a localized component, run it standalone first so the
   finding is easy to spot against a small diff instead of buried in the full verify log:

   ```bash
   node scripts/check-fork-drift.mjs
   ```

   It flags a literal JSX text node or a `label=`/`placeholder=`/`aria-label=` attribute value of
   two-or-more capitalized words, in any `.tsx` file under `frontend/src/` that imports
   `useTranslation` — scoped that narrowly on purpose so it does not fire on every English
   identifier, URL, or number in the codebase (a check that cries wolf gets deleted, not fixed).
   A real hit means the conflict resolution took upstream's hardcoded string over our `t()` call;
   restore the `t()` call and add the matching key to both locale files if it's genuinely new copy.
   A deliberately untranslated proper noun (a brand or feature name kept literal in both locales,
   like "Skill Builder") is not a regression — allowlist the exact string in `ALLOW_STRINGS` with a
   reason, as `check-fork-drift.mjs` already does.

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

**macOS commits are categorically out of scope** (new exclusion class, added when the mac
pipeline was deleted — `docs/HANDOFF.md` §10). Windows is the only shipped target, so skip
anything whose value is mac-only: notarization / entitlements / provisioning profiles, DMG
or `latest-mac.yml` work, `publish.sh` / `build-app.sh`, Touch ID / Secure-Enclave WebAuthn,
the `mouseclamp` addon, and Objective-C (`.mm`) sources. A mac-only fix does not need
judging — skip it without evaluation. A **cross-platform** fix that happens to touch a mac
path is still fair game: take it and drop the mac half. Watch for a mac commit smuggling
back the old Apple keychain access group (the `Y26NUZH4NG.*` webauthn group); the drift guard
no longer exempts that string, so it will fail — that is correct, do not re-add the exemption.

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

**Tried and rejected: the ghost-reaper refinement chain.** `dec16d78`, `08694d18`, `b537a4ed`,
`bb906d81` all look like small hardening commits on the reaper we took in `10b019bd`, and I
recommended them as "mechanical to resolve". They are not. Applied in upstream order, each one
conflicts in `backend/tests/test_reap_ghost_runtimes.py` because the chain's tests assume an
**idle-LRU reaping feature we never took** — `AppRuntimeManager.reap_stale_idle`, `idle_lru`,
`p_idle_since`. Adopting them means adopting that feature. Skip unless you want idle-LRU reaping
on purpose, in which case start from its own commits, not from these.

`f1f8464f` (idle browser-card reaping) and `8e904f21` (evict a wedged card) are medium-risk and
untried — and likely belong to the same idle-LRU family, so check that before starting.
