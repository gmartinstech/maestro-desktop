"""Pin the WS `agent:*` event contract between the backend emitter and the frontend
handler, so a rename/typo on one side goes red here instead of silently dropping a
whole event on the floor in production (as `agent:out_of_credits` did: the backend
emitted it forever, the frontend never had a matching case, so the friendly
"you're out of credits" card never once rendered).

(a) NAME PARITY: every backend-emitted agent:* event string must have a matching
`case 'agent:...':` in frontend/src/shared/ws/WebSocketManager.ts.
(b) PAYLOAD SHAPE: the five highest-traffic events must keep the exact key sets the
frontend already reads from, including the two distinct agent:status shapes (full
vs lite), captured by driving the real loop the same way test_streaming_harness.py
does."""

import asyncio
import re
from pathlib import Path
from typing import Dict, List, Set

import pytest
import claude_agent_sdk
from claude_agent_sdk import AssistantMessage, ResultMessage
from claude_agent_sdk.types import TextBlock, StreamEvent

from backend.apps.agents.agent_manager import AgentManager
from backend.apps.agents.core.models import AgentSession
import backend.apps.agents.core.ws_manager as ws_mod

BACKEND_APPS_DIR = Path(__file__).resolve().parents[1] / "apps"
FRONTEND_WS_MANAGER = Path(__file__).resolve().parents[2] / "frontend" / "src" / "shared" / "ws" / "WebSocketManager.ts"

# send_to_session(session_id, "agent:x", ...): event is the SECOND positional arg.
SEND_TO_SESSION_RE = re.compile(r"\.send_to_session\(\s*[^,]+,\s*[\"'](agent:[a-zA-Z0-9_]+)[\"']")
# broadcast_global("agent:x", ...): event is the FIRST positional arg.
BROADCAST_GLOBAL_RE = re.compile(r"\.broadcast_global\(\s*[\"'](agent:[a-zA-Z0-9_]+)[\"']")
FRONTEND_CASE_RE = re.compile(r"case '(agent:[a-zA-Z0-9_]+)':")

# Client->server events: sent BY the frontend, received in backend/main.py's WS receive
# loop (outside backend/apps/, so this scan never sees them as "emitted"). Listed here
# explicitly anyway so a future scope change (e.g. widening the scan to all of backend/)
# doesn't misreport these as a backend-emits-but-frontend-never-handles gap: they're the
# opposite direction, not a gap.
CLIENT_TO_SERVER_EVENTS = {"agent:stop", "agent:send_message", "agent:approval_response"}


def p_scan_backend_emitted_agent_events() -> Set[str]:
    found: Set[str] = set()
    for path in BACKEND_APPS_DIR.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        found.update(SEND_TO_SESSION_RE.findall(text))
        found.update(BROADCAST_GLOBAL_RE.findall(text))
    return found - CLIENT_TO_SERVER_EVENTS


def p_scan_frontend_handled_agent_events() -> Set[str]:
    text = FRONTEND_WS_MANAGER.read_text(encoding="utf-8")
    return set(FRONTEND_CASE_RE.findall(text))


def test_backend_emitted_agent_events_are_all_handled_by_frontend():
    backend_emitted = p_scan_backend_emitted_agent_events()
    frontend_handled = p_scan_frontend_handled_agent_events()
    assert backend_emitted, "scan found zero agent:* emits under backend/apps/, the regex probably broke"
    assert frontend_handled, "scan found zero agent:* cases in WebSocketManager.ts, the regex probably broke"
    missing = backend_emitted - frontend_handled
    assert not missing, (
        "backend emits these agent:* events but WebSocketManager.ts has no matching "
        f"case for them: {sorted(missing)}"
    )


@pytest.fixture(autouse=True)
def p_provider_configured(monkeypatch):
    """Mirrors test_streaming_harness.py's fixture of the same name: run_agent_loop
    resolves a provider before it queries, so hand it a direct key instead of leaning
    on whatever happens to be in the dev machine's settings."""
    import backend.apps.agents.agent_manager as am
    import backend.apps.agents.manager.run.RunOptions as run_opts
    from backend.apps.settings.models import AppSettings
    settings = AppSettings(connection_mode="own_key", anthropic_api_key="sk-ant-test")
    monkeypatch.setattr(am, "load_settings", lambda: settings, raising=True)
    monkeypatch.setattr(run_opts, "load_settings", lambda: settings, raising=True)
    yield


def p_stream(event):
    return StreamEvent(uuid="u", session_id="sdk-1", event=event)


def p_result(**kw):
    base = dict(subtype="success", duration_ms=100, duration_api_ms=80, is_error=False,
                num_turns=1, session_id="sdk-1", usage={"input_tokens": 10, "output_tokens": 5})
    base.update(kw)
    return ResultMessage(**base)


