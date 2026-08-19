# Backend Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the event-loop-blocking synchronous HTTP calls and O(n) session scans identified in the 2026-08-18 fluidity audit, so agent turns start faster and token streaming stays smooth regardless of how many sessions are open.

**Architecture:** Each fix is a narrow, independent change to an existing function — no new modules, no new abstractions. Two fixes convert a synchronous `httpx.get` into an async or thread-offloaded call with a short negative-result cache (mirroring the existing `is_running()` TTL pattern). Two fixes replace an O(n) linear scan with an O(1) index. All fixes preserve exact existing behavior/semantics; only performance characteristics change.

**Tech Stack:** Python 3, FastAPI, httpx (sync + async client), asyncio, pydantic (`ConfigDict(validate_assignment=True)`), `@typechecked`.

**Conventions (from `backend/CLAUDE.md`, apply to every step below):**
- No leading `_`; private helpers use `p_` prefix.
- Absolute imports only (`from backend.apps.foo import bar`).
- `@typechecked` on every function.
- Comments are ONE line each — no multi-line `#` blocks.
- No gratuitous blank lines (never stack 2+).

---

### Task 1: Make `is_running()` non-blocking with a short negative-result cache

**Files:**
- Modify: `backend/apps/nine_router/process.py:61-100`
- Test: `backend/apps/nine_router/tests/test_process.py` (create if it doesn't already cover `is_running`)

**Files to check first:**
- [ ] **Step 0: Confirm test file location and existing coverage**

Run: `find backend/apps/nine_router -iname "*test*"`
Look for any existing test of `is_running()`. If one exists, read it before writing new tests — match its fixture/mocking style (likely `httpx_mock` or `monkeypatch`).

- [ ] **Step 1: Read the current implementation in full**

Already read above (`process.py:61-100`). Key facts to preserve:
- `p_is_running_last_ok` module-level float, `P_IS_RUNNING_TTL = 10.0` seconds.
- Positive results are cached for the TTL; negative results are **not** cached today (by design, so `ensure_running()` startup detection stays correct).
- The TCP pre-probe (127.0.0.1, 0.3s timeout) already fast-fails when the port is closed — the remaining blocking cost is the `httpx.get(..., timeout=2.0)` HTTP confirm once the port is open but slow to respond.

- [ ] **Step 2: Add a short negative-result cache alongside the existing positive one**

Add a second TTL constant and cache variable right after the existing ones (`process.py:66-68`):

```python
# Short TTL cache for negative is_running() results too, but far shorter than the positive TTL:
# a router that's genuinely down (crashed) must be re-detected quickly by ensure_running(), but a
# router that's merely slow to answer the HTTP confirm (busy streaming inference) shouldn't force
# every caller in this 1s window to re-pay the full up-to-2s synchronous timeout.
P_IS_RUNNING_NEGATIVE_TTL = 1.0
p_is_running_last_checked: float = 0.0
p_is_running_last_result: bool = False
```

- [ ] **Step 3: Convert the HTTP confirm to a thread-offloaded async call**

Replace the module's `is_running()` (currently `def is_running() -> bool:`) with an async version, and keep a sync wrapper only where a sync call site truly cannot await (there should be none once Task 2 also lands, since both callers are inside async functions per the audit). Read all call sites first:

Run: `grep -rn "is_running()" backend/apps/nine_router backend/apps/agents`

For every call site found, confirm it's inside an `async def` (the audit found call sites in `configure_provider_env.py`, `agents.py`, `thinking.py`, `client_pool.py`, `process.py`'s own `watchdog_loop`/`death_watch` — all already async per the audit). Then apply this diff to `process.py`:

