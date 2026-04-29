"""Per-session WS event sequencing, ring buffer, and terminal-event persistence.

Why this exists
---------------
WS sockets die for a thousand reasons that have nothing to do with the
agent task: laptop sleep, captive portals, NAT idle timeout, VPN
renegotiation. Without this module, a transient drop is fatal —
mid-stream events are lost forever and the UI can't tell whether the
run finished or merely went quiet.

Contract
--------
Every WS event for a session goes through `stamp(...)`, which is an
async context manager that:
  1. Acquires the per-session lock.
  2. Bumps a monotonic `seq` integer.
  3. Appends the JSON payload to a bounded ring buffer.
  4. Yields (seq, payload_str) to the caller.
  5. Holds the lock until the caller exits the `async with` — meaning
     the caller's `ws.send_text(...)` happens *under the same lock*,
     guaranteeing wire order == seq order even when many coroutines
     broadcast concurrently.

Without (5), two coroutines can each get a unique seq under separate
lock acquisitions, yet the higher-seq event can reach the wire first
because asyncio scheduled its `send_text` earlier. That corrupts both
wire order and the ring buffer on resume.

Resume protocol
---------------
On reconnect, the client sends `client:resume {connection_uuid,
last_seq}`. The server:
  - Returns ring-buffer events with `seq > last_seq` if available.
  - Returns `agent:gap_detected` if `last_seq` is older than the
    oldest buffered seq — the client falls back to a REST refresh.
  - Returns the persisted terminal event (if any) when the session
    is no longer in memory at all (e.g. after a process restart).

Persistence
-----------
Terminal events (status: completed/stopped/error) are written
atomically to disk so a client that comes back hours later — long
after the in-memory ring buffer has been GC'd — still sees the right
outcome instead of a spinner that never resolves. Persistence is
opportunistic: an I/O error never blocks the broadcast path.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import deque
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)

# Ring buffer size per session. ~500 events comfortably covers a 30s
# transient drop even in the busiest streams (thinking deltas at
# ~20Hz). Memory is bounded: ~50KB per active session.
BUFFER_LIMIT = 500

TERMINAL_STATUSES = {"completed", "stopped", "error"}


class _SessionSeqLog:
    """Per-session lock + monotonic seq + recent-event ring buffer."""

    __slots__ = ("lock", "seq", "buffer")

    def __init__(self) -> None:
        self.lock: asyncio.Lock = asyncio.Lock()
        self.seq: int = 0
        # Each entry: (seq, json_payload_str). Pre-serialized so a
        # replay doesn't redo json.dumps for every reconnect.
        self.buffer: deque[tuple[int, str]] = deque(maxlen=BUFFER_LIMIT)


class SeqLogStore:
    """Process-wide store. Per-session locks live inside `_SessionSeqLog`."""

    def __init__(self, persist_dir: Optional[str] = None) -> None:
        self._per_session: dict[str, _SessionSeqLog] = {}
        # Coarse lock guarding only the dict's setdefault path. Held
        # for nanoseconds; never crosses an `await` past the `_get`.
        self._dict_lock = asyncio.Lock()
        self._persist_dir = persist_dir
        if persist_dir:
            try:
                os.makedirs(persist_dir, exist_ok=True)
            except Exception:
                logger.warning("seq_log: failed to create persist dir %s", persist_dir)

    async def _get_or_create(self, session_id: str) -> _SessionSeqLog:
        log = self._per_session.get(session_id)
        if log is not None:
            return log
        async with self._dict_lock:
            log = self._per_session.get(session_id)
            if log is None:
                log = _SessionSeqLog()
                self._per_session[session_id] = log
            return log

    def _peek(self, session_id: str) -> Optional[_SessionSeqLog]:
        return self._per_session.get(session_id)

    @asynccontextmanager
    async def stamp(
        self, session_id: str, event: str, data: dict
    ) -> AsyncIterator[tuple[int, str]]:
        """Atomically assign a seq, buffer it, and yield (seq, payload).

        Caller is expected to perform the actual `send_text` *inside*
        the `async with` block. The per-session lock is held for the
        entire body, so wire order is guaranteed equal to seq order
        no matter how many tasks broadcast concurrently.
        """
        log = await self._get_or_create(session_id)
        async with log.lock:
            log.seq += 1
            seq = log.seq
            payload = {
                "event": event,
                "session_id": session_id,
                "data": data,
                "seq": seq,
            }
            payload_str = json.dumps(payload)
            log.buffer.append((seq, payload_str))
            yield seq, payload_str

    def replay(
        self, session_id: str, last_seq: int
    ) -> tuple[Optional[int], Optional[int], list[str]]:
        """Return (oldest_buffered_seq, newest_buffered_seq, events).

        Caller decides what to do with the result:
          - `events` empty AND newest_buffered_seq is None: no buffer
            for this session in memory. Fall back to persisted
            terminal event.
          - `last_seq` < `oldest_buffered_seq`: there's a gap. Send
            `agent:gap_detected`; the client REST-refreshes.
          - Otherwise `events` are the missed payloads in seq order.
        """
        log = self._peek(session_id)
        if log is None:
            return (None, None, [])
        # Snapshot the deque under the lock-free fast path. asyncio is
        # single-threaded so a list() of a deque mutated by append is
        # safe; eviction (via maxlen) is also a single-step op. We
        # don't need to hold the per-session lock for a read.
        snapshot = list(log.buffer)
        if not snapshot:
            return (None, log.seq, [])
        oldest = snapshot[0][0]
        newest = snapshot[-1][0]
        events = [s for (i, s) in snapshot if i > last_seq]
        return (oldest, newest, events)

    def current_seq(self, session_id: str) -> int:
        """Last assigned seq, or 0 if no log exists for the session."""
        log = self._peek(session_id)
        return log.seq if log else 0

    # ----- Terminal-event persistence -----

    def _terminal_path(self, session_id: str) -> Optional[str]:
        if not self._persist_dir:
            return None
        # session ids are uuid4 hex in this codebase, but sanitize
        # against path traversal anyway.
        safe = "".join(c for c in session_id if c.isalnum() or c in ("-", "_"))
        if not safe:
            return None
        return os.path.join(self._persist_dir, f"{safe}.json")

    def persist_terminal(self, session_id: str, payload_str: str) -> None:
        """Atomic write of a terminal event for post-restart clients.

        Best-effort: an I/O failure must never block the broadcast.
        """
        path = self._terminal_path(session_id)
        if not path:
            return
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(payload_str)
            os.replace(tmp, path)
        except Exception:
            logger.debug(
                "seq_log: failed to persist terminal event for %s", session_id, exc_info=True
            )

    def load_terminal(self, session_id: str) -> Optional[str]:
        path = self._terminal_path(session_id)
        if not path or not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None

    def clear(self, session_id: str) -> None:
        """Drop in-memory log + persisted terminal event.

        Use on full session deletion. Closed-but-retained sessions
        keep their terminal file so late reconnects still resolve.
        """
        self._per_session.pop(session_id, None)
        path = self._terminal_path(session_id)
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass


def _default_persist_dir() -> Optional[str]:
    try:
        from backend.config.paths import DATA_ROOT
        return os.path.join(DATA_ROOT, "agents", "terminal_events")
    except Exception:
        return None


# Process-wide singleton wired to the agents data dir.
seq_log = SeqLogStore(persist_dir=_default_persist_dir())
