"""Everything else in the terminal suite runs against a fake backend, which proves the plumbing but not that ConPTY works. This file spawns a real shell. The teardown assertion matters as much as the echo one: a shell that runs but never dies is the failure mode that strands pwsh.exe across restarts."""

import asyncio
import sys
import pytest
from typing import List
from backend.apps.terminal.pty_session import PtySession

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="ConPTY is Windows-only")


@pytest.mark.asyncio
async def test_real_shell_echoes_input(tmp_path):
    session = PtySession("smoke", 1, str(tmp_path))
    chunks: List[bytes] = []
    session.subscribe(chunks.append)
    await session.start()
    # Let the prompt settle before typing; a shell that has not finished booting drops input.
    await asyncio.sleep(3.0)
    session.write(b"echo maestro-smoke\r\n")
    for _ in range(60):
        await asyncio.sleep(0.25)
        if b"maestro-smoke" in b"".join(chunks):
            break
    await session.stop()
    assert b"maestro-smoke" in b"".join(chunks)


@pytest.mark.asyncio
async def test_real_shell_emits_ansi_so_the_byte_buffer_is_justified(tmp_path):
    """The design buffers raw byte chunks rather than lines specifically because a TTY emits escape sequences; this asserts that premise against the real thing."""
    session = PtySession("smoke", 1, str(tmp_path))
    chunks: List[bytes] = []
    session.subscribe(chunks.append)
    await session.start()
    await asyncio.sleep(3.0)
    await session.stop()
    assert b"\x1b[" in b"".join(chunks)


@pytest.mark.asyncio
async def test_stop_leaves_no_running_shell(tmp_path):
    session = PtySession("smoke", 1, str(tmp_path))
    await session.start()
    await asyncio.sleep(1.0)
    assert session.running is True
    await session.stop()
    await asyncio.sleep(0.5)
    assert session.running is False
