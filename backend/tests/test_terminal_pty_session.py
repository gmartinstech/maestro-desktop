"""A terminal is only as good as its replay: switching tabs closes the socket, and a session that cannot hand back its scrollback looks to the user like it lost their work. These tests pin replay, the byte cap, input passthrough and exit propagation against a fake backend so they run identically on every platform."""

import asyncio
import pytest
from typing import Dict, List, Optional
from backend.apps.terminal.pty_session import PtySession, RING_BUFFER_MAX_BYTES


class p_FakeBackend:
    """A PtyBackend that emits a scripted list of chunks then blocks until killed, recording everything written to it."""

    def __init__(self, chunks: Optional[List[bytes]] = None):
        self.chunks = list(chunks or [])
        self.written: List[bytes] = []
        self.sizes: List[tuple] = []
        self.killed = False
        self.spawned_with: Optional[dict] = None
        self.p_exit: Optional[int] = None
        self.p_gate = asyncio.Event()

    def spawn(self, argv: List[str], cwd: str, env: Dict[str, str], cols: int, rows: int) -> None:
        self.spawned_with = {"argv": argv, "cwd": cwd, "env": env, "cols": cols, "rows": rows}

    async def read(self) -> bytes:
        if self.chunks:
            return self.chunks.pop(0)
        # Hold the reader open until the test releases it, so stop() controls teardown rather than a race.
        await self.p_gate.wait()
        self.p_exit = 0
        return b""

    def write(self, data: bytes) -> None:
        self.written.append(data)

    def resize(self, cols: int, rows: int) -> None:
        self.sizes.append((cols, rows))

    def kill(self) -> None:
        self.killed = True
        self.p_gate.set()

    @property
    def exit_code(self) -> Optional[int]:
        return self.p_exit


@pytest.mark.asyncio
async def test_output_reaches_subscriber(tmp_path):
    fake = p_FakeBackend([b"hello ", b"world"])
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    got: List[bytes] = []
    session.subscribe(got.append)
    await session.start()
    await asyncio.sleep(0.05)
    assert b"".join(got) == b"hello world"
    await session.stop()


@pytest.mark.asyncio
async def test_subscribe_replays_existing_buffer(tmp_path):
    fake = p_FakeBackend([b"earlier output"])
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    await session.start()
    await asyncio.sleep(0.05)
    late: List[bytes] = []
    session.subscribe(late.append)
    assert b"".join(late) == b"earlier output"
    await session.stop()


@pytest.mark.asyncio
async def test_ring_buffer_caps_at_max_bytes(tmp_path):
    fake = p_FakeBackend([b"x" * 1024 for _ in range(400)])
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    await session.start()
    await asyncio.sleep(0.3)
    late: List[bytes] = []
    session.subscribe(late.append)
    assert 0 < len(b"".join(late)) <= RING_BUFFER_MAX_BYTES
    await session.stop()


@pytest.mark.asyncio
async def test_write_and_resize_reach_backend(tmp_path):
    fake = p_FakeBackend()
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    await session.start()
    session.write(b"echo hi\r")
    session.resize(120, 40)
    assert fake.written == [b"echo hi\r"]
    assert fake.sizes[-1] == (120, 40)
    await session.stop()


@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery(tmp_path):
    fake = p_FakeBackend([b"first"])
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    got: List[bytes] = []
    unsubscribe = session.subscribe(got.append)
    await session.start()
    await asyncio.sleep(0.05)
    unsubscribe()
    fake.chunks.append(b"second")
    await asyncio.sleep(0.05)
    assert b"".join(got) == b"first"
    await session.stop()


@pytest.mark.asyncio
async def test_stop_kills_backend_and_marks_not_running(tmp_path):
    fake = p_FakeBackend()
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    await session.start()
    assert session.running is True
    await session.stop()
    assert fake.killed is True
    assert session.running is False


@pytest.mark.asyncio
async def test_session_spawns_in_requested_cwd(tmp_path):
    fake = p_FakeBackend()
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    await session.start()
    assert fake.spawned_with["cwd"] == str(tmp_path)
    await session.stop()


@pytest.mark.asyncio
async def test_eof_broadcasts_the_empty_chunk_that_signals_exit(tmp_path):
    """The WS route turns an empty chunk into term:exit, so a session that swallows EOF leaves the pane looking alive forever."""
    fake = p_FakeBackend([b"bye"])
    session = PtySession("ws1", 1, str(tmp_path), backend=fake)
    got: List[bytes] = []
    session.subscribe(got.append)
    await session.start()
    await asyncio.sleep(0.05)
    fake.kill()
    await asyncio.sleep(0.05)
    assert got[-1] == b""
    assert session.running is False
