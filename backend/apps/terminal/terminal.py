"""The terminal SubApp exists for its lifespan, not its routes: MainApp builds the app's shutdown sequence out of SubApp context managers, so this is the only place a PTY reap can hang. Follows outputs_lifespan's shape."""

import asyncio
import logging
from contextlib import asynccontextmanager
from backend.config.Apps import SubApp

logger = logging.getLogger(__name__)

# One minute between sweeps is far finer than the 30-minute idle window, so eviction is timely without the task ever being hot.
SWEEP_INTERVAL_SECONDS = 60


async def p_sweep_loop() -> None:
    """Periodically evict abandoned shells. Without this IDLE_EVICT_SECONDS is dead code and idle shells only die at the LRU cap."""
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        try:
            from backend.apps.terminal.manager import manager
            swept = await manager.sweep_idle()
            if swept:
                logger.info("terminal: swept %d idle shells", swept)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("terminal: idle sweep failed")


@asynccontextmanager
async def terminal_lifespan():
    sweeper = asyncio.create_task(p_sweep_loop())
    try:
        yield
    finally:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("terminal lifespan: sweeper teardown failed")
        # Every shell must die with the app. On Windows a killed parent leaves its descendants running, so a missed reap strands pwsh.exe processes across restarts.
        try:
            from backend.apps.terminal.manager import manager
            killed = await manager.stop_all()
            if killed:
                logger.info("terminal lifespan: reaped %d shells on shutdown", killed)
        except Exception:
            logger.exception("terminal lifespan: stop_all failed")


terminal = SubApp("terminal", terminal_lifespan)
