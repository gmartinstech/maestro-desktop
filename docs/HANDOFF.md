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
- `check-callhome` is **RED** (still finds `openswarm.com` in `electron/main.js`, `electron/preflight.js`, etc.) — the DET epic turns it green. This is expected, not a bug.
- LICENSE (MIT © 2026 Haik Decie) retained; `NOTICE` adds MartinsTech.
- Root `CLAUDE.md` was un-ignored (upstream `.gitignore` had `/CLAUDE.md`).

## 3. Bring these over (NOT in the repo)

- **Design-system assets** (needed for the BRD epic): `bot-pixel.svg` (the pixel-art robot app icon) and `App onboarding (N).zip` (contains `am.css` = navy+gold tokens, fonts **Inter** + **IBM Plex Mono**, plus DM Sans/Fira Code). On the dev PC these are in `Downloads/`. Brand palette: navy `#003566` / gold `#F5CC00`.
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
- **Human-only tasks:** DET-2 (Windows signing — needs Azure Trusted Signing creds), DET-6 (macOS signing — deferred until a Mac target).
- **After DET**, author + execute (in order): **BRD** (rebrand — needs the design-system assets from §3), **PRV** (provedor-ia + Keycloak JWT), **DOM** (domain modes/workflows/skills/tools), **LOC** (pt-BR i18n). Scope for each is in the spec (§5) and the board.

## 7. Open follow-ups / not-yet-done

- `harness/review.mjs` has 2 logged **Minor** findings (tighten the `spawnSync` status check to `res.status !== 0`; harden `opt()` when a flag is passed with no value). Non-blocking.
- Plan 1 tasks **8–10 were specced but not executed** (only PR #1's gate subset + PR #2's `review.mjs` shipped): `docs/UPSTREAM.md` runbook, `docs/CONTRIBUTING-maestro.md` (Definition of Done), `docs/SECRETS.md`, `.env.maestro.example`, `harness/dispatch.mjs` + `harness/models.json`, branch protection, visual-regression snapshots. Build them as needed — their specs are in `docs/plans/2026-07-20-foundation-and-stability-gate.md`.
- Branch protection on `main` is **not** enabled yet (needs the GitHub settings / your call).
- The backend `MAESTRO_MOCK_AGENT=1` seam for the golden smoke (Plan 1 Task 6, Step 1) was **not** applied — apply it in `backend/apps/agents/agent_manager.py` when you calibrate the smoke.

## 8. Key file map

- Providers/registry: `backend/apps/agents/providers/registry.py`
- Provider env adapter: `backend/apps/agents/manager/configure_provider_env.py`
- Agent loop: `backend/apps/agents/manager/run/TurnRunner.py`; MockAgent: `backend/apps/agents/manager/MockAgent.py`
- Modes/Workflows/Skills/Tools: `backend/apps/{modes,workflows,skills,tools_lib}`
- Branding tokens: `frontend/src/shared/styles/claudeTokens.ts`
- Cloud couplings to remove (DET): `electron/main.js` (feed/analytics/affiliate), `electron/preflight.js`, `backend/apps/{auth,subscription}`, `frontend/public/index.html` (CSP)
- The gate: `scripts/verify.mjs`, `scripts/check-callhome.mjs`; the reviewer: `harness/review.mjs`; the smoke: `e2e/golden/`
