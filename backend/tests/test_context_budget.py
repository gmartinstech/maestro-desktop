"""Rigorous coverage for the token-accounting + compaction-trigger logic lifted into
manager/context_budget.py. Compaction is correctness-sensitive (backend/CLAUDE.md), so
every branch of maybe_compact is pinned, plus emit_context_update's token persistence and
the exact broadcast payload."""

import asyncio

import backend.apps.agents.manager.context_budget as cb
from backend.apps.agents.core.models import AgentSession, Message


def p_session_with(messages: int, input_tokens: int, context_window: int = 100, threshold: float = 0.65) -> AgentSession:
    s = AgentSession(name="t", model="sonnet")
    s.context_window = context_window
    s.compact_threshold_pct = threshold
    s.tokens = {"input": input_tokens, "output": 0}
    s.messages = [Message(role="user", content=f"m{i}") for i in range(messages)]
    return s


def p_capture_ws(monkeypatch):
    sent = []

    async def fake_send(session_id, event, data):
        sent.append((event, data))

    monkeypatch.setattr(cb.ws_manager, "send_to_session", fake_send, raising=True)
    return sent


# ---- maybe_compact: every branch -------------------------------------------

def test_compact_skipped_below_threshold():
    s = p_session_with(messages=10, input_tokens=10)  # 0.10 < 0.65
    assert cb.maybe_compact(s) is False
    assert s.compacted_through_msg_id is None


def test_compact_fires_over_threshold_and_marks_boundary():
    s = p_session_with(messages=7, input_tokens=80)   # 0.80 >= 0.65; cutoff = 7-6 = 1
    assert cb.maybe_compact(s) is True
    assert s.compacted_through_msg_id == s.messages[0].id


def test_compact_keeps_the_last_six_messages():
    s = p_session_with(messages=10, input_tokens=80)  # cutoff = 10-6 = 4 -> boundary at msgs[3]
    assert cb.maybe_compact(s) is True
    assert s.compacted_through_msg_id == s.messages[3].id


def test_compact_skipped_with_six_or_fewer_messages():
    s = p_session_with(messages=6, input_tokens=80)   # cutoff = max(0, 6-6) = 0
    assert cb.maybe_compact(s) is False


def test_compact_skipped_under_four_messages():
    s = p_session_with(messages=3, input_tokens=80)
    assert cb.maybe_compact(s) is False


def test_compact_is_idempotent():
    s = p_session_with(messages=7, input_tokens=80)
    assert cb.maybe_compact(s) is True
    boundary = s.compacted_through_msg_id
    assert cb.maybe_compact(s) is False              # already marked through that id
    assert s.compacted_through_msg_id == boundary


def test_force_bypasses_threshold_and_idempotency():
    s = p_session_with(messages=7, input_tokens=1)    # 0.01 < 0.65
    assert cb.maybe_compact(s, force=True) is True   # force ignores the ratio
    assert cb.maybe_compact(s, force=True) is True   # force re-marks even when unchanged


# ---- emit_context_update ----------------------------------------------------

def test_emit_persists_tokens_and_broadcasts(monkeypatch):
    sent = p_capture_ws(monkeypatch)
    s = AgentSession(name="t", model="sonnet")
    s.context_window = 1000

    asyncio.run(cb.emit_context_update("sid", s, input_tokens=250, output_tokens=40, cache_read_tokens=10, cache_read_pct=0.5))

    assert s.tokens["input"] == 250 and s.tokens["output"] == 40
    assert len(sent) == 1
    event, data = sent[0]
    assert event == "agent:context_update"
    assert data["input_tokens"] == 250 and data["output_tokens"] == 40
    assert data["cache_read_tokens"] == 10 and data["cache_read_pct"] == 0.5
    assert data["ctx_used_pct"] == round(250 / 1000, 4)
    assert data["context_window"] == 1000


def test_emit_defaults_to_existing_session_tokens(monkeypatch):
    sent = p_capture_ws(monkeypatch)
    s = AgentSession(name="t", model="sonnet")
    s.tokens = {"input": 123, "output": 7}

    asyncio.run(cb.emit_context_update("sid", s))  # no explicit tokens -> reuse the session's
    _, data = sent[0]
    assert data["input_tokens"] == 123 and data["output_tokens"] == 7


def test_emit_zero_input_yields_zero_ctx_pct(monkeypatch):
    sent = p_capture_ws(monkeypatch)
    s = AgentSession(name="t", model="sonnet")

    asyncio.run(cb.emit_context_update("sid", s, input_tokens=0))
    _, data = sent[0]
    assert data["ctx_used_pct"] == 0.0