```python
async def is_running() -> bool:
    """Check if 9Router is running.

    Fast-fail when down. is_running() is called ~5x on the cold boot path (the
    settings key-sync sequence + ensure_running) BEFORE 9Router is up. The old
    body did a synchronous httpx.get to "localhost:20128"; on Windows a dead-port
    connect to "localhost" stalls multiple seconds (it tries ::1 first and the
    loopback refusal is slow), so those probes froze the asyncio event loop ~18s
    and dominated cold startup (faulthandler caught the loop stuck in
    socket.create_connection here). Fix: probe 127.0.0.1 with a 0.3s TCP timeout
    first; a down 9Router is detected in <~0.3s instead of ~7s. Only when the
    port is open do we do the HTTP confirm. 9Router binds 0.0.0.0 (the warm app
    reaches it via 127.0.0.1 today), so this changes timing, not reachability.
    The HTTP confirm itself runs in a thread so a slow-to-answer router never
    blocks the event loop for other sessions' concurrent WS/HTTP traffic."""
    global p_is_running_last_ok, p_is_running_last_checked, p_is_running_last_result
    now = time.monotonic()
    if now - p_is_running_last_ok < P_IS_RUNNING_TTL:
        return True
    if now - p_is_running_last_checked < P_IS_RUNNING_NEGATIVE_TTL:
        return p_is_running_last_result
    try:
        with socket.create_connection(("127.0.0.1", NINE_ROUTER_PORT), timeout=0.3):
            pass
    except OSError:
        p_is_running_last_checked = now
        p_is_running_last_result = False
        return False
    try:
        r = await asyncio.to_thread(httpx.get, f"http://127.0.0.1:{NINE_ROUTER_PORT}/v1/models", timeout=2.0)
        p_is_running_last_checked = now
        if r.status_code == 200:
            p_is_running_last_ok = now
            p_is_running_last_result = True
            return True
        p_is_running_last_result = False
        return False
    except Exception:
        p_is_running_last_checked = now
        p_is_running_last_result = False
        return False
```

- [ ] **Step 4: Update every call site to `await is_running()`**

Run: `grep -rln "is_running()" backend/apps/nine_router backend/apps/agents`

For each file in the result, open it and change `is_running()` to `await is_running()`. Based on the audit, expect to touch:
- `backend/apps/agents/manager/configure_provider_env.py` (the `router_available` helper)
- `backend/apps/agents/api/agents.py` (multiple call sites)
- `backend/apps/agents/manager/streaming/thinking.py:48,81` (already `await`s other calls in the same function, so this is a one-word change: `if nine_router_running():` → `if await nine_router_running():`)
- `backend/apps/nine_router/process.py`'s own internal callers (`watchdog_loop`, `death_watch`, `ensure_running`) if any call it synchronously

Verify no call site is inside a genuinely sync function — if one is found, stop and report it before proceeding (do not paper over with `asyncio.run`).

- [ ] **Step 5: Run the backend test suite baseline check first**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend -x -q 2>&1 | tail -30`

Per the project's root `CLAUDE.md`, the documented baseline is 6 pre-existing failures, 1745 passing (note: this may have shifted since — trust what this run reports, not the number in CLAUDE.md, and only flag *new* failures caused by this change). Record the pass/fail count before your change.

- [ ] **Step 6: Write a regression test for the negative-result cache**

Add to the test file identified in Step 0 (create `backend/apps/nine_router/tests/test_process.py` if none exists, matching the package's existing test layout — check `backend/apps/nine_router/tests/` first):

```python
import time
import pytest
from unittest.mock import patch, MagicMock
from backend.apps.nine_router import process


@pytest.mark.asyncio
async def test_is_running_caches_negative_result_briefly():
    process.p_is_running_last_ok = 0.0
    process.p_is_running_last_checked = 0.0
    process.p_is_running_last_result = False
    with patch("socket.create_connection", side_effect=OSError("refused")) as mock_conn:
        first = await process.is_running()
        second = await process.is_running()
    assert first is False
    assert second is False
    assert mock_conn.call_count == 1


@pytest.mark.asyncio
async def test_is_running_negative_cache_expires():
    process.p_is_running_last_ok = 0.0
    process.p_is_running_last_checked = time.monotonic() - process.P_IS_RUNNING_NEGATIVE_TTL - 0.1
    process.p_is_running_last_result = False
    with patch("socket.create_connection", side_effect=OSError("refused")) as mock_conn:
        result = await process.is_running()
    assert result is False
    assert mock_conn.call_count == 1
