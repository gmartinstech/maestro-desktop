# OSR — Remove all OpenSwarm references

**Goal:** Zero `openswarm` tokens in the tree except the legally-required MIT attribution.
Provider migrates from `api.openswarm.com` to provedor-ia (`https://llm.martinstech.net/v1`).

**Baseline:** 363 files, ~441 bare `openswarm` tokens (`git grep -ic openswarm -- . ':!node_modules'`).

## Naming contract (deterministic — do not improvise)

| From | To |
|---|---|
| `openswarm` (identifier/dir/package) | `maestro` |
| `OPENSWARM_` (env var) | `MAESTRO_` |
| `OpenSwarm` (display / class / type) | `Maestro` |
| `.openswarm` (on-disk dir) | `.maestro` |
| `openswarm-ai/openswarm` | `gmartinstech/maestro-desktop` |
| `https://api.openswarm.com` (default proxy) | `https://llm.martinstech.net/v1` |
| `window.openswarm_app`, `window.__openswarm_store__` | `window.maestro_app`, `window.__maestro_store__` |
| IPC channels `openswarm-*` | `maestro-*` |
| `openswarm-pro`, `isOpenSwarmPro`, `OpenSwarmProCard` | **deleted**, not renamed |

`MAESTRO_` is the established prefix (`MAESTRO_MOCK_AGENT`, `MAESTRO_TELEMETRY_URL`).

## DO NOT TOUCH

- `LICENSE` — © Haik Decie, retained verbatim.
- The MIT attribution sentence in `NOTICE` and the `README.md` provenance line
  ("fork of Open Swarm, https://github.com/openswarm-ai/openswarm"). Required by MIT.
  Everything *else* in README/NOTICE gets debranded.
- `node_modules/`, `backend/mcp-bundles/**/dist/**` and any vendored third-party bundle.
- `docs/plans/*.md` and `docs/specs/*.md` historical records — these describe past work;
  leave their prose alone. (This plan file included.)

## Phase 0 — delete dead OpenSwarm features (sequential, first)

Deleting shrinks the rename surface, so this runs before any rename.

- `backend/apps/auth/` and `backend/apps/subscription/` (+ their routers' registration in
  `backend/main.py`, `backend/auth.py`).
- `openswarm-edge/` entirely (Dockerfile, app, fly.toml, requirements.txt, tests).
- Frontend: `frontend/src/app/pages/Settings/sections/subscription/OpenSwarmProCard.tsx`,
  `frontend/src/app/components/overlays/PlanPicker.tsx`,
  `frontend/src/shared/subscription/checkout.ts` (Stripe), and their imports/usages.
- Free-trial + Pro settings fields: `openswarm_subscription_plan`, `_subscription_expires`,
  `free_trial_token`, `sync_openswarm_pro_as_claude`.
- Tests for the above: `backend/tests/test_auth_router.py`, `test_free_trial.py`,
  and the Pro/subscription cases inside `test_settings_*` / `test_v2_invariants.py`.

Leave a working app: any UI entry point that pointed at PlanPicker/Pro must be removed,
not left dangling.

## Phase 1 — rename (3 parallel slices, disjoint file sets)

### 1A. Backend (`backend/**`, excluding vendored dist)
Apply the contract. Special care:
- `backend/apps/settings/models.py` field renames + `settings.py` allowlists/redaction sets.
- **Settings migration** — extend `migrate_legacy_fields` in `backend/apps/settings/store.py:25`
  to map every old `openswarm_*` key to its `maestro_*` name (it already does
  `openswarm_auth_token`→`openswarm_bearer_token`; chain onto that so two-generation
  upgrades work).
- **On-disk dir migration** — `~/.openswarm` → `~/.maestro`. Add a one-time move-if-exists
  (or read-fallback) so existing workspaces, caches and `terminal.log` survive. Touches
  `browser_save.py`, `browser_agent_mcp_server.py`, `AgentLaunch.py`, `prompt_context.py`,
  `view_builder_templates.py`, `outputs/runtime.py`, `cap_tool_result.py`.
- Default proxy URL → provedor-ia in `credentials.py`, `agents.py:559`,
  `proxy/anthropic_proxy.py:356`, `service/client.py:37`, `tools_lib/oauth_config.py`,
  `discord_mcp_shim/server.py:18`, and drop the openswarm.com CORS origins in `main.py:90-91`.
- `backend/apps/outputs/webapp_template/**` is a vendored snapshot we ship — rename it too
  (it is ours now), and update `scripts/fetch-webapp-template.sh` patches to match.
- Agent-facing skill docs (`app_builder_skill.md`, `swarm_debug_skill.md`) reference
  `.openswarm/terminal.log` — these are runtime instructions, must stay in sync.

### 1B. Electron + frontend (`electron/**`, `frontend/**`)
Apply the contract. The three-way contract must stay consistent:
`electron/preload.js` (bridge) ↔ `frontend/src/types/electron.d.ts` (types) ↔ all renderer
consumers. Same for IPC channel strings between `electron/main.js` `ipcMain` handlers and
every `invoke`/`send` call site. `__openswarm_import_meta_url__` is a build-time shim —
check `vite.config.ts` / esbuild define blocks, not just source.
`frontend/src/shared/config.ts:14` default proxy → provedor-ia.

### 1C. Scripts, CI, e2e, top-level docs (`scripts/**`, `e2e/**`, `.github/**`, `*.md`)
Apply the contract. Special care:
- `openswarm.exe` / `openswarm-setup-x64.exe` — do **not** blind-rename. Read the actual
  artifact names electron-builder produces from `electron/package.json` build config and
  make the scripts match reality.
- `electron/package.json` `squirrelWindows.iconUrl` still pulls the icon from
  `openswarm-ai/openswarm` — repoint to our repo.
- `scripts/build-app.sh:427`, `scripts/build-app-win.ps1:460` ship-time OAuth/proxy defaults.
- `scripts/ci/verify-network.js:86`, `verify-preflight.js:56` probe api.openswarm.com —
  repoint the reachability probe at provedor-ia.
- `scripts/check-callhome.mjs` — make sure its blocklist still catches openswarm hosts
  after the rename (the guard must not be renamed away).
- `AGENTS.md` / `CLAUDE.md` "Fork of openswarm-ai/openswarm" line: keep the factual
  provenance, drop everything else.

## Phase 2 — verify (sequential, after all slices)

1. `git grep -ic openswarm -- . ':!node_modules' ':!backend/mcp-bundles' ':!docs/plans' ':!docs/specs' ':!LICENSE' ':!NOTICE'` → expect only the README/AGENTS/CLAUDE provenance lines.
2. `npm run verify` (build + lint + typecheck + tests + golden smoke + call-home check) → green.
3. `npm run check:callhome` → exit 0.
4. Launch the app and confirm: settings load (migration path), an agent turn runs under
   `MAESTRO_MOCK_AGENT=1`, and the app-builder creates a workspace under `~/.maestro`.
