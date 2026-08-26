"""Unit coverage for the extracted PostToolUse hook (tool_result_hook). The streaming harness
mocks claude_agent_sdk.query, so it never fires the SDK's PostToolUse hooks; this pins the
behavior directly: a tool result becomes a tool_result message, and an Agent tool spawns a
sub-session into the manager's LIVE registry (the InstanceOf[dict] sharing, the subtle bit)."""

import time

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from backend.apps.agents.core.models import AgentSession
from backend.apps.agents.manager.streaming.HookContext import HookContext
from backend.apps.agents.manager.streaming import post_tool_hook as tool_result_hook
from backend.apps.agents.manager import view_builder_state
from backend.apps.agents.manager.session import history_compaction
from backend.apps.agents.manager.session.history_compaction import (
    PLATFORM_NOTE_CLOSE,
    PLATFORM_NOTE_OPEN,
    RECAP_TOOL_RESULT_CAP,
    recap_tool_result_line,
)


def p_ctx(registry: dict) -> HookContext:
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    registry[session.id] = session
    return HookContext(
        session=session,
        session_id=session.id,
        prompt="hi",
        builtin_perms={},
        policy_defaults={},
        sessions=registry,
    )


@pytest.mark.asyncio
async def test_normal_tool_result_appends_message_and_continues():
    registry: dict = {}
    ctx = p_ctx(registry)
    before = len(ctx.session.messages)
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()) as send:
        out = await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Read", "tool_response": "file body", "tool_input": {"file_path": "/x"}}, "tu1", None
        )
    assert out == {"continue_": True}
    assert len(ctx.session.messages) == before + 1
    msg = ctx.session.messages[-1]
    assert msg.role == "tool_result"
    assert "file body" in str(msg.content)
    send.assert_awaited()  # the tool_result is broadcast to the UI


@pytest.mark.asyncio
async def test_agent_tool_spawns_subsession_into_live_registry():
    registry: dict = {}
    ctx = p_ctx(registry)
    parent_id = ctx.session_id
    raw = {
        "content": [{"type": "text", "text": "sub-agent did the work"}],
        "usage": {"input_tokens": 7, "output_tokens": 3},
        "total_cost_usd": 0.01,
        "model": "sonnet",
    }
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()), \
         patch.object(tool_result_hook.ws_manager, "broadcast_global", new=AsyncMock()):
        out = await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Agent", "tool_response": raw, "tool_input": {"prompt": "do x"}}, "tu1", None
        )
    assert out == {"continue_": True}
    # exactly one NEW session registered (besides the parent), parented correctly
    children = [s for sid, s in registry.items() if sid != parent_id]
    assert len(children) == 1
    child = children[0]
    assert child.parent_session_id == parent_id
    assert child.active_mcps == []  # context-isolation invariant: no inherited activations
    assert "sub-agent did the work" in str(child.messages[-1].content)


@pytest.mark.asyncio
async def test_view_builder_dep_install_broadcasts_app_deps_changed():
    """An npm install in a view-builder session must tell the app card this turn
    changed deps (agent:app_deps_changed), so its turn-finish reload restarts Vite
    instead of soft-reloading a preview that can't see the new packages."""
    registry: dict = {}
    ctx = p_ctx(registry)
    ctx.session.mode = "view-builder"
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()) as send:
        await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Bash", "tool_response": "added 3 packages",
                  "tool_input": {"command": "npm install recharts"}}, "tu1", None
        )
    events = [c.args[1] for c in send.await_args_list]
    assert "agent:app_deps_changed" in events


@pytest.mark.asyncio
async def test_view_builder_plain_write_does_not_flag_deps_changed():
    """A plain file edit must NOT escalate the reload; only dep changes do."""
    registry: dict = {}
    ctx = p_ctx(registry)
    ctx.session.mode = "view-builder"
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()) as send:
        await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Write", "tool_response": "ok",
                  "tool_input": {"file_path": "/ws/frontend/src/App.tsx", "content": "x"}}, "tu1", None
        )
    events = [c.args[1] for c in send.await_args_list]
    assert "agent:app_deps_changed" not in events


def p_app_manager(build_errors=(), console_errors=()) -> MagicMock:
    fake = MagicMock()
    fake.drain_errors_for_path.return_value = list(build_errors)
    fake.drain_frontend_errors_for_path.return_value = list(console_errors)
    return fake


async def p_write(ctx, fake_manager, file_path="/ws/frontend/src/App.tsx") -> str:
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()), \
         patch("backend.apps.outputs.runtime.manager", fake_manager):
        await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Write", "tool_response": "ok",
                  "tool_input": {"file_path": file_path, "content": "x"}}, "tu1", None
        )
    view_builder_state.view_builder_dirty_sessions.discard(ctx.session_id)
    return str(ctx.session.messages[-1].content)


@pytest.mark.asyncio
async def test_view_builder_write_surfaces_build_errors_into_the_tool_result():
    """Regression: this drain sat behind an `elif` on the view-builder reload branch, so a
    frontend write took that branch instead -- the App Builder was the one agent that never
    saw its own vite/babel/tsc errors after a write."""
    ctx = p_ctx({})
    ctx.session.mode = "view-builder"
    body = await p_write(ctx, p_app_manager(build_errors=["[plugin:vite] SyntaxError: Unexpected token"]))
    assert "Build server reported" in body
    assert "SyntaxError" in body


