"""On Windows a dying parent leaves its child tree running. Without this reap every Maestro restart strands another pwsh.exe, and the user's machine slowly fills with invisible shells."""

import asyncio
import pytest
from backend.apps.terminal.terminal import terminal, terminal_lifespan


def test_terminal_is_registered_in_main_app():
    import backend.main as main_mod
    assert terminal.name == "terminal"
    assert terminal.prefix == "/api/terminal"
    assert main_mod.app is not None


@pytest.mark.asyncio
async def test_lifespan_stops_all_sessions_on_exit(monkeypatch):
    calls = {"stop_all": 0}

    async def p_fake_stop_all():
        calls["stop_all"] += 1
        return 3

    from backend.apps.terminal import manager as manager_mod
    monkeypatch.setattr(manager_mod.manager, "stop_all", p_fake_stop_all, raising=True)
    async with terminal_lifespan():
        assert calls["stop_all"] == 0
    assert calls["stop_all"] == 1


@pytest.mark.asyncio
async def test_lifespan_survives_a_failing_stop_all(monkeypatch):
    async def p_boom():
        raise RuntimeError("kill failed")

    from backend.apps.terminal import manager as manager_mod
    monkeypatch.setattr(manager_mod.manager, "stop_all", p_boom, raising=True)
    async with terminal_lifespan():
        pass


@pytest.mark.asyncio
async def test_lifespan_runs_and_cancels_the_idle_sweeper(monkeypatch):
    """IDLE_EVICT_SECONDS is dead code unless something calls sweep_idle on a timer, and a sweeper that outlives the lifespan keeps looping after shutdown."""
    import backend.apps.terminal.terminal as terminal_mod
    swept = {"count": 0}

    async def p_fake_sweep():
        swept["count"] += 1
        return 0

    async def p_noop_stop_all():
        return 0

    from backend.apps.terminal import manager as manager_mod
    monkeypatch.setattr(manager_mod.manager, "sweep_idle", p_fake_sweep, raising=True)
    monkeypatch.setattr(manager_mod.manager, "stop_all", p_noop_stop_all, raising=True)
    monkeypatch.setattr(terminal_mod, "SWEEP_INTERVAL_SECONDS", 0.01, raising=True)
    async with terminal_lifespan():
        await asyncio.sleep(0.1)
        assert swept["count"] >= 1
    before = swept["count"]
    await asyncio.sleep(0.1)
    assert swept["count"] == before
