# Maestro — Fork & Customization Design Spec

- **Status:** Draft for approval
- **Date:** 2026-07-20
- **Owner:** gsilva (MartinsTech)
- **Upstream:** `openswarm-ai/openswarm` @ v1.5.8 (MIT)
- **Companion:** interactive approval board (Artifact) — epics & tickets, kept in sync with this doc

---

## 1. Summary

**Maestro** is MartinsTech's fork of Open Swarm — an Electron + React/TS + FastAPI/Python orchestrator for running many AI coding agents in parallel. We will detach it from openswarm-ai's cloud/build/telemetry, rebrand it as Maestro, run it on our own `provedor-ia` gateway, and localize it to Brazilian Portuguese — delivered as a **desktop application** (not a hosted service). The work is executed by a **quality-first, multi-model agent harness** guarded by a model-agnostic verification gate, so no single iteration can silently break the app.

## 2. Goals & Non-Goals

**Goals**
1. A standalone, **Maestro-branded desktop app** that makes **zero calls** back to openswarm-ai infrastructure.
2. All model traffic routed through our **`provedor-ia`** gateway (OpenAI-compatible), authenticated via **Keycloak**.
3. Our **domain workflows** (modes, workflows, skills, tools) provisioned into the app.
4. UI localized to **pt-BR**.
5. A stability regime such that **every epic/iteration is verifiably non-breaking**.

**Non-Goals (explicitly dropped)**
- **No multi-tenant SaaS / hosted service.** Investigation showed this is a VERY-HIGH re-platform (no user/tenant model; agents execute as the host OS user with no real sandbox; state is local JSON + in-process dicts). Out of scope.
- No new auth system — we integrate existing **Keycloak**, not build our own.
- No rewrite of the agent runtime — we keep `claude-agent-sdk` as the loop and route providers beneath it (see §4).

## 3. Key findings (grounded in a full read of v1.5.8)

These shape every decision below.