@pytest.mark.asyncio
async def test_write_surfaces_app_console_errors_as_a_separate_note():
    ctx = p_ctx({})
    ctx.session.mode = "view-builder"
    body = await p_write(ctx, p_app_manager(console_errors=["TypeError: x is not a function"]))
    assert "The app's console logged" in body
    assert "TypeError: x is not a function" in body


@pytest.mark.asyncio
async def test_createapp_write_from_another_mode_still_surfaces_errors():
    """An agent in normal chat mode editing an app it made with CreateApp gets the same feedback."""
    ctx = p_ctx({})  # default mode, not view-builder
    body = await p_write(ctx, p_app_manager(build_errors=["Traceback (most recent call last)"]))
    assert "Traceback" in body


@pytest.mark.asyncio
async def test_write_outside_any_app_workspace_adds_no_note():
    ctx = p_ctx({})
    body = await p_write(ctx, p_app_manager(), file_path="/some/other/repo/main.py")
    assert "Build server reported" not in body
    assert "The app's console logged" not in body


# --- oversized results spill to a blob, and the message left behind keeps its shape ---


async def p_oversized_result(ctx, tmp_path, text: str, tool_name: str = "Bash"):
    """Drive the real hook with a tool_response past the 50KB spill threshold.

    truncate_large_tool_result used to json.dumps the whole text/tool_name/elapsed_ms envelope
    and hand back a bare string, so a spilled result lost tool_name and elapsed_ms and the
    retained 4KB "signal" head was the escaped JSON of the envelope, not the tool's output.
    """
    ctx.tool_start_times["tu1"] = time.time() - 0.05
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()), \
         patch.object(history_compaction, "SESSIONS_DIR", str(tmp_path)):
        await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": tool_name, "tool_response": text, "tool_input": {"command": "cat big"}}, "tu1", None
        )
    return ctx.session.messages[-1]


@pytest.mark.asyncio
async def test_spilled_tool_result_keeps_its_envelope_fields(tmp_path):
    ctx = p_ctx({})
    msg = await p_oversized_result(ctx, tmp_path, "MEGA" * 20_000)
    assert isinstance(msg.content, dict), "a spilled result must stay the same shape as every other tool_result"
    assert msg.content["tool_name"] == "Bash"
    assert isinstance(msg.content["elapsed_ms"], int), "per-tool latency must survive the spill"


@pytest.mark.asyncio
async def test_spilled_tool_result_head_is_readable_tool_output(tmp_path):
    """The head exists to preserve signal; spent on JSON escaping it preserved almost none."""
    ctx = p_ctx({})
    msg = await p_oversized_result(ctx, tmp_path, "line one\n" + "MEGA" * 20_000)
    body = msg.content["text"]
    assert body.startswith("line one\n"), f"head is not the tool's own output: {body[:60]!r}"
    assert not body.lstrip().startswith("{"), "head is still the escaped JSON envelope"


@pytest.mark.asyncio
async def test_spilled_tool_result_still_points_at_a_readable_blob(tmp_path):
    """The platform note naming the blob is the ONLY way the dropped body is recoverable."""
    ctx = p_ctx({})
    full = "line one\n" + "MEGA" * 20_000
    msg = await p_oversized_result(ctx, tmp_path, full)
    blob = tmp_path / ctx.session_id / "blobs" / f"{msg.id}.txt"
    assert blob.exists(), "the spilled body was not written where the note says it is"
    assert blob.read_text(encoding="utf-8") == full, "the blob must be the tool's text, not a JSON envelope the agent has to unwrap"
    body = msg.content["text"]
    assert str(blob) in body
    assert PLATFORM_NOTE_OPEN in body and PLATFORM_NOTE_CLOSE in body


@pytest.mark.asyncio
async def test_spilled_tool_result_is_still_clipped_by_the_recap_cap(tmp_path):
    """The context estimator measures recap_tool_result_line, which clips to 500 chars whatever
    the shape is -- so this fix must not move what estimate_post_compact_input charges."""
    ctx = p_ctx({})
    msg = await p_oversized_result(ctx, tmp_path, "MEGA" * 20_000)
    line = recap_tool_result_line(msg.content)
    assert len(line) <= RECAP_TOOL_RESULT_CAP + len("Tool result (Bash): ") + len("...")
    assert line.startswith("Tool result (Bash): ")


@pytest.mark.asyncio
async def test_result_under_the_threshold_is_left_alone(tmp_path):
    ctx = p_ctx({})
    ctx.tool_start_times["tu1"] = time.time() - 0.05
    with patch.object(tool_result_hook.ws_manager, "send_to_session", new=AsyncMock()), \
         patch.object(history_compaction, "SESSIONS_DIR", str(tmp_path)):
        await tool_result_hook.post_tool_hook(
            ctx, {"tool_name": "Bash", "tool_response": "small output", "tool_input": {"command": "ls"}}, "tu1", None
        )
    msg = ctx.session.messages[-1]
    assert msg.content["text"] == "small output"
    assert not (tmp_path / ctx.session_id).exists(), "nothing under the threshold may touch disk"
