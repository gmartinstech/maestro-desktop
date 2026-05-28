# backend/CLAUDE.md

FastAPI orchestrator. Entry: `backend/main.py` (uvicorn `:8324`, REST `/api/*`, WS `/ws/*`, Swagger `/docs`). See root `CLAUDE.md` for repo-wide constraints.

## Coding precedences

Full precedences live in root [CLAUDE.md](../.claude/CLAUDE.md). Always: **understand the end goal before coding** (what does the user actually need?); **reuse before you write** (grep existing routes / SubApps / helpers, most needs already have one); ~300 LOC/file ceiling; downward-tree imports; comments only when necessary (the non-obvious WHY), one line each; **no em-dashes or en-dashes anywhere** (`—`, `–`); say IDK to the user when you don't know, then go find out; test after meaningful changes; weigh speed, efficiency, robustness, UX, and security on every change.

## Run / test

- Dev: `bash backend/run.sh` (creates `.venv/`, installs `requirements.txt`, runs uvicorn with `--reload`).
- Tests: `pip install -r requirements-dev.txt && pytest tests/`.
- `requirements-dev.txt` is deliberately kept out of `requirements.txt` so `pytest` etc. don't ship in the production DMG. Sync both files when adding deps that need to exist in either place.

## Layout

- `apps/agents/`: agent orchestration, WS manager, MCP plumbing.
  - `providers/registry.py`: resolves primary + aux models across Anthropic, OpenAI, Google, OpenRouter, and custom OpenAI-compatible providers. **Always go through here; never hardcode a model ID.**
  - `mcp_preflight.py`: vague-prompt classifier that surfaces the one-click MCP-connect modal.
  - `mcp_meta_server.py`, `mcp_registry.py`: MCP discovery + registry.
  - `9router_gpt5_patch.js`: patch loaded into 9router to translate OpenAI `max_tokens` semantics.
- `apps/nine_router.py`: supervises the 9router subprocess on `:20128`.
- `apps/subscription/router.py`: OAuth + Stripe callbacks for openswarm-pro signup.
- `apps/outputs/`: view renderer (HTML/JS/CSS iframes, sandboxed Python execution).
- `auth.py`: per-install bearer token. **Generated BEFORE the HTTP bind** so the Electron shell can read it from disk; don't reorder.

## MCP gate

- Dispatch flows through `_build_mcp_servers`. This is the only place MCP tools become reachable.
- `session.active_mcps` defaults to empty; the user opts in via `MCPSearch` + `MCPActivate` (HITL).
- New MCP-related code path? It must respect this gate. Don't add side channels.
- Suggestions surfaced to users must come from the vetted/default set, not the full upstream registry.

## Providers / models

- Primary model: per-session user choice, resolved by `providers.registry`.
- Aux model (preflight, classifier, summarizers): pick the **cheap tier of the user's configured provider**. Haiku for Anthropic, GPT-5-mini for OpenAI, Gemini Flash for Google, etc. Never hardcode Haiku.

## Dev vs production

What runs under `bash backend/run.sh` is not what ships in the DMG/EXE. Test the packaged build for any change touching the items below.

- **Python:** dev uses system Python 3 in `backend/.venv/` with `pip install -r requirements.txt`. Prod ships bundled standalone Python 3.13 with deps pre-installed; no venv at runtime.
- **Reload:** dev runs `uvicorn --reload` so module-level side effects re-fire on edit. Prod has no reload; module-level code runs exactly once at startup.
- **Imports / paths:** `__file__` and `Path(__file__).parent` resolve inside the packaged Python tree in prod. Avoid `cwd`-relative or working-dir-relative imports.
- **Pip / new deps:** add to `requirements.txt` (fully pinned). The packaged build snapshots deps at build time; runtime `pip install` is not available in prod.
- **Bearer token (`auth.py`):** generated before the HTTP bind so the Electron shell can read it from disk; this ordering is load-bearing in both dev AND prod. Don't reorder.
- **MCP bundles (`mcp-bundles/`):** vendored esbuild output. Production reads from the packaged tree; regenerate via the bundle script rather than editing.

## Common pitfalls

- New endpoint? Use a pydantic request/response model and `@typechecked`.
- Pinning matters; `requirements.txt` is fully pinned for reproducibility.
- Token middleware already scrubs bearer tokens from logs; don't re-add raw logging.
- MCP bundles in `mcp-bundles/` are esbuild output; regenerate via the bundle script rather than editing.
