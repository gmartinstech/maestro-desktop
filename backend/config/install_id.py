"""Per-install UUID4 binding in-flight OAuth claims to the install that started them."""

from __future__ import annotations

import os
import uuid

from backend.config.paths import DATA_ROOT

P_INSTALL_ID_FILE = os.path.join(DATA_ROOT, "install_id")
P_CACHED: str | None = None


# Public - called by tools_lib.py, mcp_config.py
def get_install_id() -> str:
    """Return the persistent install_id, generating and persisting on first call."""
    global P_CACHED
    if P_CACHED:
        return P_CACHED

    try:
        with open(P_INSTALL_ID_FILE, "r", encoding="utf-8") as f:
            existing = f.read().strip()
            if p_looks_like_uuid(existing):
                P_CACHED = existing
                return P_CACHED
    except FileNotFoundError:
        pass
    except Exception:
        pass

    fresh = str(uuid.uuid4())
    os.makedirs(os.path.dirname(P_INSTALL_ID_FILE) or ".", exist_ok=True)
    fd = os.open(P_INSTALL_ID_FILE, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        os.write(fd, fresh.encode("utf-8"))
    finally:
        os.close(fd)
    P_CACHED = fresh
    return P_CACHED


def p_looks_like_uuid(s: str) -> bool:
    if len(s) != 36:
        return False
    try:
        uuid.UUID(s)
        return True
    except ValueError:
        return False
