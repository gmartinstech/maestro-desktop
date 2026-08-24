"""upsert_message()'s session.message_index cache: validated (bounds + id-match) before
trusting it, with a linear-scan fallback that self-heals the cache when it's missing or
stale. Only accelerates a repeat upsert for an id this function already indexed (the
stop/race replay case) — a fresh id, the dominant call pattern, always falls back to the
scan, same as before this cache existed."""

from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.streaming.upsert_message import upsert_message


def test_upsert_message_appends_new_message():
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    msg = Message(id="m1", role="assistant", content="hello")
    upsert_message(session, msg)
    assert len(session.messages) == 1
    assert session.message_index["m1"] == 0


def test_upsert_message_replaces_existing_by_id_using_cached_index():
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    upsert_message(session, Message(id="m1", role="assistant", content="draft"))
    upsert_message(session, Message(id="m1", role="assistant", content="final"))
    assert len(session.messages) == 1
    assert session.messages[0].content == "final"


def test_upsert_message_self_heals_when_index_is_stale():
    """Simulates a message inserted by code OTHER than upsert_message (one of the ~35 direct
    session.messages.append() call sites elsewhere in the codebase), which never touches
    session.message_index. upsert_message must still find and correctly replace it via the
    fallback scan, not treat the id as new."""
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    session.messages.append(Message(id="m1", role="assistant", content="added directly, not via upsert_message"))
    upsert_message(session, Message(id="m1", role="assistant", content="replaced"))
    assert len(session.messages) == 1
    assert session.messages[0].content == "replaced"
    assert session.message_index["m1"] == 0


def test_upsert_message_self_heals_when_cached_index_points_at_wrong_slot():
    """Simulates something else (e.g. compaction/truncation elsewhere in the codebase)
    reordering session.messages after upsert_message already cached an index for m1."""
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    upsert_message(session, Message(id="m1", role="assistant", content="first"))
    assert session.message_index["m1"] == 0
    session.messages.insert(0, Message(id="unrelated", role="user", content="inserted before"))
    upsert_message(session, Message(id="m1", role="assistant", content="updated"))
    assert len(session.messages) == 2
    assert session.messages[1].id == "m1"
    assert session.messages[1].content == "updated"
    assert session.message_index["m1"] == 1


def test_upsert_message_index_not_serialized():
    """message_index is a derived cache, not real session state — must not leak into
    model_dump() output (which becomes the persisted session file and WS payload)."""
    session = AgentSession(id="s1", name="Test Agent", model="claude-test")
    upsert_message(session, Message(id="m1", role="assistant", content="hello"))
    dumped = session.model_dump(mode="json")
    assert "message_index" not in dumped
