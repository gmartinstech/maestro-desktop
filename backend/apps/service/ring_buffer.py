"""Fixed-size rolling event log for support diagnostics."""

from __future__ import annotations

import threading
import time
from collections import deque

P_MAX_SIZE = 50
P_LOCK = threading.Lock()
P_BUFFER: deque[dict] = deque(maxlen=P_MAX_SIZE)


def record(label: str, **meta: str | int | float | None) -> None:
    """Append an entry. Oldest drops when full."""
    with P_LOCK:
        P_BUFFER.append({
            "l": label,
            "t": time.time(),
            **{k: v for k, v in meta.items() if v is not None},
        })


def snapshot() -> list[dict]:
    """Return a copy of the current buffer, oldest first."""
    with P_LOCK:
        return list(P_BUFFER)