# Maestro Studio — agent guide

**Resuming / new machine? Read `docs/HANDOFF.md` first.**

Fork of openswarm-ai/openswarm. Electron + React/TS (frontend/) + FastAPI/Python (backend/) + bundled 9Router (Node).

## The one command
`npm run verify` — build + lint + typecheck + tests + golden smoke + call-home check. Green = safe to merge.

## Rules
- Never call *.openswarm.com. Models go through provedor-ia (https://llm.martinstech.net/v1).
- Retain LICENSE (© Haik Decie). Brand = Maestro Studio; appId net.martinstech.maestro.studio.
- Small diffs. One ticket per branch/worktree. A different-vendor model (or human) reviews before merge.
- MAESTRO_MOCK_AGENT=1 makes an agent turn stream a deterministic synthetic reply with no key,
  CLI or network. It is for the packaged app and the golden e2e smoke. Do NOT set it for the
  backend suite: those tests drive the real loop, and the mock starves the WS assertions.
  Run backend tests with the flag UNSET (baseline: 6 pre-existing failures, 1703 passing).

## Where things live
- Providers/registry: backend/apps/agents/providers/registry.py
- Provider env adapter: backend/apps/agents/manager/configure_provider_env.py
- Agent loop: backend/apps/agents/manager/run/TurnRunner.py ; MockAgent: backend/apps/agents/manager/MockAgent.py
- Modes/Workflows/Skills/Tools: backend/apps/{modes,workflows,skills,tools_lib}
- Branding tokens: frontend/src/shared/styles/claudeTokens.ts
- Cloud couplings: electron/main.js (update feed) — the auth/subscription/Pro surface and the upstream call-home are already deleted (OSR Phase 0 + DET).
