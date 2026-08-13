"""A launch that carries a prompt must always deliver it, or fail loudly.

The bug: the prompt travelled in a SECOND request the client made after /launch and never checked
the result of, while `send_message` could refuse a prompt with a bare `return` and the endpoint
still answered ok. So the session existed, launch had already broadcast status "running", and the
user got a run with nothing in it and nothing logged.

These fail on the old code: /launch ignored an initial_message entirely (delivering nothing), and
send_message returned None so no caller could tell a delivery from a drop.
"""

import asyncio

import pytest
from fastapi import HTTPException

from backend.apps.agents import agents as agents_module
from backend.apps.agents.core.models import AgentConfig, InitialMessage


class P_FakeManager:
    """Stands in for agent_manager: records what launch/send were asked to do."""

    def __init__(self, deliver: bool = True) -> None:
        self.deliver = deliver
        self.sent: list = []
        self.launched = 0

    async def launch_agent(self, config):
        self.launched += 1
        from backend.apps.agents.core.models import AgentSession
        return AgentSession(id="sess-1", name=config.name, model=config.model, mode=config.mode)

    async def send_message(self, session_id, prompt, **kwargs):
        self.sent.append((session_id, prompt, kwargs))
        return self.deliver


@pytest.fixture
def p_manager(monkeypatch):
    fake = P_FakeManager()
    monkeypatch.setattr(agents_module, "agent_manager", fake)
    return fake


def test_launch_delivers_the_prompt_it_carries(p_manager):
    config = AgentConfig(initial_message=InitialMessage(prompt="build me a dashboard"))
    result = asyncio.run(agents_module.launch_agent(config))
    assert result["prompt_delivered"] is True
    assert [(s, p) for s, p, _ in p_manager.sent] == [("sess-1", "build me a dashboard")]


def test_launch_forwards_the_first_messages_attachments(p_manager):
    config = AgentConfig(
        selected_app_output_ids=["app-9"],
        initial_message=InitialMessage(
            prompt="fix the header",
            forced_tools=["Read"],
            selected_browser_ids=["b1"],
            context_paths=[{"path": "/tmp/x", "type": "file"}],
        ),
    )
    asyncio.run(agents_module.launch_agent(config))
    kwargs = p_manager.sent[0][2]
    assert kwargs["forced_tools"] == ["Read"]
    assert kwargs["selected_browser_ids"] == ["b1"]
    assert kwargs["selected_app_output_ids"] == ["app-9"]
    assert kwargs["context_paths"] == [{"path": "/tmp/x", "type": "file"}]


def test_a_refused_delivery_is_an_error_not_a_silent_success(monkeypatch):
    """The whole bug in one assertion: a launch whose prompt was not queued must NOT answer 200."""
    fake = P_FakeManager(deliver=False)
    monkeypatch.setattr(agents_module, "agent_manager", fake)
    config = AgentConfig(initial_message=InitialMessage(prompt="do the thing"))
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(agents_module.launch_agent(config))
    assert excinfo.value.status_code == 500


def test_an_empty_carried_prompt_is_rejected_rather_than_starting_an_idle_run(p_manager):
    config = AgentConfig(initial_message=InitialMessage(prompt="   "))
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(agents_module.launch_agent(config))
    assert excinfo.value.status_code == 400
    assert p_manager.sent == []


def test_a_launch_with_no_prompt_still_works_and_says_so(p_manager):
    result = asyncio.run(agents_module.launch_agent(AgentConfig()))
    assert result["session_id"] == "sess-1"
    assert result["prompt_delivered"] is False
    assert p_manager.sent == []


def test_send_message_refusal_is_reported_and_logged():
    """An in-flight turn must return False (not a bare `return`) so no caller can mistake it for a send.

    Captures on the module's own logger rather than through caplog: the suite mutates root-logger
    propagation elsewhere, and this assertion must not depend on that."""
    import logging

    from backend.apps.agents.agent_manager import agent_manager
    from backend.apps.agents.core.models import AgentSession

    records: list = []

    class P_Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record.getMessage())

    logger = logging.getLogger("backend.apps.agents.manager.Messaging")
    handler = P_Capture(level=logging.WARNING)
    logger.addHandler(handler)
    previous_level = logger.level
    logger.setLevel(logging.WARNING)
    agent_manager.sessions["busy-1"] = AgentSession(id="busy-1", name="busy", model="sonnet", mode="agent")

    async def run():
        running = asyncio.get_event_loop().create_future()
        agent_manager.tasks["busy-1"] = asyncio.ensure_future(running)
        try:
            return await agent_manager.send_message("busy-1", "please do this")
        finally:
            running.cancel()
            agent_manager.tasks.pop("busy-1", None)

    try:
        assert asyncio.run(run()) is False
        assert any("refused" in m for m in records), records
        # The prompt itself must never be logged; only its size.
        assert not any("please do this" in m for m in records)
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)
        agent_manager.sessions.pop("busy-1", None)