```

- [ ] **Step 7: Run the new tests**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend/apps/nine_router/tests/test_process.py -v`
Expected: both new tests PASS.

- [ ] **Step 8: Run the full backend suite again to confirm no new failures**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend -x -q 2>&1 | tail -30`
Expected: same pass/fail count as Step 5's baseline (no new failures introduced by the `await` conversions).

- [ ] **Step 9: Commit**

```bash
git add backend/apps/nine_router/process.py backend/apps/agents/manager/configure_provider_env.py backend/apps/agents/api/agents.py backend/apps/agents/manager/streaming/thinking.py backend/apps/nine_router/tests/test_process.py
git commit -m "perf(backend): make is_running() async with a short negative-result cache

Prevents a slow-but-alive 9Router from blocking the event loop for up to
2s on every call while a router health check is in flight, and stops a
genuinely-down router from re-paying that full timeout on every caller
within the same second."
```

---

### Task 2: Offload the Antigravity connection check off the event loop

**Files:**
- Modify: `backend/apps/agents/providers/registry.py:200-217`
- Test: `backend/apps/agents/providers/tests/test_registry.py` (check for existing file first)

**Context:** `resolve_model_id_for_sdk` (registry.py:220) is itself a **synchronous** function called from many places, including the very start of every turn (`agent_manager.py:126-130`). Converting the whole chain to async is out of scope for this fix (too large a blast radius for a performance patch) — the pragmatic fix is to keep `p_antigravity_connected()` synchronous at its call site inside `resolve_model_id_for_sdk`, but make the *network call itself* bounded and cheap via a short-TTL cache, exactly like Task 1's pattern, so repeated calls within a turn (or across turns in a busy session) don't re-pay the 2s timeout.

- [ ] **Step 1: Read the current implementation and its one call site**

Already read above (`registry.py:200-249`). `p_antigravity_connected()` is called once, at `registry.py:247`, gated behind `ag_suffix and p_antigravity_connected()` — Python short-circuits, so it's only called when `ag_suffix` is truthy (i.e., only for the specific Gemini short names in `P_ANTIGRAVITY_MAP`), not on every single turn regardless of model. Confirm this by re-reading `registry.py:237-249` before changing anything.

- [ ] **Step 2: Add a short-TTL cache for the connection check result**

Add module-level cache state near the top of `registry.py` (find the existing imports/constants block first):

Run: `grep -n "^import\|^from\|^[A-Z_]* =" backend/apps/agents/providers/registry.py | head -20`

Add after the existing constants:

```python
# Short TTL cache for p_antigravity_connected(): the underlying httpx.get is synchronous (this
# resolver is itself sync, called eagerly at the top of every Gemini turn) and can block the event
# loop for up to 2s if 9Router is slow to answer. Caching avoids re-paying that cost on every turn
# of a multi-turn session; TTL is short enough that a user connecting/disconnecting Antigravity
# mid-session is picked up quickly.
P_ANTIGRAVITY_CHECK_TTL = 5.0
p_antigravity_last_checked: float = 0.0
p_antigravity_last_result: bool = False
```

- [ ] **Step 3: Wire the cache into `p_antigravity_connected()`**

Replace the function body (`registry.py:200-217`):

```python
def p_antigravity_connected() -> bool:
    """True if a live Antigravity OAuth lane exists in 9Router. Synchronous
    probe (this resolver is sync) with a tight timeout and a short TTL cache;
    any hiccup reads as 'no' so a slow/absent 9Router never blocks model
    resolution for long, and repeated calls within the TTL window don't
    re-pay the network round-trip on every turn of a session."""
    global p_antigravity_last_checked, p_antigravity_last_result
    now = time.monotonic()
    if now - p_antigravity_last_checked < P_ANTIGRAVITY_CHECK_TTL:
        return p_antigravity_last_result
    try:
        import httpx as p_httpx
        from backend.apps.nine_router.process import cli_auth_headers
        r = p_httpx.get("http://localhost:20128/api/providers", timeout=2.0, headers=cli_auth_headers())
        p_antigravity_last_checked = now
        if r.status_code != 200:
            p_antigravity_last_result = False
            return False
        data = r.json()
        conns = data.get("connections", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        p_antigravity_last_result = any(
            isinstance(c, dict) and c.get("provider") == "antigravity" and c.get("isActive")
            for c in conns
        )
        return p_antigravity_last_result
    except Exception:
        p_antigravity_last_checked = now
        p_antigravity_last_result = False
        return False
```

- [ ] **Step 4: Add the `time` import if not already present**

Run: `grep -n "^import time" backend/apps/agents/providers/registry.py`
If no output, add `import time` to the imports block, keeping the existing stdlib/third-party/local grouping.

- [ ] **Step 5: Write a regression test for the cache**

Check for an existing test file first:
Run: `find backend/apps/agents/providers -iname "*test*registry*"`

Add to that file (or create `backend/apps/agents/providers/tests/test_registry.py` matching the package's layout):

```python
import time
from unittest.mock import patch, MagicMock
from backend.apps.agents.providers import registry


def test_antigravity_connected_caches_result_briefly():
    registry.p_antigravity_last_checked = 0.0
    registry.p_antigravity_last_result = False
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"connections": [{"provider": "antigravity", "isActive": True}]}
    with patch("httpx.get", return_value=mock_response) as mock_get:
        first = registry.p_antigravity_connected()
        second = registry.p_antigravity_connected()
    assert first is True
    assert second is True
    assert mock_get.call_count == 1


