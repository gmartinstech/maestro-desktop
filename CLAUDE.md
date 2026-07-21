# Maestro Studio — agent guide

**Resuming / new machine? Read `docs/HANDOFF.md` first.**

Fork of openswarm-ai/openswarm. Electron + React/TS (frontend/) + FastAPI/Python (backend/) + bundled 9Router (Node).

## The one command
`npm run verify` — build + lint + typecheck + tests + golden smoke + call-home check. Green = safe to merge.

## Rules
- Never call *.openswarm.com. Models go through provedor-ia (https://llm.martinstech.net/v1).
- Retain LICENSE (© Haik Decie). Brand = Maestro Studio; appId net.martinstech.maestro.studio.
- Small diffs. One ticket per branch/worktree. A different-vendor model (or human) reviews before merge.
- Deterministic tests use MAESTRO_MOCK_AGENT=1 (no keys, no tokens).

## Where things live
- Providers/registry: backend/apps/agents/providers/registry.py
- Provider env adapter: backend/apps/agents/manager/configure_provider_env.py
- Agent loop: backend/apps/agents/manager/run/TurnRunner.py ; MockAgent: backend/apps/agents/manager/MockAgent.py
- Modes/Workflows/Skills/Tools: backend/apps/{modes,workflows,skills,tools_lib}
- Branding tokens: frontend/src/shared/styles/claudeTokens.ts
- Cloud couplings to remove: electron/main.js (feed/analytics/affiliate), backend/apps/{auth,subscription}
