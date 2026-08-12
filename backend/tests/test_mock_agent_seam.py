"""The MAESTRO_MOCK_AGENT=1 seam: with the flag set and NO credentials configured, a real
run_agent_loop turn must stream a deterministic synthetic assistant reply (no key, no CLI, no
network); with the flag absent the seam must be inert and the normal SDK path must run. Asserts on
the streamed WS deltas, not just on the absence of an exception."""

import asyncio

import pytest
import claude_agent_sdk
from claude_agent_sdk import AssistantMessage, ResultMessage
from claude_agent_sdk.types import TextBlock

import backend.apps.agents.core.ws_manager as ws_mod
from backend.apps.agents.agent_manager import AgentManager
from backend.apps.agents.core.models import AgentSession
from backend.apps.agents.manager.MockAgent import MOCK_REPLY_PREFIX
from backend.apps.settings.models import AppSettings


@pytest.fixture(autouse=True)
def p_no_credentials(monkeypatch):
    """Hand the loop settings with no key at all, so a run that reaches provider resolution CANNOT
    succeed by borrowing the dev machine's configured credentials."""
    import backend.apps.agents.agent_manager as am
    import backend.apps.agents.manager.run.RunOptions as run_opts
    p_settings = AppSettings(connection_mode="own_key", anthropic_api_key=None)
    monkeypatch.setattr(am, "load_settings", lambda: p_settings, raising=True)
    monkeypatch.setattr(run_opts, "load_settings", lambda: p_settings, raising=True)
    yield


def p_drive(monkeypatch, prompt):
    """Run one turn through the real run_agent_loop; return (session, ws_events)."""
    events = []

    async def p_fake_send(session_id, event, data):
        events.append((event, data))

    monkeypatch.setattr(ws_mod.ws_manager, "send_to_session", p_fake_send, raising=True)
    mgr = AgentManager()
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    mgr.sessions[session.id] = session
    asyncio.run(mgr.run_agent_loop(session.id, prompt))
    return session, events


def p_streamed_text(events, message_id):
    return "".join(d["delta"] for e, d in events if e == "agent:stream_delta" and d["message_id"] == message_id)


def test_mock_flag_streams_a_deterministic_reply_without_credentials(monkeypatch):
    monkeypatch.setenv("MAESTRO_MOCK_AGENT", "1")
    session, events = p_drive(monkeypatch, "say hello")
    p_expected = f"{MOCK_REPLY_PREFIX}say hello"
    p_starts = [d["message_id"] for e, d in events if e == "agent:stream_start" and d.get("role") == "assistant"]
    assert len(p_starts) == 1
    assert p_streamed_text(events, p_starts[0]) == p_expected
    assert ("agent:stream_end", {"session_id": session.id, "message_id": p_starts[0]}) in events
    p_asst = [d["message"] for e, d in events if e == "agent:message" and d["message"]["role"] == "assistant"]
    assert [m["content"] for m in p_asst] == [p_expected]
    assert [(m.role, m.content) for m in session.messages] == [("assistant", p_expected)]
    assert session.status == "completed"
    assert session.cost_usd == 0.0


def test_mock_flag_is_deterministic_across_runs(monkeypatch):
    monkeypatch.setenv("MAESTRO_MOCK_AGENT", "1")
    first, _ = p_drive(monkeypatch, "say hello")
    second, _ = p_drive(monkeypatch, "say hello")
    assert [(m.role, m.content) for m in first.messages] == [(m.role, m.content) for m in second.messages]


def test_non_one_flag_values_do_not_select_the_mock(monkeypatch):
    """Only "1" opts in, matching the other MAESTRO_* opt-in flags."""
    async def p_query(*args, **kwargs):
        yield AssistantMessage(content=[TextBlock(text="real path")], model="sonnet",
                               message_id="m1", stop_reason="end_turn", session_id="s",
                               usage={"input_tokens": 1, "output_tokens": 1})
        yield ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                            num_turns=1, session_id="s", usage={"input_tokens": 1, "output_tokens": 1})

    monkeypatch.setattr(claude_agent_sdk, "query", p_query, raising=True)
    for p_value in ("0", "true", ""):
        monkeypatch.setenv("MAESTRO_MOCK_AGENT", p_value)
        session, _ = p_drive(monkeypatch, "say hello")
        assert not any(MOCK_REPLY_PREFIX in str(m.content) for m in session.messages)


def test_seam_is_inert_when_the_flag_is_absent(monkeypatch):
    monkeypatch.delenv("MAESTRO_MOCK_AGENT", raising=False)

    async def p_query(*args, **kwargs):
        yield AssistantMessage(content=[TextBlock(text="real path")], model="sonnet",
                               message_id="m1", stop_reason="end_turn", session_id="s",
                               usage={"input_tokens": 1, "output_tokens": 1})
        yield ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                            num_turns=1, session_id="s", usage={"input_tokens": 1, "output_tokens": 1})

    monkeypatch.setattr(claude_agent_sdk, "query", p_query, raising=True)
    session, _ = p_drive(monkeypatch, "say hello")
    assert not any(MOCK_REPLY_PREFIX in str(m.content) for m in session.messages)
    assert any(m.role == "assistant" and "real path" in str(m.content) for m in session.messages)