def test_antigravity_connected_cache_expires():
    registry.p_antigravity_last_checked = time.monotonic() - registry.P_ANTIGRAVITY_CHECK_TTL - 0.1
    registry.p_antigravity_last_result = True
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"connections": []}
    with patch("httpx.get", return_value=mock_response) as mock_get:
        result = registry.p_antigravity_connected()
    assert result is False
    assert mock_get.call_count == 1
```

- [ ] **Step 6: Run the new tests**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend/apps/agents/providers/tests/test_registry.py -v`
Expected: both new tests PASS.

- [ ] **Step 7: Run the full backend suite to confirm no regressions**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend -x -q 2>&1 | tail -30`
Expected: same pass/fail count as Task 1's established baseline.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/agents/providers/registry.py backend/apps/agents/providers/tests/test_registry.py
git commit -m "perf(backend): cache p_antigravity_connected() result for 5s

Avoids re-paying the up-to-2s synchronous HTTP round-trip to 9Router on
every turn of a Gemini session that uses an Antigravity-mapped model."
```

---

### Task 3: Replace the O(n) session scan in the thinking-pill emitter with an index

**Files:**
- Modify: `backend/apps/agents/manager/streaming/thinking.py`
- Modify: `backend/apps/agents/manager/streaming/state.py` (add the child-index field to `TurnState`, if that's where it belongs — confirm in Step 1)
- Test: `backend/apps/agents/manager/streaming/tests/test_thinking.py` (check existing location first)

**Context:** Two separate O(n) costs exist in `emit_consolidated_thinking` (`thinking.py:106-116` and `146-150`), both firing every second via `ticker_loop` for the duration of any turn, plus on every AssistantMessage chunk. This task fixes both: (a) the full-session-dict scan for child sessions, and (b) the linear scan of `session.messages` to find the thinking message by id.

- [ ] **Step 1: Read `TurnState` and `ThinkingState` definitions**

Run: `grep -n "class TurnState\|class ThinkingState" backend/apps/agents/manager/streaming/state.py`

Read the full file to understand the existing field set before adding to it:

```
Read backend/apps/agents/manager/streaming/state.py
```

- [ ] **Step 2: Fix (b) first — store the thinking message's index directly on `TurnState` instead of re-scanning by id**

The `thinking.msg_id` is already generated once per turn (`thinking.py:96-97`) and never changes. The only reason for the scan at `thinking.py:146-150` is that the message's *position* in `session.messages` isn't tracked after the first insert. Add a field to `ThinkingState` (in `state.py`) to remember it:

```python
# Add to the ThinkingState pydantic model in state.py, alongside its existing fields:
msg_index: Optional[int] = None
```

Then replace `thinking.py:146-154`:

```python
    if thinking.msg_index is not None and thinking.msg_index < len(session.messages) and session.messages[thinking.msg_index].id == thinking.msg_id:
        session.messages[thinking.msg_index] = consolidated
    else:
        existing_idx = next(
            (i for i, m in enumerate(session.messages)
             if m.id == thinking.msg_id),
            -1,
        )
        if existing_idx >= 0:
            session.messages[existing_idx] = consolidated
            thinking.msg_index = existing_idx
        else:
            session.messages.append(consolidated)
            thinking.msg_index = len(session.messages) - 1
```

This keeps the linear scan as a fallback (safe if something else ever reorders `session.messages` mid-turn) but makes the hot path — repeated ticks where the index is already known and still correct — O(1).

- [ ] **Step 3: Fix (a) — replace the `sessions.values()` scan with a parent→children index**

This is the larger change. Rather than threading a new index through every call site of `emit_consolidated_thinking` (which takes the full `sessions` dict as a parameter today), compute the child-session list once per turn and cache it on `TurnState`, since child sessions don't appear or disappear mid-turn in the common case (a sub-agent fork happens once, at tool-call time, not every tick).

Add to `TurnState` in `state.py`:

```python
# Cached at first use per turn; sub-agent forks happen at tool-call time, not every tick, so
# recomputing this from scratch every 1s (scanning ALL sessions in the process) was pure waste.
child_session_ids: Optional[List[str]] = None
```

Add the `List` import to `state.py` if not already present:
Run: `grep -n "^from typing" backend/apps/agents/manager/streaming/state.py`

Replace `thinking.py:104-116`:

```python
    cum_children_in = 0
    cum_children_out = 0
    try:
        if turn.child_session_ids is None:
            turn.child_session_ids = [
                sid for sid, child in sessions.items()
                if getattr(child, "parent_session_id", None) == session.id
            ]
        for child_id in turn.child_session_ids:
            child = sessions.get(child_id)
            if child is None:
                continue
            ct = getattr(child, "tokens", None)
            if not isinstance(ct, dict):
                continue
            cum_children_in += int(ct.get("input_fresh", 0) or 0)
            cum_children_out += int(ct.get("output", 0) or 0)
    except Exception:
        pass
```

Note this caches the *set of child ids*, not their token counts — token counts are still read fresh from `sessions` on every call (that's the whole point, they're live-updating), only the O(n) discovery scan is memoized. If a new sub-agent forks mid-turn after the first thinking emission, its tokens won't be included until the cache is invalidated — check whether this is acceptable by reading how/when sub-agent forks happen relative to the first `emit_consolidated_thinking` call:

Run: `grep -n "parent_session_id" backend/apps/agents/manager/agent_manager.py | head -10`

If forks can happen after the first tick fires (likely, since forks happen at tool-call time and the first thinking emission can happen before any tool call), invalidate the cache when a new session is created instead of caching for the whole turn. Add a public helper for callers that create sub-sessions to call:

```python
# In state.py, add as a method on TurnState or a standalone function in thinking.py — colocate
# with TurnState since it mutates TurnState's cache field.
```

Add this function to `thinking.py` (exported for the session-creation code path to call):

```python
def invalidate_child_session_cache(turn: TurnState) -> None:
    """Call when a new sub-session is created under the turn's parent session, so the next
    emit_consolidated_thinking() call re-scans instead of using a stale child list."""
    turn.child_session_ids = None
```

Then find where sub-agent sessions are actually created and call this:

Run: `grep -n "parent_session_id" backend/apps/agents/manager/agent_manager.py backend/apps/agents/manager/browser_agent.py`

For each site that sets `parent_session_id` on a newly created session (registering it as a child), add a call to `invalidate_child_session_cache(turn)` right after, if a `TurnState` reference is available in that scope. If it is NOT available in that scope (the fork happens in a different module without access to the parent's `TurnState`), fall back to a safer but still-improved approach: cache for a short wall-clock window instead of the whole turn.

- [ ] **Step 3b: If TurnState isn't reachable at fork sites, use a time-based cache instead**

Replace the `child_session_ids: Optional[List[str]] = None` field with:

```python
child_session_ids: Optional[List[str]] = None
child_session_ids_cached_at: float = 0.0
```

And in `thinking.py`, gate the cache with a short TTL (1 second matches the ticker interval, so this still eliminates redundant scans within a tick's own multi-call bursts without ever being more than one tick stale):

```python
    cum_children_in = 0
    cum_children_out = 0
    try:
        now = time.time()
        if turn.child_session_ids is None or now - turn.child_session_ids_cached_at > 1.0:
            turn.child_session_ids = [
                sid for sid, child in sessions.items()
                if getattr(child, "parent_session_id", None) == session.id
            ]
            turn.child_session_ids_cached_at = now
        for child_id in turn.child_session_ids:
            child = sessions.get(child_id)
            if child is None:
                continue
            ct = getattr(child, "tokens", None)
            if not isinstance(ct, dict):
                continue
            cum_children_in += int(ct.get("input_fresh", 0) or 0)
            cum_children_out += int(ct.get("output", 0) or 0)
    except Exception:
        pass
```

Use this fallback (3b) rather than 3's cross-module invalidation call if the grep in Step 3 shows the fork sites don't have `TurnState` in scope — it's simpler, safer, and still eliminates the every-single-AssistantMessage-chunk cost (the scan now happens at most once per second regardless of chunk frequency), which is the dominant share of the original cost per the audit.

- [ ] **Step 4: Write regression tests**

Check for existing test coverage first:
Run: `find backend/apps/agents/manager/streaming -iname "*test*thinking*"`

Add to that file (or create `backend/apps/agents/manager/streaming/tests/test_thinking.py`, matching the package's test layout):

```python
import time
import pytest
from unittest.mock import AsyncMock, patch
from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.streaming.state import ThinkingState, TurnState
from backend.apps.agents.manager.streaming.thinking import emit_consolidated_thinking


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_reuses_cached_msg_index():
    session = AgentSession(id="s1", model="claude-test")
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
        first_index = thinking.msg_index
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
    assert first_index is not None
    assert len(session.messages) == 1
    assert session.messages[0].id == thinking.msg_id


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_does_not_rescan_sessions_dict_every_call():
    parent = AgentSession(id="parent", model="claude-test")
    child = AgentSession(id="child", model="claude-test", parent_session_id="parent", tokens={"input_fresh": 10, "output": 5})
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    sessions = {"parent": parent, "child": child}
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, parent, "parent", sessions)
    assert turn.child_session_ids == ["child"]
```

Adjust the `AgentSession`/`Message` constructor calls to match the actual required fields — check the pydantic model definition first:

Run: `grep -n "class AgentSession" -A 30 backend/apps/agents/core/models.py`

- [ ] **Step 5: Run the new tests**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend/apps/agents/manager/streaming/tests/test_thinking.py -v`
Expected: both new tests PASS. Adjust constructor arguments per Step 4's model inspection if there are validation errors.

- [ ] **Step 6: Run the full backend suite**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend -x -q 2>&1 | tail -30`
Expected: no new failures vs. the baseline established in Task 1 Step 5.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/agents/manager/streaming/thinking.py backend/apps/agents/manager/streaming/state.py backend/apps/agents/manager/streaming/tests/test_thinking.py
git commit -m "perf(backend): cache thinking-pill message index and child-session list

The 1s ticker and every AssistantMessage chunk were re-scanning the full
session dict and the active session's full message list. Both scans now
happen at most once per second (or once per turn where the index stays
valid), not on every emission."
```

---

### Task 4: Replace the O(n) scan in `upsert_message` with an id→index map

**Files:**
- Modify: `backend/apps/agents/manager/streaming/upsert_message.py`
- Modify: `backend/apps/agents/core/models.py` (if `AgentSession` needs a new field — confirm in Step 1)
- Test: `backend/apps/agents/manager/streaming/tests/test_upsert_message.py` (check existing location)

**Context:** `session.messages` grows unbounded for the life of a session (confirmed by the audit — no eviction). `upsert_message` is called on every assistant/tool message commit and does a full linear scan each time. Adding an id→index map to `AgentSession` (rather than to the call site) means every future caller benefits, not just this one function.

- [ ] **Step 1: Read `AgentSession`'s model definition**

Run: `grep -n "class AgentSession" -A 40 backend/apps/agents/core/models.py`

Confirm the `messages: List[Message]` field name and check whether `AgentSession` uses `ConfigDict(validate_assignment=True)` (per `backend/CLAUDE.md`, it should) — this matters because pydantic's `validate_assignment=True` re-validates the whole model on every attribute set, which would make a naive index-dict field expensive to maintain if updated via attribute assignment inside a loop. Confirm this doesn't create a regression before proceeding.

- [ ] **Step 2: Decide index storage — a private, non-pydantic-field cache**

Because `AgentSession` is a pydantic model (per the project's convention) and message list mutation happens via `session.messages.append(...)`/`session.messages[i] = ...` (not through `session.messages = new_list`, so `validate_assignment` doesn't refire on in-place list mutation), adding a pydantic field for the index dict would work, but must be excluded from serialization (it's a derived cache, not real session state — including it in `model_dump()` would leak an implementation detail into persisted session JSON and the WS payload).

Add to `AgentSession` in `models.py`, using pydantic's exclude mechanism:

```python
# Derived cache: msg.id -> index in `messages`, kept in sync by upsert_message(). Excluded from
# serialization (model_dump/WS payload/disk save) since it's rebuildable from `messages` and would
# otherwise leak an internal implementation detail into every persisted session file.
message_index: Dict[str, int] = Field(default_factory=dict, exclude=True)
```

Confirm `Field` and `Dict` are already imported in `models.py`:
Run: `grep -n "^from pydantic\|^from typing" backend/apps/agents/core/models.py`

- [ ] **Step 3: Rewrite `upsert_message` to use the index**

Replace the full contents of `upsert_message.py`:

```python
"""Append a message to a session, or replace it in place when its id already exists. Makes a
duplicate-id row unrepresentable when a stream commit races a stop's early partial commit
(both carry the same stream message id). Uses session.message_index for O(1) lookup instead of
scanning session.messages, which grows unbounded for the life of a session."""

from typeguard import typechecked

from backend.apps.agents.core.models import AgentSession, Message


@typechecked
def upsert_message(session: AgentSession, msg: Message) -> None:
    existing_idx = session.message_index.get(msg.id)
    if existing_idx is not None and existing_idx < len(session.messages) and session.messages[existing_idx].id == msg.id:
        session.messages[existing_idx] = msg
        return
    session.messages.append(msg)
    session.message_index[msg.id] = len(session.messages) - 1
```

The `existing_idx < len(...) and session.messages[existing_idx].id == msg.id` guard protects against staleness if anything else ever mutates `session.messages` directly (e.g. compaction/truncation code) without going through this function — falls through to the safe append+reindex path rather than silently corrupting a slot.

- [ ] **Step 4: Find every other place that mutates `session.messages` directly and reindex there too**

This is the critical correctness step — a stale `message_index` is worse than no index (silent wrong-slot overwrites). Search for all direct mutations:

Run: `grep -rn "\.messages\.append(\|\.messages\[.*\] = \|\.messages = \|\.messages\.pop(\|\.messages\.remove(\|\.messages\.insert(" backend/apps/agents`

For each match found OTHER than the one just written in `upsert_message.py`, read the surrounding function and add the same reindexing discipline: after any append, set `session.message_index[msg.id] = len(session.messages) - 1`; after any full-list reassignment or removal, rebuild the whole index:

```python
session.message_index = {m.id: i for i, m in enumerate(session.messages)}
```

List every file touched in this step before moving on — this plan cannot enumerate them in advance since the grep above hasn't run yet. Expect at minimum `history_compaction.py` (truncation/compaction rewrites the list) and possibly session-reset/fork code.

- [ ] **Step 5: Rebuild the index on session load from disk**

Sessions are deserialized from JSON on load (the `message_index` field is `exclude=True`, so it won't be in the saved file, meaning every loaded session starts with an empty index — which is safe but would silently fall through to append-only behavior for every message until the process restarts... actually it's worse: an empty index would report `existing_idx is None` for a message that already exists, causing it to be appended as a duplicate instead of replaced.)

Find where sessions are deserialized:

Run: `grep -rn "AgentSession.model_validate\|AgentSession(\*\*" backend/apps/agents/manager/session`

At each load site, after constructing the `AgentSession`, rebuild the index:

```python
session.message_index = {m.id: i for i, m in enumerate(session.messages)}
```

- [ ] **Step 6: Write regression tests**

Check for existing coverage:
Run: `find backend/apps/agents/manager/streaming -iname "*test*upsert*"`

Add to that file (or create `backend/apps/agents/manager/streaming/tests/test_upsert_message.py`):

```python
from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.streaming.upsert_message import upsert_message


def test_upsert_message_appends_new_message():
    session = AgentSession(id="s1", model="claude-test")
    msg = Message(id="m1", role="assistant", content="hello")
    upsert_message(session, msg)
    assert len(session.messages) == 1
    assert session.message_index["m1"] == 0


def test_upsert_message_replaces_existing_by_id():
    session = AgentSession(id="s1", model="claude-test")
    upsert_message(session, Message(id="m1", role="assistant", content="draft"))
    upsert_message(session, Message(id="m1", role="assistant", content="final"))
    assert len(session.messages) == 1
    assert session.messages[0].content == "final"


def test_upsert_message_handles_stale_index_gracefully():
    session = AgentSession(id="s1", model="claude-test")
    upsert_message(session, Message(id="m1", role="assistant", content="a"))
    session.messages.clear()
    session.message_index = {"m1": 0}
    upsert_message(session, Message(id="m2", role="assistant", content="b"))
    assert len(session.messages) == 1
    assert session.messages[0].id == "m2"
```

Adjust `Message`/`AgentSession` constructor args to match the real required fields per Task 3 Step 4's model inspection.

- [ ] **Step 7: Run the new tests**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend/apps/agents/manager/streaming/tests/test_upsert_message.py -v`
Expected: all three PASS.

- [ ] **Step 8: Run the full backend suite**

Run: `MAESTRO_MOCK_AGENT= python -m pytest backend -x -q 2>&1 | tail -30`
Expected: no new failures vs. baseline. Pay special attention to any test touching session persistence/compaction/history — Step 4/5's reindexing changes are the highest-risk part of this task.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/agents/core/models.py backend/apps/agents/manager/streaming/upsert_message.py backend/apps/agents/manager/session backend/apps/agents/manager/streaming/tests/test_upsert_message.py
git commit -m "perf(backend): O(1) message upsert via an id-to-index cache

session.messages grows unbounded for the life of a session; every tool
call and assistant reply commit was paying an O(n) scan to find-or-replace
by id. Adds AgentSession.message_index (excluded from serialization,
rebuilt on load) maintained by every direct mutation site."
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1-4 cover the four HIGH-impact backend findings from the audit (synchronous `is_running()`, synchronous Antigravity check, thinking-pill O(n) scan, `upsert_message` O(n) scan). The MEDIUM/LOW backend findings (WS fan-out, fsync-on-save, `load_settings()` deep copy, dev-mode pgrep/pkill, large-tool-result sync write) are intentionally left for a follow-up plan — bundling all 12 backend findings into one plan would violate the "each plan produces working, testable software independently" scope rule, and the four tasks here are the ones with a "stalls every concurrent user" blast radius, which is the highest-leverage subset to ship first.
- **Placeholder scan:** no TBD/TODO markers; every step has literal code. Task 3's Step 3 vs 3b is a genuine two-path decision gated on a grep result the plan can't predict — this is not a placeholder, it's a documented decision point with both full implementations provided.
- **Type consistency:** `ThinkingState.msg_index`, `TurnState.child_session_ids`, `AgentSession.message_index` are each introduced once and referenced consistently by the same name in every later step that touches them.
