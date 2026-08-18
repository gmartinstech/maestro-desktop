"""emit_consolidated_thinking() perf caches: a cached session.messages index avoids
re-scanning the full message list by id on every call, and a 1s-TTL child-session-id
cache avoids re-scanning the full sessions dict on every AssistantMessage chunk/tick."""

import time

import pytest
from unittest.mock import AsyncMock, patch

from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.streaming.state import ThinkingState, TurnState
from backend.apps.agents.manager.streaming.thinking import emit_consolidated_thinking


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_reuses_cached_msg_index():
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
        first_index = thinking.msg_index
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
    assert first_index is not None
    assert len(session.messages) == 1
    assert session.messages[0].id == thinking.msg_id
    assert thinking.msg_index == first_index


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_caches_child_session_scan_briefly():
    parent = AgentSession(id="parent", name="Parent Agent", model="claude-test")
    child = AgentSession(
        id="child", name="Child Agent", model="claude-test",
        parent_session_id="parent", tokens={"input_fresh": 10, "output": 5},
    )
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    sessions = {"parent": parent, "child": child}
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, parent, "parent", sessions)
    assert turn.child_session_ids == ["child"]


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_child_cache_expires_and_picks_up_new_child():
    parent = AgentSession(id="parent", name="Parent Agent", model="claude-test")
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    sessions = {"parent": parent}
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, parent, "parent", sessions)
    assert turn.child_session_ids == []
    # Simulate a mid-turn sub-agent fork appearing after the first tick, and the cache TTL having elapsed.
    new_child = AgentSession(
        id="child2", name="Child Agent 2", model="claude-test",
        parent_session_id="parent", tokens={"input_fresh": 3, "output": 1},
    )
    sessions["child2"] = new_child
    turn.child_session_ids_cached_at = time.time() - 2.0
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, parent, "parent", sessions)
    assert turn.child_session_ids == ["child2"]


@pytest.mark.asyncio
async def test_emit_consolidated_thinking_self_heals_when_msg_index_becomes_stale():
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    thinking = ThinkingState(text_parts=["hello"])
    turn = TurnState()
    with patch("backend.apps.agents.core.ws_manager.ws_manager.send_to_session", new_callable=AsyncMock):
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
        assert thinking.msg_index == 0
        # Simulate something else inserting a message before the thinking pill, shifting its real index.
        session.messages.insert(0, Message(id="unrelated", role="user", content="hi"))
        await emit_consolidated_thinking(thinking, turn, session, "s1", {"s1": session})
    # The cached index (0) is now stale (points at the unrelated message), so the fallback scan
    # must run and correct it to the pill's real position (1).
    assert thinking.msg_index == 1
    assert session.messages[1].id == thinking.msg_id
