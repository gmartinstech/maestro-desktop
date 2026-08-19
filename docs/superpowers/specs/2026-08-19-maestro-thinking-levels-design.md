# Thinking-level support for Maestro gateway models

**Date:** 2026-08-19
**Status:** Approved, ready for implementation

## Problem

Maestro Studio already has a complete, working thinking/reasoning-effort pipeline for
models reached directly via Anthropic, Codex, or Gemini-CLI subscriptions/API keys:
`AgentSession.thinking_level` (`off|low|medium|high|auto`), a per-chat
`ThinkingLevelControl.tsx` dropdown, a global default in Settings
(`GeneralAgentDefaults.tsx`), and backend injection via `inject_thinking_options()`
in `backend/apps/agents/manager/run/run_options_helpers.py`.

The four Maestro gateway models — `maestro`, `maestro-fast`, `maestro-ultra`,
`maestro-code`, served by MartinsTech's own OpenAI-compatible gateway at
`https://llm.martinstech.net/v1` — have **no thinking-level support at all**:

- `MaestroModel` (`backend/apps/settings/maestro.py:30`) has no `reasoning` field.
- Custom-provider model entries (how Maestro models reach the picker) hardcode
  `"reasoning": False` in `find_builtin_model()`
  (`backend/apps/agents/providers/registry.py:191`), so `ThinkingLevelControl.tsx`
  never renders for them (it gates on `currentModel?.reasoning`).
- `inject_thinking_options()` only branches on
  `api_type in ("anthropic", "openai", "codex")` — there is no `"custom"` branch,
  so nothing would be sent even if the flag were flipped on.

This is a real, already-documented pain point, not just a missing nicety: the
comment in `maestro.py` explaining why `maestro-fast` (not `maestro`) is the
default model says plain `maestro` (`deepseek-v4-flash`) took 8.44s against
`maestro-fast`'s 1.49s on an identical trivial prompt, "because it spends most
of its budget on reasoning tokens before emitting any content." Users currently
have no way to turn that off.

## What the gateway actually is (verified against source)