def p_assistant(blocks, **kw):
    base = dict(content=blocks, model="sonnet", message_id="m1", stop_reason="end_turn",
                session_id="sdk-1", usage={"input_tokens": 10, "output_tokens": 5})
    base.update(kw)
    return AssistantMessage(**base)


def p_drive_full_streaming_turn(monkeypatch):
    """Same SDK message sequence as test_streaming_harness.py's
    test_full_streaming_turn_drives_the_complete_ws_contract: partial StreamEvents
    (block start -> text deltas -> stop -> message_stop), then the AssistantMessage
    envelope, then the ResultMessage. Returns the (event, data) tuples the real loop
    emitted over ws_manager.send_to_session."""
    events: List[tuple] = []

    async def fake_send(session_id, event, data):
        events.append((event, data))

    monkeypatch.setattr(ws_mod.ws_manager, "send_to_session", fake_send, raising=True)

    msgs = [
        p_stream({"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}),
        p_stream({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hel"}}),
        p_stream({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "lo!"}}),
        p_stream({"type": "content_block_stop", "index": 0}),
        p_stream({"type": "message_stop"}),
        p_assistant([TextBlock(text="Hello!")], usage={"input_tokens": 100, "output_tokens": 50}),
        p_result(usage={"input_tokens": 1100, "output_tokens": 550}),
    ]

    async def p_q(*args, **kwargs):
        for m in msgs:
            yield m

    monkeypatch.setattr(claude_agent_sdk, "query", p_q, raising=True)

    mgr = AgentManager()
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    mgr.sessions[session.id] = session

    async def p_run():
        # Mirror production (Messaging.send_message): register the task in self.tasks
        # BEFORE awaiting it, since run_agent_loop's finally block only broadcasts the
        # terminal agent:status when it's still the session's live task.
        task = asyncio.ensure_future(mgr.run_agent_loop(session.id, "hi"))
        mgr.tasks[session.id] = task
        await task

    asyncio.run(p_run())
    return events


# Golden key sets for the five highest-traffic events. agent:status has TWO real
# shapes in production (full, ~23 call sites; lite, ~9 call sites e.g. decision.py
# and browser_agent.py) and both must keep working, so they're pinned separately
# rather than collapsed into one shape (collapsing them is explicitly out of scope
# for this ticket).
GOLDEN_PAYLOAD_KEYS = {
    "agent:status_full": {"session_id", "status", "session"},
    "agent:status_lite": {"session_id", "status"},
    "agent:message": {"session_id", "message"},
    "agent:stream_start": {"session_id", "message_id", "role"},
    "agent:stream_delta": {"session_id", "message_id", "delta"},
    "agent:stream_end": {"session_id", "message_id"},
}


def test_streaming_event_payload_shapes_match_golden(monkeypatch):
    events = p_drive_full_streaming_turn(monkeypatch)
    by_event: Dict[str, List[dict]] = {}
    for event, data in events:
        by_event.setdefault(event, []).append(data)

    for name in ("agent:stream_start", "agent:stream_delta", "agent:stream_end", "agent:message"):
        payloads = by_event.get(name)
        assert payloads, f"expected at least one {name} from the driven turn"
        for data in payloads:
            assert set(data.keys()) == GOLDEN_PAYLOAD_KEYS[name], (
                f"{name} payload keys drifted: {sorted(data.keys())}"
            )

    status_events = by_event.get("agent:status")
    assert status_events, "expected at least one agent:status from the driven turn"
    full_forms = [d for d in status_events if set(d.keys()) == GOLDEN_PAYLOAD_KEYS["agent:status_full"]]
    assert full_forms, "expected the full agent:status form {session_id, status, session} (run_agent_loop's finally block)"


def test_agent_status_lite_form_from_approval_flow(monkeypatch):
    """The lite agent:status form {session_id, status} (no `session` key), as emitted
    by decision.py's request_user_approval (and browser_agent.py) around the HITL
    approval wait."""
    events: List[tuple] = []

    async def fake_send(session_id, event, data):
        events.append((event, data))

    async def fake_approval_request(*args, **kwargs):
        return {"behavior": "deny"}

    monkeypatch.setattr(ws_mod.ws_manager, "send_to_session", fake_send, raising=True)
    monkeypatch.setattr(ws_mod.ws_manager, "send_approval_request", fake_approval_request, raising=True)

    from backend.apps.agents.manager.permissions.decision import request_user_approval
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    asyncio.run(request_user_approval(session, session.id, "Bash", {"command": "ls"}, {}))

    status_events = [data for event, data in events if event == "agent:status"]
    assert status_events, "expected agent:status events from the approval flow"
    for data in status_events:
        assert set(data.keys()) == GOLDEN_PAYLOAD_KEYS["agent:status_lite"], (
            f"agent:status lite payload keys drifted: {sorted(data.keys())}"
        )
    assert {data["status"] for data in status_events} == {"waiting_approval", "running"}
