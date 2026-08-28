# Maestro Studio — agent guide

Fork of openswarm-ai/openswarm. Electron + React/TS (frontend/) + FastAPI/Python (backend/) + bundled 9Router (Node).

## The one command
`npm run verify` — build + lint + typecheck + tests + golden smoke + call-home check. Green = safe to merge.

## Rules
- Never call *.openswarm.com. Models go through the Maestro provider (gateway: https://llm.martinstech.net/v1).
- Retain LICENSE (© Haik Decie). Brand = Maestro Studio; appId net.martinstech.maestro.studio.
- Small diffs. One ticket per branch/worktree. A different-vendor model (or human) reviews before merge.
- MAESTRO_MOCK_AGENT=1 makes an agent turn stream a deterministic synthetic reply with no key,
  CLI or network. It is for the packaged app and the golden e2e smoke. Do NOT set it for the
  backend suite: those tests drive the real loop, and the mock starves the WS assertions.
  Run backend tests with the flag UNSET. On a clean tree exactly 6 fail, and they are exactly
  the set `scripts/verify.mjs` deselects by name (Windows environment, not code) — so a failure
  that is NOT on that list is yours, and `npm run verify` deselects all 6 and must come back
  clean. No passing total is recorded here on purpose: it moves with every merge, went stale
  twice in three days, and answers "did I break something?" worse than the deselect list does.

## Where things live
- Providers/registry: backend/apps/agents/providers/registry.py
- Provider env adapter: backend/apps/agents/manager/configure_provider_env.py
- Agent loop: backend/apps/agents/manager/run/TurnRunner.py ; MockAgent: backend/apps/agents/manager/MockAgent.py
- Modes/Workflows/Skills/Tools: backend/apps/{modes,workflows,skills,tools_lib}
- Branding tokens: frontend/src/shared/styles/claudeTokens.ts
- Cloud couplings: electron/main.js (update feed) — the auth/subscription/Pro surface and the upstream call-home are already deleted (OSR Phase 0 + DET).