`provedor-ia` (the gateway's own repo, `~/provedor-ia` on the `cloudona` host) is
a small Java reverse proxy in front of **Ollama Cloud**. `config.yaml` aliases:

- `maestro` → `deepseek-v4-flash:0731-cloud`
- `maestro-fast` → `nemotron-3-nano:30b-cloud`
- `maestro-ultra` → `deepseek-v4-pro:cloud` ("deep reasoning" per the config comment)
- `maestro-code` → `kimi-k2.7-code:cloud`

`Proxy.java`'s `send()` forwards the request body as raw bytes
(`HttpRequest.BodyPublishers.ofByteArray(body)`). The only in-place mutation
anywhere in the request pipeline (`Main.java`, around the `POST chat/generate`
handler) is rewriting the JSON body's `model` field from the mask name to the
real backend tag before the fallback/retry loop. No other field is inspected,
stripped, or rewritten. `provedor-ia` itself has zero reasoning/thinking-related
code — it doesn't need any, because it never looks at that field.

Ollama's API (both native and its OpenAI-compatible `/v1/*` surface) already
supports controlling reasoning per-request for models that support it (`think`
natively, `reasoning_effort` on the OpenAI-compatible surface), and the
DeepSeek-V4 family in particular is reasoning-capable. Because `provedor-ia` is
a raw passthrough, **the gateway needs no code changes** — a correctly shaped
`reasoning_effort` field in the outbound request will reach Ollama untouched.

The one thing this does not resolve, and cannot be resolved by reading source:
whether **9Router** (external, not vendored in this repo, pinned at 0.3.60)
forwards the Anthropic-shaped `effort` field the same way for a generic
`cp-*` custom node as it already does for its built-in `openai`/`codex` node
types. That must be verified empirically during implementation.

## Design

### 1. Data model — `backend/apps/settings/maestro.py`

Add `reasoning: bool = True` to `MaestroModel`, and set it explicitly on all four
`MAESTRO_MODELS` entries. `apply_maestro_defaults.py:74` already does
`m.model_dump() for m in models` when mirroring these into
`CustomProvider.models`, so the flag flows through with no further plumbing.

`maestro_catalog.py`'s `parse_catalog()` (used for models the gateway reports
that aren't in the hand-kept list) also gets `reasoning=True` on its synthesized
rows — anything served off this Ollama-backed gateway is presumptively
reasoning-capable.

### 2. Registry lookup — `backend/apps/agents/providers/registry.py`

`find_builtin_model()` hardcodes `"reasoning": False` for every synthesized
`custom/<slug>/<model>` entry (line ~191) and has no way to look up the real
value, since it doesn't take `settings`. Give it an optional
`settings: AppSettings | None = None` parameter (backward-compatible default;
mirrors the pattern `get_context_window()` already uses) and look up the
matching row in `cp.models` for its `reasoning` flag, defaulting to `False`
when absent or when `settings` isn't passed. This preserves current behavior
for arbitrary user-added custom providers that don't set the field, and for
every other existing call site of `find_builtin_model()` (8 call sites besides
the one below; none of them need to change).

Only `list_models` in `backend/apps/agents/agents.py:561` (the endpoint that
populates the model picker) needs to actually pass `settings` through, since
that's the only caller whose result reaches the frontend's `reasoning` flag.

### 3. Param injection — `backend/apps/agents/manager/run/run_options_helpers.py`

Extend `inject_thinking_options()`'s
`elif api_type in ("openai", "codex"):` to include `"custom"`.

Additionally, send an explicit disable value on `level == "off"`
(`options_kwargs["effort"] = "none"`) instead of omitting the parameter, which
is what the `openai`/`codex` branch currently does for every level except
low/medium/high. This mirrors the existing (currently dead) convention in
`thinking_params_for.py` (`{"reasoning": {"effort": "none"}}`) and is the part
that actually matters: an omitted param means "let the backend do its default
thing," and for `maestro`/`maestro-ultra` the default is slow. `auto` continues
to omit the param, unchanged, so nothing regresses for the app-wide default.

```python
elif api_type in ("openai", "codex", "custom"):
    if level == "off":
        options_kwargs["effort"] = "none"
    elif level in ("low", "medium", "high"):
        options_kwargs["effort"] = level
```

Existing per-model overrides (short-prompt force-off, `gc/gemini-3*` force-off)
are untouched and apply before this branch as they do today.

### 4. Frontend

No changes needed. `ThinkingLevelControl.tsx` and `GeneralAgentDefaults.tsx`
already key off `model.reasoning`, which becomes `true` for Maestro models once
steps 1–2 land and the picker endpoint threads `settings` through.

## Verification plan

- Unit-level: existing test patterns in `test_maestro_catalog.py` and
  `test_v2_invariants.py` (which already exercises `find_builtin_model` for
  `custom/...` values) extend naturally to assert `reasoning: True` on Maestro
  entries and the new `settings`-aware lookup.
- Live check (manual, backend running against a real Maestro token): send a
  turn with `thinking_level="off"` against `maestro` and confirm via
  `provedor-ia`'s access log / response latency that the reasoning-heavy path
  is actually skipped, not just that the request didn't error. This is the
  step that confirms or refutes the 9Router `cp-*` forwarding risk called out
  above.
- If 9Router does not forward `effort` correctly for `cp-*` nodes: fall back to
  setting `reasoning_effort` directly in the outbound JSON body at whatever
  point in the custom-provider dispatch path constructs it (not yet identified
  in this design — needs its own quick investigation during implementation,
  since 9Router's own internals aren't in this repo).
- If a specific backend model 400s on a given level (e.g. `nemotron-3-nano` on
  a graded effort it doesn't support): handle with a narrow per-model
  conditional in `inject_thinking_options`, the same pattern already used for
  Fable 5 and `gc/gemini-3*`.

## Out of scope

- Any change to `provedor-ia` / the gateway itself — verified unnecessary.
- Any change to 9Router — only pursue if the live check above shows it's
  actually needed.
- Reworking the thinking-level enum or UI — reusing the existing
  off/low/medium/high/auto control as-is, per explicit decision.
