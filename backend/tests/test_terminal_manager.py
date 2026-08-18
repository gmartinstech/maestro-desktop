"""Detach must NOT kill: the whole reason the PTY lives in the backend is that closing a tab, reloading the renderer or switching cards should leave the shell running. These tests also pin the LRU cap and the idle sweep, because an unbounded manager is how a machine fills with orphaned pwsh.exe processes."""

import asyncio
import pytest
from typing import List
from backend.apps.terminal.manager import PtySessionManager, MAX_LIVE_SESSIONS


class p_NoopBackend:
    """Never produces output and never exits until killed, so lifecycle is the only thing under test."""

    def __init__(self):
        self.killed = False
        self.p_gate = asyncio.Event()

    def spawn(self, argv, cwd, env, cols, rows):
        pass

    async def read(self):
        await self.p_gate.wait()
        return b""

    def write(self, data):
        pass

    def resize(self, cols, rows):
        pass

    def kill(self):
        self.killed = True
        self.p_gate.set()

    @property
    def exit_code(self):
        return 0


@pytest.fixture
def p_manager(monkeypatch):
    """A manager whose sessions always use the noop backend, so no real shell is ever spawned."""
    monkeypatch.setattr(
        "backend.apps.terminal.pty_session.make_pty_backend",
        lambda: p_NoopBackend(),
        raising=True,
    )
    return PtySessionManager()


@pytest.mark.asyncio
async def test_attach_creates_and_starts_a_session(p_manager, tmp_path):
    session = await p_manager.attach("ws1", 1, str(tmp_path))
    assert session.running is True
    assert p_manager.get("ws1", 1) is session
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_attach_twice_reuses_the_same_session(p_manager, tmp_path):
    first = await p_manager.attach("ws1", 1, str(tmp_path))
    second = await p_manager.attach("ws1", 1, str(tmp_path))
    assert first is second
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_detach_does_not_kill_the_shell(p_manager, tmp_path):
    session = await p_manager.attach("ws1", 1, str(tmp_path))
    await p_manager.detach("ws1", 1)
    assert session.running is True
    assert p_manager.get("ws1", 1) is session
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_reattach_after_detach_returns_the_same_shell(p_manager, tmp_path):
    first = await p_manager.attach("ws1", 1, str(tmp_path))
    await p_manager.detach("ws1", 1)
    second = await p_manager.attach("ws1", 1, str(tmp_path))
    assert first is second
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_different_instances_are_different_sessions(p_manager, tmp_path):
    first = await p_manager.attach("ws1", 1, str(tmp_path))
    second = await p_manager.attach("ws1", 2, str(tmp_path))
    assert first is not second
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_exceeding_the_cap_evicts_the_least_recently_used(p_manager, tmp_path):
    created: List = []
    for i in range(MAX_LIVE_SESSIONS):
        created.append(await p_manager.attach(f"ws{i}", 1, str(tmp_path)))
        await p_manager.detach(f"ws{i}", 1)
    await p_manager.attach("overflow", 1, str(tmp_path))
    assert p_manager.get("ws0", 1) is None
    assert created[0].running is False
    assert p_manager.get("overflow", 1) is not None
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_attached_sessions_are_never_evicted(p_manager, tmp_path):
    pinned = await p_manager.attach("pinned", 1, str(tmp_path))
    for i in range(MAX_LIVE_SESSIONS + 2):
        await p_manager.attach(f"ws{i}", 1, str(tmp_path))
        await p_manager.detach(f"ws{i}", 1)
    assert p_manager.get("pinned", 1) is pinned
    assert pinned.running is True
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_sweep_idle_kills_only_unreferenced_stale_sessions(p_manager, tmp_path, monkeypatch):
    import backend.apps.terminal.manager as manager_mod
    monkeypatch.setattr(manager_mod, "IDLE_EVICT_SECONDS", 0, raising=True)
    watched = await p_manager.attach("watched", 1, str(tmp_path))
    abandoned = await p_manager.attach("abandoned", 1, str(tmp_path))
    await p_manager.detach("abandoned", 1)
    await asyncio.sleep(0.01)
    swept = await p_manager.sweep_idle()
    assert swept == 1
    assert p_manager.get("abandoned", 1) is None
    assert abandoned.running is False
    assert p_manager.get("watched", 1) is watched
    assert watched.running is True
    await p_manager.stop_all()


@pytest.mark.asyncio
async def test_stop_all_kills_everything_and_returns_the_count(p_manager, tmp_path):
    await p_manager.attach("ws1", 1, str(tmp_path))
    await p_manager.attach("ws2", 1, str(tmp_path))
    killed = await p_manager.stop_all()
    assert killed == 2
    assert p_manager.get("ws1", 1) is None
