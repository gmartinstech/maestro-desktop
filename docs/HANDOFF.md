# Maestro Studio — Handoff / Continue Here

**Purpose:** everything needed to resume this implementation on a different machine. This doc lives in the repo, so `git clone` gives you the source of truth. (The dev session's local Claude memory does **not** travel — this file + `docs/specs` + `docs/plans` + `CLAUDE.md` are the portable record.)

Last updated: 2026-07-20.

---

## 0. First 10 minutes on the new PC

```bash
git clone https://github.com/gmartinstech/maestro-desktop.git
cd maestro-desktop
git remote add upstream https://github.com/openswarm-ai/openswarm.git   # for upstream syncs
```
Then read, in order: `docs/specs/2026-07-20-maestro-fork-design.md` (the design) → `CLAUDE.md` (agent guide) → `docs/plans/2026-07-20-det-detach.md` (the next work).

**First real action:** validate the stability gate end-to-end (it has NOT been run end-to-end yet — only syntax-checked):
```bash
npm install                       # root: pulls @playwright/test
npx playwright install chromium
cd frontend && npm ci && npm run build && cd ..
npm run verify                    # build + lint + typecheck + golden smoke + check-callhome
```
Expect the **golden-path smoke** (`e2e/golden/golden-path.spec.ts`) to need a **one-time selector calibration** against the real running app (the selectors were written from the code, not from a live DOM). Fix them once, commit, and the gate is your regression oracle from then on.

---

## 1. What this is

Maestro Studio = MartinsTech's fork of **Open Swarm** (MIT) — an Electron + React/TS + FastAPI/Python desktop orchestrator for running many AI coding agents in parallel. We are: detaching it from openswarm-ai's cloud, rebranding to **Maestro Studio**, routing models through our own **provedor-ia** gateway (Keycloak auth), and localizing to **pt-BR**. **Desktop-only** — multi-tenant SaaS was explicitly dropped.

- "Maestro" is the MartinsTech **platform brand**; this repo is the agent-orchestration desktop component.
- ⚠️ Do **not** confuse with `gmartinstech/maestro` — that's the separate live **Java fiscal/payroll platform** (nfse/folha/esocial). This fork is `gmartinstech/maestro-desktop`.
- Product display name **"Maestro Studio"**; appId **`net.martinstech.maestro.studio`**.
- Design overview board (claude.ai, same login): https://claude.ai/code/artifact/03b78c4c-6939-4079-ad32-32b602c39a38

## 2. Current state (on `main`)

- Repo `gmartinstech/maestro-desktop`; `upstream` = `openswarm-ai/openswarm` (fork base ~v1.5.7; upstream now v1.5.8+).
- **Merged PRs:** #1 foundation gate scaffolding · #2 `harness/review.mjs` · #3 planning docs.
- **On main:** `scripts/verify.mjs`, `scripts/check-callhome.mjs`, `harness/review.mjs`, `e2e/golden/{golden-path.spec.ts,fixtures.ts}`, `CLAUDE.md`, `AGENTS.md`, `NOTICE`, root `package.json`, `docs/specs/…design.md`, `docs/plans/{…foundation…,…det-detach}.md`.
- `check-callhome` **source is clean** as of DET (`feat(det): remove the openswarm.com call-home and product telemetry`). The check scans *built output*, so it can still go red on stale gitignored artifacts (`electron/build-staging/**`, `electron/dist/win-unpacked/**`) left over from a pre-DET build — rebuild, or delete those dirs, before believing a failure.
- LICENSE (MIT © 2026 Haik Decie) retained; `NOTICE` adds MartinsTech.
- Root `CLAUDE.md` was un-ignored (upstream `.gitignore` had `/CLAUDE.md`).

## 3. Bring these over (NOT in the repo)

- **Design system**: lives at `G:\Shared drives\MartinsTech\.claude\skills\martinstech-design-system\` (`SKILL.md` + `assets/`). Icons are DONE — the robot PNGs are vendored into `assets/brand/maestro/`, so the share is no longer needed for a build. Still to bring over for the faithful BRD pass: `assets/fonts/` (**Inter** + **IBM Plex Mono**) to self-host, and `assets/maestro-tokens.css`. Brand palette: navy `#003566` / gold `#F5CC00`. There is no `bot-pixel.svg` — that filename was wrong; `SKILL.md:269` names `assets/maestro/maestro-*.png` as the product app icon (`mt-logo-*` is the company mark).
- **Secrets** (never commit): provedor-ia `https://llm.martinstech.net/v1` + API key (`mtok_…`) or Keycloak JWT; Keycloak issuer/client; Windows code-signing (Azure Trusted Signing) for DET-2.
- **Tooling:** Node 20+ (dev used v25.2.1), npm, git, `gh` CLI (auth as `gmartinstech`), Ollama 0.32+ **with cloud models configured** (see §5), optionally LM Studio (`ornith-1.0-35b`).

## 4. How we work (execution model)

- **Subagent-driven, quality-first.** Implement with **Claude Sonnet / Haiku** (or OpenAI Codex); **Opus** orchestrates + adjudicates. One ticket per branch.
- **Cross-vendor review is mandatory** on every code diff:
  ```bash
  node harness/review.mjs --base main --head HEAD     # ollama run deepseek-v4-flash:cloud
  ```
  Merge only on `VERDICT: APPROVE`. Disagreement → escalate to Opus/human.
- **Gate:** `npm run verify` must be green; `check-callhome` must not regress (and reaches green by end of DET).
- **Definition of Done** (every ticket): app builds + launches; golden smoke passes; verify green; behaviour verified in the running app; DET/PRV show zero new openswarm-ai calls; different-vendor review APProved. (Full text in the spec §7.)

## 5. Environment gotchas we already hit (save yourself the pain)

- **`pi -p` (agentic) HANGS headless** — it needs a TTY; even a trivial ping never returned. Use **`ollama run <cloud-model>`** instead (that's what `harness/review.mjs` does). `pi --list-models` works fine.
- **Bedrock GPT (`openai.gpt-5.5`) is NOT configured** (exit 255). **`codex` CLI errors in git-bash** (a broken `node` shim at `AppData\Roaming\npm\node_modules\node\bin\node`) — run codex/pi from a native terminal, not git-bash, if you use them.
- **Configured cloud Ollama models:** `deepseek-v4-flash:cloud` (fast — the default reviewer), `deepseek-v4-pro:cloud` (slow, thinking), `qwen3-coder-next:cloud`, `glm-5.2:cloud`, `minimax-m3:cloud`, `qwen3.5:cloud`, `gemma4:31b-cloud`. Local: `ornith-1.0-35b` (LM Studio).
- `ollama run` emits TTY spinner escape codes even when piped — `review.mjs` strips them.
- Windows-first. In git-bash plain `node` works, but `pi`/`codex` launchers don't.

## 6. Next work — Plan 2: DET (Detach)

`docs/plans/2026-07-20-det-detach.md` — 10 tasks, each with exact file:line anchors, gated by `check-callhome` + golden smoke + `harness/review.mjs`.

- **Start with Task 1** (repoint auto-update/publish to `gmartinstech/maestro-desktop`) — pure file edits, no build, verifiable via `grep` + `review.mjs`.
- **Acceptance for the whole epic:** `node scripts/check-callhome.mjs` exits 0, golden smoke passes, and a runtime network capture shows zero `*.openswarm.com` traffic.
- **Human-only tasks:** DET-2 (Windows signing — needs Azure Trusted Signing creds). DET-6 (macOS signing) is **cancelled**: see §10.
- **After DET**, author + execute (in order): **BRD** (rebrand — needs the design-system assets from §3), **PRV** (provedor-ia + Keycloak JWT), **DOM** (domain modes/workflows/skills/tools), **LOC** (pt-BR i18n). Scope for each is in the spec (§5) and the board.

## 7. Open follow-ups / not-yet-done

- `harness/review.mjs` has 2 logged **Minor** findings (tighten the `spawnSync` status check to `res.status !== 0`; harden `opt()` when a flag is passed with no value). Non-blocking.
- Plan 1 tasks **8–10 were specced but not executed** (only PR #1's gate subset + PR #2's `review.mjs` shipped): `docs/UPSTREAM.md` runbook, `docs/CONTRIBUTING-maestro.md` (Definition of Done), `docs/SECRETS.md`, `.env.maestro.example`, `harness/dispatch.mjs` + `harness/models.json`, branch protection, visual-regression snapshots. Build them as needed — their specs are in `docs/plans/2026-07-20-foundation-and-stability-gate.md`.
- Branch protection on `main` is **not** enabled yet (needs the GitHub settings / your call).
- The backend `MAESTRO_MOCK_AGENT=1` seam for the golden smoke (Plan 1 Task 6, Step 1) is now applied in `backend/apps/agents/agent_manager.py` (selects `MockAgent.run_mock_turn` ahead of provider resolution). Note the flag must stay unset when running the backend suite.

## 8. Key file map

- Providers/registry: `backend/apps/agents/providers/registry.py`
- Provider env adapter: `backend/apps/agents/manager/configure_provider_env.py`
- Agent loop: `backend/apps/agents/manager/run/TurnRunner.py`; MockAgent: `backend/apps/agents/manager/MockAgent.py`
- Modes/Workflows/Skills/Tools: `backend/apps/{modes,workflows,skills,tools_lib}`
- Branding tokens: `frontend/src/shared/styles/claudeTokens.ts`
- Cloud couplings to remove (DET): `electron/main.js` (feed/analytics/affiliate), `electron/preflight.js`, `backend/apps/{auth,subscription}`, `frontend/public/index.html` (CSP)
- The gate: `scripts/verify.mjs`, `scripts/check-callhome.mjs`; the reviewer: `harness/review.mjs`; the smoke: `e2e/golden/`

## 9. BRD (rebrand) — first pass done; faithful pass needs assets

A **first-pass** MartinsTech rebrand landed on `main` (commit `feat(brd): first-pass ...`): `claudeTokens.ts` accent → navy `#003566` (azure `#4A90D9` in dark for contrast), neutrals cooled toward navy, fonts → **Inter + IBM Plex Mono** (via Google Fonts; CSP already allows), title + wordmark → "Maestro Studio", orange octopus `logo.png` dropped, hardcoded oranges → navy. A `brand: {navy,gold}` token now exists; **gold `#F5CC00` is NOT used as an accent** (fails contrast on buttons/links) — it belongs on the logo + dark-text badges. Verified: tsc/build green + a live dev launch (Inter loaded, navy buttons, cool bg). NOTE: this pass was **not** cross-vendor-reviewed (ollama cloud was down); re-run `harness/review.mjs` when convenient.

**DONE since:** the orange octopus is gone everywhere. `scripts/gen-icons.py` (backend-venv Pillow, no new deps) regenerates all nine surfaces from `assets/brand/maestro/` — `electron/build/icon.{png,ico,icns}`, `electron/splash/icon.png`, `assets/icon.png`, `frontend/public/{favicon.ico,logo.png,apple-touch-icon.png,maestro-mark.png}`. Rerun it after any brand refresh. The splash shader's coral glow and orange-tilted wave (both tuned to the octopus body) moved to gold + azure. **Also done:** the three stacked Windows bars are now one — `titleBarStyle:'hidden'` + `titleBarOverlay` on Win/Linux, menu kept registered but its strip hidden behind a hamburger in the bar (do NOT "simplify" that to `setApplicationMenu(null)`: it deletes every accelerator, incl. the *View → Reload* that `AppShell.tsx` depends on).

**Still showing the old brand:**
- `electron/splash/splash.html:6,124` — splash wordmark; covered by OSR Phase 1 slice 1B (`electron/**` + `frontend/**`).
- ~~`electron/package.json` `squirrelWindows.iconUrl`~~ — **RESOLVED**: it now pulls `icon.ico` from `gmartinstech/maestro-desktop`, so the Windows installer shows our icon.
- **Self-hosted Inter + IBM Plex Mono woff2** (bundle under `frontend/public/fonts` + `@font-face`) so fonts work offline instead of via Google Fonts.
- **Gold `#F5CC00` placements**: active/selection states, focus rings, badges (dark text on gold), brand mark — wire the `brand.gold` token into those specific spots.
- Remaining old-brand strings (model-provider group labels in `Main.tsx` DEFAULT_MODEL_PRIORITY, onboarding copy) are DOM/BRD-copy cleanup, not visual-token work; the token sweep for them is OSR Phase 1 (`docs/plans/2026-08-10-osr-openswarm-removal.md`).

## 10. macOS is dropped — Windows-only (product-owner decision)

**Decision: macOS is not a target. Do not revive it.** The whole mac build/release
pipeline was deleted, not disabled:

- `.github/workflows/release-macos.yml`, `publish.sh`, `scripts/build-app.sh`,
  `scripts/build-test-dmg.sh`, `scripts/build-python-env.sh`
- `electron/scripts/` in full (`notarize.js` + its `afterSign` wiring,
  `build-mouseclamp.sh`, `sign-vmp.{sh,js}` + the `postinstall` hook)
- `electron/native/mouseclamp/**` (the Objective-C cursor-crash addon) and
  `installMacMouseClamp()` in `electron/main.js`
- `electron/build/{entitlements.mac.plist,entitlements.mac.inherit.plist,embedded.provisionprofile}`
- the `mac` + `dmg` blocks in `electron/package.json` `build`, the `dist` /
  `dist:publish` / `dist:all` / `test:mouseclamp` scripts, and the
  `@electron/notarize` devDependency. `dist:win` / `dist:win:publish` are the
  entry points that remain.
- the `latest-mac.yml` gating in `scripts/release/verify-release.js` and the
  `latest-mac.yml` pre-flight in `scripts/build-app-win.ps1` (that one was
  actively **blocking** a Windows publish).
- The Apple keychain access group `Y26NUZH4NG.…webauthn` went with the plist,
  along with the `app.configureWebAuthn({ touchID })` call it authorized. That
  was the last non-migration, non-attribution `openswarm` string in the tree, so
  its `ALLOW_STRINGS` exemption in `scripts/check-fork-drift.mjs` is gone too.
  Windows keeps the passkey reject-shim; there is no platform authenticator there.

Runtime `process.platform === 'darwin'` / `IS_MAC` branches in `electron/main.js`,
`frontend/src/**`, and `e2e/**` were left alone on purpose: they are inert on
Windows and ripping them out is a large, risky, unrelated diff.

Upstream mac commits are now categorically out of scope for cherry-picking — see
`docs/UPSTREAM.md`.

Not shipped as part of a Windows build but deliberately left in place:
`electron/build/icon.icns` (+ its generation in `scripts/gen-icons.py`) and the
`inspectMac()` diagnostic in `scripts/ci/verify-signature.js`.

### Fallout worth a ticket: the youtube MCP bundle has no builder

`scripts/build-app.sh` (deleted) was the only thing that regenerated the
`@kirbah/mcp-youtube` bundle; `scripts/build-app-win.ps1` never built it.
`backend/mcp-bundles/kirbah-mcp-youtube.js` is checked in, so packaged builds still
ship it — but nothing can rebuild it now, so it silently freezes at its current version
and a dependency fix there is unshippable. Either add the esbuild step to the Windows
build script or drop the bundle deliberately. Do not leave it as an orphan.
