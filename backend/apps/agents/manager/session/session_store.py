import os

from backend.apps.agents.core.models import AgentSession
from backend.apps.settings.maestro_picker_migration import migrate_picker_values_in_place
from typing import Dict, List, Optional, Tuple
from typeguard import typechecked
from backend.config.json_store import read_json_or_none, atomic_write_json


@typechecked
def sessions_dir() -> str:
    # Resolve live so test patches on either the paths module or the agent_manager facade re-export land on the same directory.
    from backend.apps.agents import agent_manager
    return agent_manager.SESSIONS_DIR


@typechecked
def save_session(session_id: str, doc_data: Dict) -> None:
    dir_path = sessions_dir()
    os.makedirs(dir_path, exist_ok=True)
    atomic_write_json(os.path.join(dir_path, f"{session_id}.json"), doc_data)


@typechecked
def load_session_data(session_id: str) -> Optional[Dict]:
    data = read_json_or_none(os.path.join(sessions_dir(), f"{session_id}.json"))
    # A session's `model` field (and any nested model override) can still carry the pre-rename `custom/provedor-ia/<model>` picker value; rewrite it in memory only (same non-rewrite-on-disk stance as the workflow loader).
    if data is not None:
        migrate_picker_values_in_place(data)
    return data


@typechecked
def delete_session_file(session_id: str) -> None:
    path = os.path.join(sessions_dir(), f"{session_id}.json")
    if os.path.exists(path):
        os.remove(path)


@typechecked
def load_all_session_data() -> List[Tuple[str, Dict]]:
    results = []
    dir_path = sessions_dir()
    if not os.path.exists(dir_path):
        return results
    for fname in os.listdir(dir_path):
        if fname.endswith(".json"):
            data = read_json_or_none(os.path.join(dir_path, fname))
            if data is not None:
                migrate_picker_values_in_place(data)
                results.append((fname[:-5], data))
    return results


@typechecked
def build_search_text(session: AgentSession, max_len: int = 5000) -> str:
    """Build a search-indexing string from the session name and message content."""
    parts = [session.name or ""]
    for msg in session.messages:
        if msg.role in ("user", "assistant") and isinstance(msg.content, str):
            parts.append(msg.content)
    text = " ".join(parts)
    return text[:max_len]
