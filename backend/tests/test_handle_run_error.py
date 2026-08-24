"""Drive handle_run_error's out-of-credits branch. The is_out_of_tokens / extract_reset_hint
helpers were built but never wired in, so a provider credit/quota error fell through to the
raw-error blob; this pins the friendly card + agent:out_of_tokens event (and the reset hint).
Event name matches the frontend's `case 'agent:out_of_tokens':` in WebSocketManager.ts, see
test_ws_event_contract.py for the drift-detection test that caught the prior mismatched name."""

import asyncio

import backend.apps.agents.core.ws_manager as ws_mod
from backend.apps.agents.core.models import AgentSession
from backend.apps.agents.manager.run.handle_run_error import handle_run_error
from backend.apps.agents.manager.streaming.state import TurnState


def p_drive_error(monkeypatch, exc):
    events = []

    async def fake_send(session_id, event, data):
        events.append((event, data))

    monkeypatch.setattr(ws_mod.ws_manager, "send_to_session", fake_send, raising=True)
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    asyncio.run(handle_run_error(exc, session, session.id, TurnState(), []))
    return session, events


def test_out_of_credits_shows_friendly_card_not_raw_error(monkeypatch):
    session, events = p_drive_error(
        monkeypatch, Exception("Your credit balance is too low to run this request")
    )
    assert session.status == "error"
    assert "agent:out_of_tokens" in [e for e, _ in events]
    sys_msgs = [m for m in session.messages if m.role == "system"]
    assert sys_msgs, "expected a system card"
    assert "out of credits or over your usage limit" in sys_msgs[-1].content
    assert not sys_msgs[-1].content.startswith("Error:")  # not the raw-error fallthrough


def test_out_of_credits_carries_the_provider_reset_hint(monkeypatch):
    _, events = p_drive_error(
        monkeypatch, Exception("insufficient_quota; resets at 7:42 AM")
    )
    payload = next(d for e, d in events if e == "agent:out_of_tokens")
    assert payload["reset_hint"] == "at 7:42 AM"
    assert "resets at 7:42 AM" in payload["message"]
