"""One live shell plus the scrollback needed to survive a reconnect. Modeled on AppRuntime's subscribe/broadcast/replay contract with two deliberate differences: this buffers raw BYTE CHUNKS rather than decoded lines, because line-splitting corrupts the ANSI and cursor control a real TTY emits, and it has a write() path, which no existing streaming surface in this codebase has."""

import asyncio
import logging
from collections import deque
from typing import Callable, Deque, List, Optional, Set
from typeguard import typechecked
from backend.apps.terminal.env import build_terminal_env
from backend.apps.terminal.pty_backend import PtyBackend, make_pty_backend, resolve_shell

logger = logging.getLogger(__name__)

# 256 KB of scrollback. A terminal's reconnect contract is intentionally weaker than the agent channel's: anything older than this is gone, exactly as in any terminal emulator.
RING_BUFFER_MAX_BYTES = 262144

OutputSubscriber = Callable[[bytes], None]


class PtySession:
    """A pseudo-terminal bound to one workspace card, outliving the sockets that watch it."""

    @typechecked
    def __init__(self, workspace_id: str, instance: int, cwd: str, backend: Optional[PtyBackend] = None):
        self.workspace_id = workspace_id
        self.instance = instance
        self.p_cwd = cwd
        self.p_argv: List[str] = resolve_shell()
        self.p_backend: PtyBackend = backend if backend is not None else make_pty_backend()
        self.p_buffer: Deque[bytes] = deque()
        self.p_buffer_bytes = 0
        self.p_subscribers: Set[OutputSubscriber] = set()
        self.p_reader: Optional[asyncio.Task] = None
        self.p_running = False

    @property
    def running(self) -> bool:
        return self.p_running

    @property
    def exit_code(self) -> Optional[int]:
        return self.p_backend.exit_code

    @property
    def shell(self) -> str:
        return self.p_argv[0]

    @property
    def cwd(self) -> str:
        return self.p_cwd

    async def start(self) -> None:
        """Spawn the shell and begin pumping its output. Idempotent."""
        if self.p_running:
            return
        self.p_backend.spawn(self.p_argv, self.p_cwd, build_terminal_env(), 80, 24)
        self.p_running = True
        self.p_reader = asyncio.create_task(self.p_pump())

    async def p_pump(self) -> None:
        """Drain the PTY until EOF, then broadcast the empty chunk the WS route turns into term:exit."""
        try:
            while True:
                chunk = await self.p_backend.read()
                if not chunk:
                    break
                self.p_append(chunk)
                self.p_broadcast(chunk)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("terminal: reader failed for %s/%s", self.workspace_id, self.instance)
        finally:
            self.p_running = False
            self.p_broadcast(b"")

    @typechecked
    def p_append(self, chunk: bytes) -> None:
        """Push a chunk into the ring buffer, evicting whole chunks from the front past the cap."""
        self.p_buffer.append(chunk)
        self.p_buffer_bytes += len(chunk)
        while self.p_buffer_bytes > RING_BUFFER_MAX_BYTES and self.p_buffer:
            self.p_buffer_bytes -= len(self.p_buffer.popleft())

    @typechecked
    def p_broadcast(self, chunk: bytes) -> None:
        """Fan out over a snapshot, because a callback may unsubscribe itself mid-dispatch."""
        for callback in list(self.p_subscribers):
            try:
                callback(chunk)
            except Exception:
                logger.exception("terminal: subscriber failed for %s/%s", self.workspace_id, self.instance)

    @typechecked
    def subscribe(self, callback: OutputSubscriber) -> Callable[[], None]:
        """Replay the buffer synchronously, then stream. Returns the unsubscribe closure."""
        for chunk in list(self.p_buffer):
            try:
                callback(chunk)
            except Exception:
                logger.exception("terminal: replay failed for %s/%s", self.workspace_id, self.instance)
        self.p_subscribers.add(callback)

        def p_unsubscribe() -> None:
            self.p_subscribers.discard(callback)

        return p_unsubscribe

    @typechecked
    def write(self, data: bytes) -> None:
        self.p_backend.write(data)

    @typechecked
    def resize(self, cols: int, rows: int) -> None:
        self.p_backend.resize(cols, rows)

    async def stop(self) -> None:
        """Kill the shell and cancel the reader. Safe to call twice."""
        self.p_running = False
        self.p_backend.kill()
        if self.p_reader is not None:
            self.p_reader.cancel()
            try:
                await self.p_reader
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("terminal: reader teardown failed for %s/%s", self.workspace_id, self.instance)
            self.p_reader = None
        self.p_subscribers.clear()
