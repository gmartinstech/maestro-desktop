"""The no-SDK mock agent loop, split out of AgentLaunch so each file is one concern. This
fires only when claude_agent_sdk isn't installed (dev fallback): it fakes one Bash approval +
tool-result + assistant reply so the UI is exercisable without a real model. self.p_stream_* /
self.sessions resolve across the MRO exactly as when this lived on AgentLaunch.

run_mock_turn is the second, deliberately unattended mock: the MAESTRO_MOCK_AGENT=1 seam used by
the deterministic tests and the golden e2e smoke."""

import asyncio
import json
import logging
import os
from datetime import datetime
from uuid import uuid4

from typeguard import typechecked

from backend.apps.agents.core.models import ApprovalRequest, Message
from backend.apps.agents.core.ws_manager import ws_manager

logger = logging.getLogger(__name__)


from backend.apps.agents.manager.AgentManagerProtocol import AgentManagerProtocol

# Obviously-synthetic prefix so a mock reply can never be mistaken for a model reply, in a log or in the UI; the tests assert on it.
MOCK_REPLY_PREFIX = "[maestro-mock] echo: "


@typechecked
def mock_agent_enabled() -> bool:
    """True when MAESTRO_MOCK_AGENT=1 selects the deterministic no-credential agent. Opt-in flags in
    this codebase are `== "1"` (MAESTRO_REQUIRE_BRIDGE, MAESTRO_POOL_DIAG); only "1" counts, so an
    absent or any other value leaves the production SDK path untouched. Read per call, not at import,
    so a test can set it with monkeypatch.setenv."""
    return os.environ.get("MAESTRO_MOCK_AGENT") == "1"


class MockAgent(AgentManagerProtocol):
    @typechecked
    async def run_mock_turn(self, session_id: str, prompt: str) -> None:
        """The MAESTRO_MOCK_AGENT=1 turn: stream one deterministic synthetic assistant reply through
        the same stream_text + agent:message path the real loop uses, with no key, no CLI spawn and
        no network. Separate from run_mock_agent (the no-SDK dev fallback) on purpose: that one parks
        on a real approval round-trip, so it can never complete unattended in a test or smoke."""
        session = self.sessions.get(session_id)
        if not session:
            return
        session.status = "running"
        asst_text = f"{MOCK_REPLY_PREFIX}{prompt}"
        asst_msg_id = uuid4().hex
        # delay=0.0: the real deltas are paced for the dev UI, but a smoke/test shouldn't pay 30ms per word.
        await self.stream_text(session_id, asst_msg_id, asst_text, delay=0.0)
        asst_msg = Message(id=asst_msg_id, role="assistant", content=asst_text, branch_id=session.active_branch_id)
        session.messages.append(asst_msg)
        await ws_manager.send_to_session(session_id, "agent:message", {
            "session_id": session_id,
            "message": asst_msg.model_dump(mode="json"),
        })
        session.status = "completed"
        # Same marker the no-SDK fallback sets: the close path reads it so a mock session isn't reported as a real one. Cost stays at its 0.0 default for the same reason as there.
        setattr(session, "_mock_run", True)
        await ws_manager.send_to_session(session_id, "agent:status", {
            "session_id": session_id,
            "status": "completed",
            "session": session.model_dump(mode="json"),
        })

    @typechecked
    async def run_mock_agent(self, session_id: str, prompt: str):
        """Mock agent loop for development without claude_agent_sdk installed."""
        session = self.sessions.get(session_id)
        if not session:
            return

        await asyncio.sleep(1)

        request_id = uuid4().hex
        approval_req = ApprovalRequest(
            id=request_id,
            session_id=session_id,
            tool_name="Bash",
            tool_input={"command": f"echo 'Processing: {prompt}'", "description": "Echo the user prompt"},
        )
        session.pending_approvals.append(approval_req)
        session.status = "waiting_approval"
        await ws_manager.send_to_session(session_id, "agent:status", {
            "session_id": session_id,
            "status": "waiting_approval",
        })

        decision = await ws_manager.send_approval_request(
            session_id, request_id, "Bash",
            {"command": f"echo 'Processing: {prompt}'", "description": "Echo the user prompt"}
        )

        session.pending_approvals = [a for a in session.pending_approvals if a.id != request_id]
        session.status = "running"
        await ws_manager.send_to_session(session_id, "agent:status", {
            "session_id": session_id,
            "status": "running",
        })

        tool_input_content = {"tool": "Bash", "input": {"command": f"echo 'Processing: {prompt}'"}, "approved": decision.get("behavior") == "allow"}
        tool_msg_id = uuid4().hex
        await self.stream_tool_input(
            session_id, tool_msg_id, "Bash",
            json.dumps(tool_input_content["input"], indent=2),
        )
        tool_msg = Message(id=tool_msg_id, role="tool_call", content=tool_input_content, branch_id=session.active_branch_id)
        session.messages.append(tool_msg)
        await ws_manager.send_to_session(session_id, "agent:message", {
            "session_id": session_id,
            "message": tool_msg.model_dump(mode="json"),
        })

        await asyncio.sleep(1)

        if decision.get("behavior") == "allow":
            tool_result = Message(role="tool_result", content=f"Processing: {prompt}", branch_id=session.active_branch_id)
            session.messages.append(tool_result)
            await ws_manager.send_to_session(session_id, "agent:message", {
                "session_id": session_id,
                "message": tool_result.model_dump(mode="json"),
            })

        await asyncio.sleep(1)

        asst_text = (
            f"I've processed your request: \"{prompt}\"\n\n"
            "This is a mock response because `claude-agent-sdk` is not installed. "
            "Install it with `pip install claude-agent-sdk` to use real Claude Code instances.\n\n"
            f"The agent was configured with:\n- Model: {session.model}\n- Mode: {session.mode}"
        )
        asst_msg_id = uuid4().hex
        await self.stream_text(session_id, asst_msg_id, asst_text)

        asst_msg = Message(id=asst_msg_id, role="assistant", content=asst_text, branch_id=session.active_branch_id)
        session.messages.append(asst_msg)
        await ws_manager.send_to_session(session_id, "agent:message", {
            "session_id": session_id,
            "message": asst_msg.model_dump(mode="json"),
        })

        session.status = "completed"
        session.closed_at = datetime.now()
        # Mock branch (claude_agent_sdk missing): leave cost untouched so it stays at its 0.0 default. A fake nonzero value here would poison the cost shown in the session header during dev. The `_mock_run` flag is read by the close path so a mock session doesn't get reported to the cloud as a real one.
        setattr(session, "_mock_run", True)
        await ws_manager.send_to_session(session_id, "agent:status", {
            "session_id": session_id,
            "status": "completed",
            "session": session.model_dump(mode="json"),
        })
        await ws_manager.send_to_session(session_id, "agent:cost_update", {
            "session_id": session_id,
            "cost_usd": session.cost_usd,
        })
