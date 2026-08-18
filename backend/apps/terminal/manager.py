"""Owns every live PTY. The contract that matters: detach does NOT kill, so a closed socket leaves the shell running for the next connect; only the LRU cap, the idle sweep and shutdown ever kill. Refcount and idle-pool shape follow AppRuntimeManager and client_pool."""

import asyncio
import logging
import time
from typing import Dict, Optional, Tuple
from typeguard import typechecked
from backend.apps.terminal.pty_session import PtySession

logger = logging.getLogger(__name__)

# A shell with no watcher for half an hour is almost certainly abandoned.
IDLE_EVICT_SECONDS = 1800
# Eight concurrent shells is well past any real dashboard; the cap exists so a leak is bounded, not to ration.
MAX_LIVE_SESSIONS = 8

SessionKey = Tuple[str, int]


class PtySessionManager:
    """Keyed by (workspace_id, instance), matching how view cards already address runtimes."""

    def __init__(self) -> None:
        self.p_sessions: Dict[SessionKey, PtySession] = {}
        self.p_refcounts: Dict[SessionKey, int] = {}
        self.p_last_used: Dict[SessionKey, float] = {}
        self.p_lock = asyncio.Lock()

    @typechecked
    def get(self, workspace_id: str, instance: int) -> Optional[PtySession]:
        return self.p_sessions.get((workspace_id, instance))

    @typechecked
    async def attach(self, workspace_id: str, instance: int, cwd: str) -> PtySession:
        """Return the live session for this card, spawning one if needed, and take a reference."""
        key = (workspace_id, instance)
        async with self.p_lock:
            session = self.p_sessions.get(key)
            if session is None:
                await self.p_evict_if_needed()
                session = PtySession(workspace_id, instance, cwd)
                await session.start()
                self.p_sessions[key] = session
                logger.info("terminal: spawned shell for %s/%s in %s", workspace_id, instance, cwd)
            self.p_refcounts[key] = self.p_refcounts.get(key, 0) + 1
            self.p_last_used[key] = time.monotonic()
            return session

    @typechecked
    async def detach(self, workspace_id: str, instance: int) -> None:
        """Drop a reference. Deliberately does not stop the session."""
        key = (workspace_id, instance)
        async with self.p_lock:
            if key in self.p_refcounts:
                self.p_refcounts[key] = max(0, self.p_refcounts[key] - 1)
                self.p_last_used[key] = time.monotonic()

    async def p_evict_if_needed(self) -> None:
        """Make room under the cap by killing idle sessions, oldest first. Caller holds the lock."""
        while len(self.p_sessions) >= MAX_LIVE_SESSIONS:
            idle = [k for k in self.p_sessions if self.p_refcounts.get(k, 0) == 0]
            if not idle:
                # Everything is actively watched; better to exceed the cap than to kill a shell someone is typing in.
                return
            victim = min(idle, key=lambda k: self.p_last_used.get(k, 0.0))
            await self.p_kill(victim)
            logger.info("terminal: evicted idle shell %s/%s under the live-session cap", victim[0], victim[1])

    @typechecked
    async def p_kill(self, key: SessionKey) -> None:
        """Stop one session and forget it. Caller holds the lock."""
        session = self.p_sessions.pop(key, None)
        self.p_refcounts.pop(key, None)
        self.p_last_used.pop(key, None)
        if session is not None:
            await session.stop()

    async def sweep_idle(self) -> int:
        """Kill unreferenced sessions past the idle window. Returns how many died."""
        now = time.monotonic()
        async with self.p_lock:
            stale = [
                k for k in list(self.p_sessions)
                if self.p_refcounts.get(k, 0) == 0 and now - self.p_last_used.get(k, now) >= IDLE_EVICT_SECONDS
            ]
            for key in stale:
                await self.p_kill(key)
            return len(stale)

    async def stop_all(self) -> int:
        """Kill every shell. Called from the SubApp lifespan's finally block on shutdown."""
        async with self.p_lock:
            keys = list(self.p_sessions)
            for key in keys:
                await self.p_kill(key)
            return len(keys)


manager = PtySessionManager()