1. **Already multi-provider.** Open Swarm abstracts the *wire protocol beneath* the SDK, not the SDK. A bundled Node router (`9Router`) + local proxy shims translate OpenAI/Gemini/OpenRouter/**any custom OpenAI-compatible** endpoint into the Anthropic protocol the agent loop speaks. There is a real model **registry** (`apps/agents/providers/registry.py`) and a per-route env adapter (`configure_provider_env.py`). Cost tracking is already multi-vendor. → `provedor-ia` plugs into the existing "custom OpenAI-compatible provider" slot.
2. **Runs fully cloud-less today.** Nothing hard-blocks startup if openswarm-ai is unreachable. Sign-in is optional; the "OpenSwarm Pro" metered proxy, Stripe, and free-trial are **inert in the default `own_key` mode**. → Runtime detachment is **LOW–MEDIUM** (env/config edits + UI removal). Only **build & code-signing** under our own identities is **HIGH** (Windows signing; Apple provisioning if we ever ship macOS).
3. **Extensibility is runtime/config, not code.** Modes (JSON + REST), Workflows (the real, shipped "templates" — multi-step, schedulable), Skills (`SKILL.md` in `~/.claude/skills/`), and Tools (MCP config) are all addable without forking built-ins. No database — all JSON files.
4. **Zero i18n.** ~1,800–2,500 hardcoded English strings across ~140 files. Greenfield.
5. **MIT license** (© 2026 Haik Decie) — must be retained; we add our copyright alongside.
6. **README is partly stale.** "Prompt Templates" don't exist (it's Workflows); "git worktree isolation" is not a security sandbox (irrelevant now — desktop-only).
7. **Runtime dependency:** the multi-provider path requires the bundled Node `9Router` subprocess (needs Node.js) — a pre-existing dependency, not an openswarm-ai coupling.

## 4. Architecture & customization surfaces

| Surface | Where | Approach |
|---|---|---|
| Branding | `claudeTokens.ts`, `electron/package.json`, `main.js`, splash, 9 icon files | Rebrand to Maestro; apply MartinsTech design system |
| Providers | `providers/registry.py`, `configure_provider_env.py`, `9Router`, `settings/credentials.py` | Register `provedor-ia` as custom OpenAI-compatible provider; Keycloak JWT |
| Detach | `main.js` (feed/analytics/affiliate), `auth/router.py`, `subscription/*`, `configure_provider_env.py`, `index.html` CSP, build scripts | Remove/neutralize cloud paths; repoint or disable; our own signing/publish |
| Domain content | `apps/modes`, `apps/workflows`, `apps/skills`, `apps/tools_lib`, `~/.claude/skills` | First-run provisioning bootstrap (no fork of built-ins) |
| Localization | `frontend/src/**` (~140 files), `electron/main.js`, backend `detail=` strings | react-i18next, source-string-as-key + fallback-to-English |

## 5. Epics

Ticket IDs match the board. Effort: LOW / MED / HIGH.

### FND — Fork & Foundation *(Phase 0)*
Stand up our repo and a path to track active upstream (v1.5.8, 1,600+ commits).
- FND-1 Fork to our org + `upstream` remote · FND-2 Upstream-sync strategy (conflict-zone map, cadence) · FND-3 Retain MIT + add our attribution · FND-4 CI skeleton (drop upstream-only jobs) · FND-5 Secrets/env templates.

### DET — Detach from openswarm-ai *(Phase 1; Build HIGH, Runtime LOW–MED)*
Center of gravity. The app already runs cloud-less; most of this is config/UI removal.
- DET-1 Repoint publish + auto-update feeds · DET-2 Windows code-signing under our identity **(HIGH)** · DET-3 Remove optional cloud sign-in · DET-4 Remove "Pro" proxy/Stripe/free-trial · DET-5 Remove telemetry/analytics/affiliate · DET-6 [deferred] macOS signing + provisioning profile · DET-7 Fork/vendor webapp-template · DET-8 Repoint endpoints + fix renderer CSP (add `llm.martinstech.net`) · DET-9 Widevine: drop vs. own EVS · DET-10 MCP-tool OAuth broker (scope decision).

### BRD — Rebrand → Maestro *(Phase 1)*
- BRD-1 Product identity → Maestro (`net.martinstech.maestro`, titles, splash, installers) · BRD-2 Icon set from `bot-pixel.svg` (pixel-art robot, navy/gold) · BRD-3 Port the MartinsTech Maestro design system (`am.css`): navy + gold, **Inter + IBM Plex Mono**, dark-first + light counterpart · BRD-4 UI copy scrub (~42 files) · BRD-5 [optional] internal identifier rename.

### PRV — Integrate provedor-ia *(Phase 1)*
- PRV-1 Register `provedor-ia` as custom provider (`llm.martinstech.net/v1`) + model registry rows + default · PRV-2 Keycloak JWT auth (vs static key; refresh) · PRV-3 Verify streaming/tools/cost through the gateway · PRV-4 De-risk the Claude-CLI runtime path through 9Router translation.

### DOM — Our Domain Workflows *(Phase 2)*
- DOM-1 First-run provisioning bootstrap · DOM-2 Modes · DOM-3 Workflows · DOM-4 Skills (reuse the design-system skills shipped in the DS zip) · DOM-5 MCP tools.

### LOC — Localization (pt-BR) *(Phase 2)*
Approach: react-i18next, **source-string-as-key + fallback-to-English** (merge-safe against upstream); pt-BR catalog is a net-new file upstream never touches; backend strings mapped frontend-side to avoid Python churn.
- LOC-1 i18n infra · LOC-2 extraction tooling + CI · LOC-3 locale-format utils (US$, comma decimal, DD/MM, plurals) · LOC-4 Settings · LOC-5 AgentChat **(HIGH)** · LOC-6 tool-action labels · LOC-7 Dashboard **(HIGH)** · LOC-8 Onboarding (copywriter pass) · LOC-9 Tools/integrations · LOC-10 Workflows · LOC-11 remaining screens · LOC-12 built-in mode labels · LOC-13 backend error messages · LOC-14 Electron-native UI · LOC-15 [optional] language switcher · LOC-16 pt-BR QA pass.

### STAB — Stability & Guardrails *(Phase 0 → ongoing)*
The regression oracle + gates that make cheap/local agents safe. **Built before any implementation swarm runs.**
- STAB-1 Green baseline (existing lint/typecheck/phase-tests/e2e on our CI) · STAB-2 Golden-path smoke via **MockAgent** (deterministic, no keys) · STAB-3 One-command `verify` (build+lint+typecheck+smoke+call-home) · STAB-4 Merge gate + Definition of Done · STAB-5 Reversibility conventions (additive-then-switch for DET/PRV) · STAB-6 Visual-regression snapshots (BRD/LOC) · STAB-7 Upstream-merge runbook · STAB-8 Agent dev harness (any runtime) · STAB-9 Cross-model review panel · STAB-10 Agent-ready, token-lean repo (CLAUDE.md/AGENTS.md + context packs).

### SEC — Security & Privacy *(cross-cutting)*
- SEC-1 Call-home & secrets review (network-capture proves zero openswarm-ai traffic; rebrand gitleaks/secret-scan config).

### ABS — Provider-abstraction hardening *(later, optional)*
- ABS-1 Consolidate the ~50 scattered routing-prefix checks into registry capability flags.

## 6. Sequencing & critical path

1. Approve this spec.
2. **FND** — fork, license, CI.
3. **STAB-1→3** — the `verify` gate + golden smoke (built by Sonnet/Opus). *No cheap/local agent runs before this exists.*
4. **Phase 1 MVP (parallel):** DET + BRD + PRV → a branded, self-contained desktop app on our own models. Dogfood internally.
5. **Phase 2:** DOM + LOC.
6. **SEC** throughout; **ABS** if warranted.

## 7. Definition of Done (every ticket)

1. App **builds** and **launches**; backend boots.
2. The **golden-path smoke** (STAB-2) still passes.
3. **typecheck + lint + tests** green in one `verify` run.
4. The ticket's behaviour is **verified in the running app** — evidence, not assertion.
5. **DET/PRV only:** network capture shows **zero new calls** to openswarm-ai.
6. Diff **reviewed by a different-vendor model** (or human); merged only when green.

## 8. Multi-model agent execution harness

**Principle:** the `verify` gate is model-agnostic — it judges a diff, not its author. This makes cheap/mixed-model execution safe.

**Stance — quality-first.** Implement with frontier models; use local models as free reviewers.
- **Implement:** Claude **Sonnet** + **OpenAI Codex**; **Opus** for hard/orchestration.
- **Review (cross-vendor, mandatory):** reviewer ≠ implementer vendor; plus local **`ornith-1.0-35b`** (via pi→LM Studio) as a free second opinion on every diff; disagreement → Opus/human.
- **Runtimes wired:** Claude subagents (`Agent(model=…)`), OpenAI Codex (`codex exec`), local via **pi** (LM Studio/Ollama), and the **`provedor-ia`** gateway as the OpenAI-compatible entry for non-Claude models.
- **Coordination:** stateless file handshake (task/result/done markers, Windows atomic rename) per the agent-dispatcher contract; one isolated git worktree per ticket.
- **Human-only tickets:** credential/signing (DET-2/DET-6), Keycloak client setup (PRV-2).

**Token efficiency (STAB-10):** per-epic **context packs** (the exact file lists from this analysis) so implementers never re-explore; root `CLAUDE.md`/`AGENTS.md`; small tickets with `file:line` refs; the gate as a cheap binary signal; MockAgent smoke spends zero LLM tokens.

## 9. Risks & open decisions (defaults; vetoable)

- **Epic 5 (ABS):** optional / unscheduled.
- **Epic 4 seeding:** runtime-provisioned (merge-friendly) rather than baked-in built-ins.
- **Packaging:** Windows-first (Win11); macOS signing deferred (DET-6).
- **Widevine DRM:** dropped by default unless the embedded browser needs protected video.
- **9Router / Node.js:** remains a runtime dependency of the multi-provider path.
- **`ornith-1.0-35b` limits:** 131K ctx, no thinking/vision — mechanical work + second-opinion reviews only, never sole reviewer of subtle changes; local fan-out capped at 1–2 (one GPU).

## 10. Attribution & licensing

Retain `LICENSE` (MIT, © 2026 Haik Decie) verbatim; add our copyright line and a NOTICE; credit upstream in About/README. Brand strings are renamed, never routed through `t()`.

## 11. Next step

On approval, generate the detailed **implementation plan** (writing-plans) starting with FND + STAB, then execute the critical path.
