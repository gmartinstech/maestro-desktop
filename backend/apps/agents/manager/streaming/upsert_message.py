"""Append a message to a session, or replace it in place when its id already exists. Makes a
duplicate-id row unrepresentable when a stream commit races a stop's early partial commit
(both carry the same stream message id). session.message_index accelerates that specific
replay case — a second upsert_message call for an id this function already indexed skips the
scan — but does NOT help the dominant call pattern: handle_assistant_message.py's two hot call
sites always pass a freshly minted uuid4 id that has never been indexed, so they always miss
the cache and pay the same full linear scan as before this change. The cache is validated
(bounds + id-match, mirrors ThinkingState.msg_index in thinking.py) before being trusted, and a
miss is never treated as proof the id is absent, since ~35 other call sites append to
session.messages directly without updating it — a stale or missing entry just costs one
linear-scan fallback, which also repairs the cache."""

from typeguard import typechecked

from backend.apps.agents.core.models import AgentSession, Message


@typechecked
def upsert_message(session: AgentSession, msg: Message) -> None:
    cached_idx = session.message_index.get(msg.id)
    if cached_idx is not None and cached_idx < len(session.messages) and session.messages[cached_idx].id == msg.id:
        session.messages[cached_idx] = msg
        return
    for i, existing in enumerate(session.messages):
        if getattr(existing, "id", None) == msg.id:
            session.messages[i] = msg
            session.message_index[msg.id] = i
            return
    session.messages.append(msg)
    session.message_index[msg.id] = len(session.messages) - 1
