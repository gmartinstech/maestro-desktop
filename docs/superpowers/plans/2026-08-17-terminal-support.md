# Interactive Terminal Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Maestro Studio a real interactive shell — a PTY hosted by the Python backend, streamed bidirectionally over an authenticated WebSocket into an `xterm.js` pane in the app view card.

**Architecture:** A new `backend/apps/terminal/` package owns PTY sessions behind a `PtyBackend` platform seam (ConPTY on Windows). A `PtySessionManager` refcounts sessions and outlives socket disconnects, so reconnects resume the same shell with replayed scrollback. A new `/ws/terminal/{workspace_id}` route, gated by the existing `p_ws_auth_ok`, carries base64 frames both ways. On the frontend the view card's `terminal` tab is renamed to `logs` (unchanged behavior) and a new `shell` tab mounts `xterm.js`.

**Tech Stack:** Python 3.13 · FastAPI · pywinpty (ConPTY) · pytest 8.3.4 + pytest-asyncio 0.25.2 (strict mode) · React 18 · TypeScript · MUI v7 · webpack · `@xterm/xterm` + `@xterm/addon-fit` · Node's built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-17-terminal-support-design.md`

## Global Constraints

Copied verbatim from the spec and the repo's `CLAUDE.md` files. Every task's requirements implicitly include this section.

- **Never call `*.openswarm.com`.** `scripts/check-callhome.mjs` is a hard-failing gate.
- **Backend style:** no leading `_` — use the `p_` prefix for private names, and promote a `p_` name to a public name if used outside its file/class. Absolute imports only (`from backend.apps.foo import bar`). `@typechecked` on every function. Structured data is a pydantic `BaseModel`, not a bare dict. Comments are **ONE line each, no exceptions**; docstrings are exempt. Never stack 2+ blank lines.
- **Frontend style:** no leading `_`, no barrels, one-export files named after the export, strict typing. Comments are **ONE line each**. No 2+ consecutive blank lines. The `@/` path alias is allowed.
- **Backend tests:** live flat in `backend/tests/test_*.py`. pytest-asyncio is in **strict** mode (no config file exists), so every async test needs `@pytest.mark.asyncio` or a module-level `pytestmark = pytest.mark.asyncio`.
- **Backend test command:** `cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_foo.py`. The venv lives at `backend/.venv` **in the main checkout**, not in this worktree.
- **`MAESTRO_MOCK_AGENT` must be UNSET** when running backend tests. Baseline is 6 pre-existing failures / 1745 passing; do not regress past that.
- **Frontend test command:** `node --test frontend/src/shared/foo.test.ts`. There is no vitest and no jest. Tests rely on Node's native TS type-stripping, so a test file may import only non-JSX, dependency-free modules, and must use an explicit `.ts` import extension.
- **i18n parity is a hard build failure** (`scripts/check-i18n-parity.mjs`). Every key added to `frontend/src/shared/i18n/en.json` must be added to `pt-BR.json` in the same commit.
- **Python deps:** add to `backend/requirements.txt`, then regenerate `backend/requirements.lock` with `uv pip compile backend/requirements.txt --python-version 3.13 --generate-hashes --output-file backend/requirements.lock`. The packaged build installs from the **lock**; a dep missing there ships broken.
- **The merge gate is `npm run verify`** from the repo root.

---

### Task 1: Packaging spike — prove `pywinpty` ships

This task is a **feasibility gate**, not feature code. Its deliverable is an answer plus a dependency commit. If it fails, Task 2's `ConPtyBackend` is rewritten against `ctypes`/`kernel32` and everything downstream is unchanged — that is exactly why the `PtyBackend` interface exists.

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/requirements.lock` (generated, do not hand-edit)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `import winpty` inside the vendored Windows Python runtime. Task 2 depends on this import existing; if it does not, Task 2 switches to the `ctypes` fallback.

- [ ] **Step 1: Add the dependency**

Append to `backend/requirements.txt`, keeping the existing plain pinned `name==version` style:

```
pywinpty==2.0.14
```

- [ ] **Step 2: Regenerate the hash-locked file**

Run from the repo root:

```bash
uv pip compile backend/requirements.txt --python-version 3.13 --generate-hashes --output-file backend/requirements.lock
```

Expected: `requirements.lock` gains a `pywinpty==2.0.14` block with `--hash=sha256:...` entries.

- [ ] **Step 3: Verify it imports in a normal dev environment**

```bash
cd backend && .venv/Scripts/python.exe -c "import winpty; print(winpty.__file__)"
```

Expected: a path ending in `winpty\__init__.py`. If this fails, `pywinpty` has no wheel for this Python — stop and go to Step 6.

- [ ] **Step 4: Rebuild the vendored Windows Python runtime**

```bash
pwsh -File scripts/build-python-env-win.ps1
```

This downloads standalone CPython 3.13.2 into `electron/python-env/` and pip-installs `backend/requirements.lock` into it.

- [ ] **Step 5: Verify the extension loads from the vendored runtime**

This is the actual question the spike exists to answer — a native extension can install fine yet fail to load from a stripped standalone runtime.

```bash
electron/python-env/python.exe -c "import winpty; w = winpty.PtyProcess.spawn('cmd.exe /c echo maestro'); print(repr(w.read()))"
```

Expected: output containing `maestro`. If you instead see `ImportError: DLL load failed`, the spike has failed — go to Step 6.

- [ ] **Step 6: If the spike failed, record the fallback and stop**

Do not attempt to fix the wheel. Revert `requirements.txt` and `requirements.lock`, then write the failure and its exact error into a new `## Spike result` section at the bottom of `docs/superpowers/specs/2026-08-17-terminal-support-design.md`. Task 2 will implement `ConPtyBackend` over `ctypes` against `kernel32` (`CreatePseudoConsole` / `ResizePseudoConsole` / `ClosePseudoConsole` plus anonymous pipes). Every other task in this plan is unaffected. Commit the spec note and proceed to Task 2.

- [ ] **Step 7: Commit (success path)**

```bash
git add backend/requirements.txt backend/requirements.lock
git commit -m "build(backend): add pywinpty for ConPTY terminal support"
```

---

### Task 2: `PtyBackend` platform seam

**Files:**
- Create: `backend/apps/terminal/__init__.py` (empty — the package marker; it must NOT re-export anything, per the no-barrels rule)
- Create: `backend/apps/terminal/pty_backend.py`
- Test: `backend/tests/test_terminal_pty_backend.py`

**Interfaces:**
- Consumes: `winpty` from Task 1 (or the `ctypes` fallback).
- Produces:
  - `class PtyBackend(Protocol)` with `spawn(argv: List[str], cwd: str, env: Dict[str, str], cols: int, rows: int) -> None`, `async read() -> bytes`, `write(data: bytes) -> None`, `resize(cols: int, rows: int) -> None`, `kill() -> None`, and a property `exit_code -> Optional[int]`.
  - `def resolve_shell() -> List[str]` returning the argv for the platform's shell.
  - `def make_pty_backend() -> PtyBackend` — the factory Task 3 calls.

Task 3 depends on exactly these names.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terminal_pty_backend.py`:

```python
"""Shell resolution must be deterministic and platform-correct: the terminal spawns whatever this returns, so a wrong answer here is a terminal that opens to nothing with no error."""

import sys
import pytest
from typing import List
from backend.apps.terminal.pty_backend import resolve_shell


def test_resolve_shell_returns_nonempty_argv():
    argv: List[str] = resolve_shell()
    assert isinstance(argv, list)
    assert len(argv) >= 1
    assert isinstance(argv[0], str)
    assert argv[0]


@pytest.mark.skipif(sys.platform != "win32", reason="windows shell resolution")
def test_resolve_shell_windows_prefers_powershell(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: r"C:\pwsh\pwsh.exe" if name == "pwsh.exe" else None)
    argv = resolve_shell()
    assert argv[0].endswith("pwsh.exe")
    assert "-NoLogo" in argv


@pytest.mark.skipif(sys.platform != "win32", reason="windows shell resolution")
def test_resolve_shell_windows_falls_back_to_powershell_exe(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: None)
    argv = resolve_shell()
    assert argv[0] == "powershell.exe"
    assert "-NoLogo" in argv
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_pty_backend.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.apps.terminal'`.

- [ ] **Step 3: Create the package marker**

Create `backend/apps/terminal/__init__.py` as an empty file (zero bytes). It exists only so the package is importable; adding re-exports would violate the no-barrels rule.

- [ ] **Step 4: Write the implementation**

Create `backend/apps/terminal/pty_backend.py`:

```python
"""The platform seam for pseudo-terminals. Everything above this file is platform-agnostic; swapping the Windows implementation (pywinpty today, ctypes/ConPTY if the wheel ever stops shipping) must not touch PtySession or the WS route."""

import asyncio
import os
import shutil
import sys
from typing import Dict, List, Optional, Protocol, runtime_checkable
from typeguard import typechecked


@typechecked
def resolve_shell() -> List[str]:
    """Return the argv for an interactive login shell on this platform."""
    if sys.platform == "win32":
        # pwsh is the modern cross-platform PowerShell; powershell.exe always exists as the fallback.
        pwsh = shutil.which("pwsh.exe")
        if pwsh:
            return [pwsh, "-NoLogo"]
        return ["powershell.exe", "-NoLogo"]
    shell = os.environ.get("SHELL") or "/bin/bash"
    return [shell, "-l"]


@runtime_checkable
class PtyBackend(Protocol):
    """One live pseudo-terminal. Implementations are platform-specific and own the child process."""

    def spawn(self, argv: List[str], cwd: str, env: Dict[str, str], cols: int, rows: int) -> None: ...

    async def read(self) -> bytes:
        """Return the next chunk of output, or b"" once the child has exited."""
        ...

    def write(self, data: bytes) -> None: ...

    def resize(self, cols: int, rows: int) -> None: ...

    def kill(self) -> None: ...

    @property
    def exit_code(self) -> Optional[int]: ...


class ConPtyBackend:
    """Windows ConPTY via pywinpty. Reads are blocking, so they run in a thread executor to keep the event loop free."""

    def __init__(self) -> None:
        self.p_proc = None
        self.p_exit_code: Optional[int] = None

    @typechecked
    def spawn(self, argv: List[str], cwd: str, env: Dict[str, str], cols: int, rows: int) -> None:
        from winpty import PtyProcess
        self.p_proc = PtyProcess.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))

    async def read(self) -> bytes:
        if self.p_proc is None:
            return b""
        loop = asyncio.get_running_loop()
        try:
            # pywinpty read() is blocking and returns str; the executor hop is what keeps this from stalling every other WS.
            chunk = await loop.run_in_executor(None, self.p_proc.read)
        except EOFError:
            chunk = ""
        if not chunk:
            self.p_exit_code = self.p_proc.exitstatus if self.p_proc.exitstatus is not None else 0
            return b""
        return chunk.encode("utf-8", errors="replace")

    @typechecked
    def write(self, data: bytes) -> None:
        if self.p_proc is None:
            return
        self.p_proc.write(data.decode("utf-8", errors="replace"))

    @typechecked
    def resize(self, cols: int, rows: int) -> None:
        if self.p_proc is None:
            return
        self.p_proc.setwinsize(rows, cols)

    def kill(self) -> None:
        if self.p_proc is None:
            return
        try:
            self.p_proc.terminate(force=True)
        except Exception:
            pass

    @property
    def exit_code(self) -> Optional[int]:
        return self.p_exit_code


class UnixPtyBackend:
    """POSIX openpty. Written for the platform seam's sake but NOT validated on macOS or Linux; see the spec's out-of-scope section."""

    def __init__(self) -> None:
        self.p_pid: Optional[int] = None
        self.p_fd: Optional[int] = None
        self.p_exit_code: Optional[int] = None

    @typechecked
    def spawn(self, argv: List[str], cwd: str, env: Dict[str, str], cols: int, rows: int) -> None:
        import pty
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(cwd)
            os.execvpe(argv[0], argv, env)
        self.p_pid = pid
        self.p_fd = fd
        self.resize(cols, rows)

    async def read(self) -> bytes:
        if self.p_fd is None:
            return b""
        loop = asyncio.get_running_loop()
        try:
            chunk = await loop.run_in_executor(None, os.read, self.p_fd, 65536)
        except OSError:
            chunk = b""
        if not chunk:
            self.p_exit_code = 0
        return chunk

    @typechecked
    def write(self, data: bytes) -> None:
        if self.p_fd is None:
            return
        os.write(self.p_fd, data)

    @typechecked
    def resize(self, cols: int, rows: int) -> None:
        if self.p_fd is None:
            return
        import fcntl
        import struct
        import termios
        fcntl.ioctl(self.p_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def kill(self) -> None:
        if self.p_pid is None:
            return
        import signal
        try:
            os.kill(self.p_pid, signal.SIGKILL)
        except OSError:
            pass

    @property
    def exit_code(self) -> Optional[int]:
        return self.p_exit_code


@typechecked
def make_pty_backend() -> PtyBackend:
    """Pick the platform implementation. The only place either concrete class is named."""
    if sys.platform == "win32":
        return ConPtyBackend()
    return UnixPtyBackend()
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_pty_backend.py
```

Expected: PASS (3 passed on Windows, 1 passed / 2 skipped elsewhere).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/terminal/__init__.py backend/apps/terminal/pty_backend.py backend/tests/test_terminal_pty_backend.py
git commit -m "feat(terminal): add PtyBackend platform seam with ConPTY and POSIX impls"
```

---

### Task 3: `PtySession` — one live shell with replay

**Files:**
- Create: `backend/apps/terminal/pty_session.py`
- Test: `backend/tests/test_terminal_pty_session.py`

**Interfaces:**
- Consumes: `PtyBackend`, `resolve_shell`, `make_pty_backend` from Task 2.
- Produces:
  - `RING_BUFFER_MAX_BYTES: int = 262144`
  - `class PtySession` with `__init__(self, workspace_id: str, instance: int, cwd: str, backend: Optional[PtyBackend] = None)`, `async start() -> None`, `subscribe(callback) -> Callable[[], None]` (replays the buffer synchronously, returns an unsubscribe closure), `write(data: bytes) -> None`, `resize(cols: int, rows: int) -> None`, `async stop() -> None`, and properties `running -> bool`, `exit_code -> Optional[int]`, `shell -> str`, `cwd -> str`.

The `subscribe` contract deliberately mirrors `AppRuntime.subscribe` (`backend/apps/outputs/runtime.py:491`) so the WS route in Task 6 can use the same sync-callback-into-asyncio-Queue bridge the runtime-logs route already uses.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terminal_pty_session.py`:

```python
"""A terminal is only as good as its replay: switching tabs closes the socket, and a session that cannot hand back its scrollback looks to the user like it lost their work. These tests pin replay, the byte cap, input passthrough, and exit propagation against a fake backend so they run identically on every platform."""

import asyncio
import pytest
from typing import Dict, List, Optional
from backend.apps.terminal.pty_session import PtySession, RING_BUFFER_MAX_BYTES


class p_FakeBackend:
    """A PtyBackend that emits a scripted list of chunks then EOFs, and records everything written to it."""

    def __init__(self, chunks: Optional[List[bytes]] = None):
        self.chunks = list(chunks or [])
        self.written: List[bytes] = []
        self.sizes: List[tuple] = []
        self.killed = False
        self.spawned_with: Optional[dict] = None
        self.p_exit = None
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
    def exit_code(self):
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
    await asyncio.sleep(0.2)
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_pty_session.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.apps.terminal.pty_session'`.

- [ ] **Step 3: Write the implementation**

Create `backend/apps/terminal/pty_session.py`:

```python
"""One live shell plus the scrollback needed to survive a reconnect. Modeled on AppRuntime's subscribe/broadcast/replay contract, with two deliberate differences: this buffers raw BYTE CHUNKS rather than decoded lines (line-splitting corrupts ANSI and cursor control), and it has a write() path, which no existing streaming surface in this codebase has."""

import asyncio
import logging
from collections import deque
from typing import Callable, Deque, List, Optional, Set
from typeguard import typechecked
from backend.apps.terminal.pty_backend import PtyBackend, make_pty_backend, resolve_shell
from backend.apps.terminal.env import build_terminal_env

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
        """Drain the PTY until EOF, then broadcast the empty chunk that signals exit."""
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
        """Fan out to subscribers over a snapshot, because a callback may unsubscribe itself mid-dispatch."""
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
            except (asyncio.CancelledError, Exception):
                pass
            self.p_reader = None
        self.p_subscribers.clear()
```

- [ ] **Step 4: Create the env module this imports**

Create `backend/apps/terminal/env.py`:

```python
"""What the user's shell inherits. The user typing here is trusted, so this is not a sandbox; the narrow goal is that `env` or a screen-share does not casually print the provedor-ia key. Mirrors the credential list executor.py already uses for sandboxed Python."""

import os
from typing import Dict
from typeguard import typechecked

# Kept in sync with executor.py's P_SCRUBBED_ENV_KEYS by intent, not by import: that list is tuned for a sandbox that also strips PATH, which would break a usable shell.
P_SCRUBBED_ENV_KEYS = frozenset({
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "PROVEDOR_IA_TOKEN",
    "PROVEDOR_IA_BASE_URL",
    "MAESTRO_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
})


@typechecked
def build_terminal_env() -> Dict[str, str]:
    """Inherit the backend environment minus provider credentials, plus a TERM that makes programs emit color."""
    env = {k: v for k, v in os.environ.items() if k not in P_SCRUBBED_ENV_KEYS}
    env["TERM"] = "xterm-256color"
    return env
```

- [ ] **Step 5: Write the env test**

Create `backend/tests/test_terminal_env.py`:

```python
"""The shell inherits the backend's environment, which holds the provedor-ia token. Without this scrub a user running `env` on a screen-share leaks it."""

from backend.apps.terminal.env import build_terminal_env


def test_provider_credentials_are_scrubbed(monkeypatch):
    monkeypatch.setenv("PROVEDOR_IA_TOKEN", "secret-value")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-appear")
    env = build_terminal_env()
    assert "PROVEDOR_IA_TOKEN" not in env
    assert "ANTHROPIC_API_KEY" not in env
    assert "secret-value" not in env.values()


def test_ordinary_vars_survive(monkeypatch):
    monkeypatch.setenv("MAESTRO_HARMLESS_VAR", "kept")
    env = build_terminal_env()
    assert env["MAESTRO_HARMLESS_VAR"] == "kept"


def test_term_is_set_for_color():
    env = build_terminal_env()
    assert env["TERM"] == "xterm-256color"
```

- [ ] **Step 6: Run both test files to verify they pass**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_pty_session.py tests/test_terminal_env.py
```

Expected: PASS, 10 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/terminal/pty_session.py backend/apps/terminal/env.py backend/tests/test_terminal_pty_session.py backend/tests/test_terminal_env.py
git commit -m "feat(terminal): add PtySession with byte-chunk replay buffer and env scrub"
```

---

### Task 4: `PtySessionManager` — lifecycle

**Files:**
- Create: `backend/apps/terminal/manager.py`
- Test: `backend/tests/test_terminal_manager.py`

**Interfaces:**
- Consumes: `PtySession` from Task 3.
- Produces:
  - `IDLE_EVICT_SECONDS: int = 1800`, `MAX_LIVE_SESSIONS: int = 8`
  - `class PtySessionManager` with `async attach(workspace_id: str, instance: int, cwd: str) -> PtySession`, `async detach(workspace_id: str, instance: int) -> None`, `get(workspace_id: str, instance: int) -> Optional[PtySession]`, `async stop_all() -> int`.
  - Module-level singleton `manager: PtySessionManager`.

Task 5 and Task 6 both import the singleton by the name `manager`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terminal_manager.py`:

```python
"""Detach must NOT kill: the whole reason the PTY lives in the backend is that closing a tab, reloading the renderer, or switching cards should leave the shell running. These tests also pin the LRU cap, because an unbounded manager is how you end up with dozens of orphaned pwsh.exe processes."""

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
def p_manager(monkeypatch, tmp_path):
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
async def test_stop_all_kills_everything_and_returns_the_count(p_manager, tmp_path):
    await p_manager.attach("ws1", 1, str(tmp_path))
    await p_manager.attach("ws2", 1, str(tmp_path))
    killed = await p_manager.stop_all()
    assert killed == 2
    assert p_manager.get("ws1", 1) is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_manager.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.apps.terminal.manager'`.

- [ ] **Step 3: Write the implementation**

Create `backend/apps/terminal/manager.py`:

```python
"""Owns every live PTY. The contract that matters: detach does NOT kill, so a closed socket leaves the shell running for the next connect; only the LRU cap and shutdown ever kill. Refcount + idle-pool shape follows AppRuntimeManager and client_pool."""

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
                if self.p_refcounts.get(k, 0) == 0 and now - self.p_last_used.get(k, now) > IDLE_EVICT_SECONDS
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_manager.py
```

Expected: PASS, 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/terminal/manager.py backend/tests/test_terminal_manager.py
git commit -m "feat(terminal): add PtySessionManager with refcount, LRU cap and idle sweep"
```

---

### Task 5: Terminal SubApp + shutdown reaping

`backend/main.py` has no lifespan of its own — `MainApp` assembles one from each `SubApp`'s async context manager (`backend/config/Apps.py:26-41`). So shutdown cleanup requires a SubApp, exactly as `outputs_lifespan` does its runtime reaping in a `finally` block.

**Files:**
- Create: `backend/apps/terminal/terminal.py`
- Modify: `backend/main.py:51` (the `MainApp([...])` list) and the import block
- Test: `backend/tests/test_terminal_lifespan.py`

**Interfaces:**
- Consumes: `manager` from Task 4.
- Produces: `terminal: SubApp` — registered in `MainApp`, giving the feature a `/api/terminal` prefix and, more importantly, a shutdown hook.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terminal_lifespan.py`:

```python
"""On Windows a dying parent leaves its child tree running. Without this reap, every Maestro restart strands another pwsh.exe, and the user's machine slowly fills with invisible shells."""

import pytest
from backend.apps.terminal.terminal import terminal, terminal_lifespan


def test_terminal_is_registered_in_main_app():
    import backend.main as main_mod
    routes = [r for r in main_mod.app.routes if getattr(r, "path", "").startswith("/api/terminal")]
    assert terminal.name == "terminal"
    assert terminal.prefix == "/api/terminal"
    assert isinstance(routes, list)


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
    """IDLE_EVICT_SECONDS is dead code unless something calls sweep_idle on a timer, and a sweeper that outlives the lifespan keeps the loop alive after shutdown."""
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
```

The test imports `asyncio`, so add it to that file's imports:

```python
import asyncio
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_lifespan.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.apps.terminal.terminal'`.

- [ ] **Step 3: Write the SubApp**

Create `backend/apps/terminal/terminal.py`:

```python
"""The terminal SubApp exists for its lifespan, not its routes: MainApp builds the app's shutdown sequence out of SubApp context managers, so this is the only place a PTY reap can hang. Follows outputs_lifespan's shape."""

import asyncio
import logging
from contextlib import asynccontextmanager
from backend.config.Apps import SubApp

logger = logging.getLogger(__name__)

# One minute between sweeps is far finer than the 30-minute idle window, so eviction is timely without the task ever being hot.
SWEEP_INTERVAL_SECONDS = 60


async def p_sweep_loop() -> None:
    """Periodically evict abandoned shells. Without this, IDLE_EVICT_SECONDS is dead code and idle shells only die at the LRU cap."""
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
        except (asyncio.CancelledError, Exception):
            pass
        # Every shell must die with the app. On Windows a killed parent leaves its descendants running, so a missed reap strands pwsh.exe processes across restarts.
        try:
            from backend.apps.terminal.manager import manager
            killed = await manager.stop_all()
            if killed:
                logger.info("terminal lifespan: reaped %d shells on shutdown", killed)
        except Exception:
            logger.exception("terminal lifespan: stop_all failed")


terminal = SubApp("terminal", terminal_lifespan)
```

- [ ] **Step 4: Register it in `backend/main.py`**

Add the import alongside the other SubApp imports (near `from backend.apps.workflows.workflows import workflows`, around line 47):

```python
from backend.apps.terminal.terminal import terminal
```

Then add `terminal` to the `MainApp` list at line 51. The line becomes:

```python
main_app = MainApp([health, agents, skills, tools_lib, modes, settings, mcp_registry, skill_registry, outputs, output_versions, dashboards, swarm, service, web, anthropic_proxy, workflows, openai_passthrough, terminal])
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_lifespan.py
```

Expected: PASS, 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/terminal/terminal.py backend/main.py backend/tests/test_terminal_lifespan.py
git commit -m "feat(terminal): register terminal SubApp so shells are reaped on shutdown"
```

---

### Task 6: The `/ws/terminal/{workspace_id}` route

**Files:**
- Modify: `backend/main.py` (add the route after the runtime-logs route, which ends at line 326)
- Test: `backend/tests/test_terminal_ws.py`

**Interfaces:**
- Consumes: `manager` from Task 4, `p_ws_auth_ok` from `backend/main.py:235`.
- Produces: the wire protocol Task 8's `terminalFrames.ts` must match exactly:
  - server → client `{"event": "term:status", "data": {"running": bool, "shell": str, "cwd": str}}`
  - server → client `{"event": "term:output", "data": {"data": "<base64>"}}`
  - server → client `{"event": "term:exit", "data": {"code": int}}`
  - client → server `{"event": "term:input", "data": {"data": "<base64>"}}`
  - client → server `{"event": "term:resize", "data": {"cols": int, "rows": int}}`

`asyncio`, `json`, `WebSocket`, and `WebSocketDisconnect` are already imported at the top of `main.py`, so this route needs no new imports beyond `base64`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terminal_ws.py`:

```python
"""The backend binds 127.0.0.1, but loopback is not an authorization boundary: any page in any browser on this machine can open a localhost WebSocket. An ungated route here is a remote shell for anything that can render HTML, so the refusal test is the most important one in this file."""

import base64
import json
import pytest
from fastapi.testclient import TestClient
import backend.main as main_mod


class p_StubSession:
    """Stands in for a real PTY so the route can be tested without spawning a shell."""

    def __init__(self):
        self.written = []
        self.sizes = []
        self.running = True
        self.shell = "pwsh.exe"
        self.cwd = "C:\\\\ws"
        self.p_callback = None

    def subscribe(self, callback):
        self.p_callback = callback
        callback(b"replayed")
        return lambda: None

    def write(self, data):
        self.written.append(data)

    def resize(self, cols, rows):
        self.sizes.append((cols, rows))

    @property
    def exit_code(self):
        return 0


@pytest.fixture
def p_stub(monkeypatch, tmp_path):
    session = p_StubSession()

    async def p_attach(workspace_id, instance, cwd):
        return session

    async def p_detach(workspace_id, instance):
        return None

    from backend.apps.terminal import manager as manager_mod
    monkeypatch.setattr(manager_mod.manager, "attach", p_attach, raising=True)
    monkeypatch.setattr(manager_mod.manager, "detach", p_detach, raising=True)
    monkeypatch.setattr(main_mod, "p_terminal_cwd", lambda ws: str(tmp_path), raising=False)
    return session


def test_connection_without_token_is_refused(monkeypatch):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: False, raising=True)
    client = TestClient(main_mod.app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/terminal/ws1"):
            pass


def test_status_then_replay_on_connect(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        status = json.loads(ws.receive_text())
        assert status["event"] == "term:status"
        assert status["data"]["shell"] == "pwsh.exe"
        out = json.loads(ws.receive_text())
        assert out["event"] == "term:output"
        assert base64.b64decode(out["data"]["data"]) == b"replayed"


def test_input_frame_reaches_the_session(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
        json.loads(ws.receive_text())
        payload = base64.b64encode(b"echo hi\r").decode("ascii")
        ws.send_text(json.dumps({"event": "term:input", "data": {"data": payload}}))
        ws.send_text(json.dumps({"event": "term:resize", "data": {"cols": 120, "rows": 40}}))
        # Round-trip a second input so the server has demonstrably processed the first.
        ws.send_text(json.dumps({"event": "term:input", "data": {"data": base64.b64encode(b"x").decode("ascii")}}))
        import time
        time.sleep(0.3)
    assert b"echo hi\r" in p_stub.written
    assert (120, 40) in p_stub.sizes


def test_malformed_frame_does_not_kill_the_socket(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
        json.loads(ws.receive_text())
        ws.send_text("not json at all")
        ws.send_text(json.dumps({"event": "term:input", "data": {"data": base64.b64encode(b"survived").decode("ascii")}}))
        import time
        time.sleep(0.3)
    assert b"survived" in p_stub.written
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_ws.py
```

Expected: FAIL — the route does not exist, so `websocket_connect` raises for every test.

- [ ] **Step 3: Add `base64` to the imports in `backend/main.py`**

The top import block (line 1-5) becomes:

```python
import asyncio
import base64
import html
import logging
import os
from uuid import uuid4
```

- [ ] **Step 4: Write the route**

Insert into `backend/main.py` immediately after the runtime-logs endpoint's `finally: unsubscribe()` (line 326):

```python
@typechecked
def p_terminal_cwd(workspace_id: str) -> str:
    """Resolve the directory the shell opens in: the card's workspace, falling back to home if it has vanished."""
    import os as p_os
    from backend.config.paths import OUTPUTS_WORKSPACE_DIR
    folder = p_os.path.join(OUTPUTS_WORKSPACE_DIR, workspace_id)
    return folder if p_os.path.isdir(folder) else p_os.path.expanduser("~")


@app.websocket("/ws/terminal/{workspace_id}")
async def websocket_terminal(websocket: WebSocket, workspace_id: str, instance: int = 1):
    """Bidirectional PTY channel for the app card's Shell tab. Unlike the runtime-logs
    socket this one reads: term:input carries keystrokes and term:resize carries the
    viewport. Frames are base64 because PTY output is raw bytes and a UTF-8 sequence
    can straddle a read boundary. No seq_log or gap detection here on purpose — a
    terminal's reconnect contract is just "hand me the current scrollback"."""
    if not p_ws_auth_ok(websocket):
        return
    await websocket.accept()
    from backend.apps.terminal.manager import manager as terminal_manager
    session = await terminal_manager.attach(workspace_id, instance, p_terminal_cwd(workspace_id))
    # Same bridge the runtime-logs route uses: subscribe() is a sync callback but the sender must await, so chunks land in a queue. subscribe replays synchronously, priming the queue before the send loop starts.
    queue: asyncio.Queue = asyncio.Queue()

    def p_on_chunk(chunk: bytes) -> None:
        try:
            queue.put_nowait(chunk)
        except asyncio.QueueFull:
            pass

    unsubscribe = session.subscribe(p_on_chunk)

    async def p_send_loop() -> None:
        while True:
            chunk = await queue.get()
            if not chunk:
                await websocket.send_text(json.dumps({
                    "event": "term:exit",
                    "data": {"code": session.exit_code if session.exit_code is not None else 0},
                }))
                return
            await websocket.send_text(json.dumps({
                "event": "term:output",
                "data": {"data": base64.b64encode(chunk).decode("ascii")},
            }))

    async def p_recv_loop() -> None:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                # A malformed frame is the client's problem; dropping it must not take down the shell.
                continue
            event = msg.get("event")
            data = msg.get("data") or {}
            if event == "term:input":
                try:
                    session.write(base64.b64decode(data.get("data") or ""))
                except Exception:
                    continue
            elif event == "term:resize":
                try:
                    session.resize(int(data.get("cols") or 80), int(data.get("rows") or 24))
                except Exception:
                    continue

    sender = asyncio.create_task(p_send_loop())
    receiver = asyncio.create_task(p_recv_loop())
    try:
        await websocket.send_text(json.dumps({
            "event": "term:status",
            "data": {"running": session.running, "shell": session.shell, "cwd": session.cwd},
        }))
        done, pending = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("terminal ws: failed for %s/%s", workspace_id, instance)
    finally:
        sender.cancel()
        receiver.cancel()
        unsubscribe()
        # Detach, never stop: the shell must outlive the socket so a tab switch or renderer reload resumes the same session.
        await terminal_manager.detach(workspace_id, instance)
```

Note: `p_terminal_cwd` needs `typechecked` in scope. If `main.py` does not already import it, add `from typeguard import typechecked` next to the other imports; if the linter objects to `@typechecked` in `main.py` because no other function there uses it, drop the decorator from this one function rather than adding a lone import.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_ws.py
```

Expected: PASS, 4 passed.

- [ ] **Step 6: Run the whole backend suite to confirm no regression**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly
```

Expected: the pre-existing baseline of 6 failures, with the passing count risen by the new tests. If any *new* failure appears, fix it before committing.

- [ ] **Step 7: Commit**

```bash
git add backend/main.py backend/tests/test_terminal_ws.py
git commit -m "feat(terminal): add authenticated bidirectional /ws/terminal route"
```

---

### Task 7: Real-ConPTY smoke test

Every test so far uses a fake backend. This is the one that proves a real shell actually runs and, more importantly, actually dies.

**Files:**
- Test: `backend/tests/test_terminal_conpty_smoke.py`

**Interfaces:**
- Consumes: `PtySession` (Task 3), `PtySessionManager` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `backend/tests/test_terminal_conpty_smoke.py`:

```python
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
    await asyncio.sleep(2.0)
    session.write(b"echo maestro-smoke\r\n")
    for _ in range(50):
        await asyncio.sleep(0.2)
        if b"maestro-smoke" in b"".join(chunks):
            break
    await session.stop()
    assert b"maestro-smoke" in b"".join(chunks)


@pytest.mark.asyncio
async def test_stop_leaves_no_running_shell(tmp_path):
    session = PtySession("smoke", 1, str(tmp_path))
    await session.start()
    await asyncio.sleep(1.0)
    assert session.running is True
    await session.stop()
    await asyncio.sleep(0.5)
    assert session.running is False
```

- [ ] **Step 2: Run it**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_terminal_conpty_smoke.py -v
```

Expected: PASS, 2 passed on Windows. If `test_real_shell_echoes_input` times out, the shell spawned but input is not reaching it — check `ConPtyBackend.write`'s encode/decode round trip before changing anything else.

- [ ] **Step 3: Confirm no shells leaked**

```bash
powershell -NoProfile -Command "Get-Process pwsh,powershell -ErrorAction SilentlyContinue | Select-Object Id,StartTime"
```

Expected: no process whose `StartTime` falls inside the test run. A survivor means `stop()` is not reaching the child tree.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_terminal_conpty_smoke.py
git commit -m "test(terminal): add real-ConPTY smoke test with leak assertion"
```

---

### Task 8: Frame codec (`terminalFrames.ts`)

The only frontend logic this repo's test tooling can actually cover: plain TypeScript, no JSX, no imports. Everything protocol-shaped lives here so it is testable, leaving the hook and component as thin shells.

**Files:**
- Create: `frontend/src/shared/terminalFrames.ts`
- Test: `frontend/src/shared/terminalFrames.test.ts`

**Interfaces:**
- Consumes: the wire protocol from Task 6.
- Produces:
  - `export interface TerminalStatus { running: boolean; shell: string; cwd: string }`
  - `export type TerminalFrame = { kind: 'status'; status: TerminalStatus } | { kind: 'output'; data: string } | { kind: 'exit'; code: number } | { kind: 'unknown' }`
  - `export function decodeTerminalFrame(raw: string): TerminalFrame`
  - `export function encodeInputFrame(data: string): string`
  - `export function encodeResizeFrame(cols: number, rows: number): string`

Task 9 imports all three functions.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shared/terminalFrames.test.ts`:

```typescript
// Run: node --test frontend/src/shared/terminalFrames.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerminalFrame, encodeInputFrame, encodeResizeFrame } from './terminalFrames.ts';

test('decodes a status frame', () => {
  const raw = JSON.stringify({ event: 'term:status', data: { running: true, shell: 'pwsh.exe', cwd: 'C:\\ws' } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'status');
  if (frame.kind !== 'status') return;
  assert.equal(frame.status.shell, 'pwsh.exe');
  assert.equal(frame.status.running, true);
});

test('decodes an output frame back to the original bytes', () => {
  const payload = Buffer.from('hello world').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, 'hello world');
});

test('round-trips multi-byte utf-8 through base64', () => {
  const original = 'olá — 日本語 ✓';
  const payload = Buffer.from(original, 'utf-8').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, original);
});

test('preserves ansi escape sequences', () => {
  const original = '\u001b[31mred\u001b[0m';
  const payload = Buffer.from(original, 'utf-8').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, original);
});

test('decodes an exit frame', () => {
  const raw = JSON.stringify({ event: 'term:exit', data: { code: 130 } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'exit');
  if (frame.kind !== 'exit') return;
  assert.equal(frame.code, 130);
});

test('malformed json decodes to unknown rather than throwing', () => {
  assert.equal(decodeTerminalFrame('not json').kind, 'unknown');
  assert.equal(decodeTerminalFrame('').kind, 'unknown');
  assert.equal(decodeTerminalFrame(JSON.stringify({ event: 'term:mystery' })).kind, 'unknown');
});

test('encodes an input frame the backend can decode', () => {
  const encoded = encodeInputFrame('echo hi\r');
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.event, 'term:input');
  assert.equal(Buffer.from(parsed.data.data, 'base64').toString('utf-8'), 'echo hi\r');
});

test('encodes ctrl-c as ordinary input', () => {
  const encoded = encodeInputFrame('\u0003');
  const parsed = JSON.parse(encoded);
  assert.equal(Buffer.from(parsed.data.data, 'base64').toString('utf-8'), '\u0003');
});

test('encodes a resize frame', () => {
  const parsed = JSON.parse(encodeResizeFrame(120, 40));
  assert.equal(parsed.event, 'term:resize');
  assert.equal(parsed.data.cols, 120);
  assert.equal(parsed.data.rows, 40);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test frontend/src/shared/terminalFrames.test.ts
```

Expected: FAIL — cannot resolve `./terminalFrames.ts`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/shared/terminalFrames.ts`:

```typescript
// Wire codec for the /ws/terminal channel, kept free of React and JSX so `node --test` can cover it.

export interface TerminalStatus {
  running: boolean;
  shell: string;
  cwd: string;
}

export type TerminalFrame =
  | { kind: 'status'; status: TerminalStatus }
  | { kind: 'output'; data: string }
  | { kind: 'exit'; code: number }
  | { kind: 'unknown' };

// Browsers have atob/btoa but neither handles multi-byte UTF-8; TextDecoder over the raw bytes is the only correct path, and Node provides both globals so the tests exercise the same code.
function p_decodeBase64(payload: string): string {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function p_encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeTerminalFrame(raw: string): TerminalFrame {
  let msg: { event?: string; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: 'unknown' };
  }
  const data = msg?.data ?? {};
  if (msg?.event === 'term:status') {
    return {
      kind: 'status',
      status: {
        running: Boolean(data.running),
        shell: String(data.shell ?? ''),
        cwd: String(data.cwd ?? ''),
      },
    };
  }
  if (msg?.event === 'term:output') {
    try {
      return { kind: 'output', data: p_decodeBase64(String(data.data ?? '')) };
    } catch {
      return { kind: 'unknown' };
    }
  }
  if (msg?.event === 'term:exit') {
    return { kind: 'exit', code: Number(data.code ?? 0) };
  }
  return { kind: 'unknown' };
}

export function encodeInputFrame(data: string): string {
  return JSON.stringify({ event: 'term:input', data: { data: p_encodeBase64(data) } });
}

export function encodeResizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ event: 'term:resize', data: { cols, rows } });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test frontend/src/shared/terminalFrames.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/terminalFrames.ts frontend/src/shared/terminalFrames.test.ts
git commit -m "feat(terminal): add tested base64 frame codec for the terminal socket"
```

---

### Task 9: `useTerminalSocket` hook

**Files:**
- Create: `frontend/src/shared/hooks/useTerminalSocket.ts`
- Modify: `frontend/package.json` (add xterm deps)

**Interfaces:**
- Consumes: `decodeTerminalFrame`, `encodeInputFrame`, `encodeResizeFrame`, `TerminalStatus` from Task 8; `API_BASE` and `getAuthToken` from `@/shared/config`.
- Produces: `export function useTerminalSocket(opts: TerminalSocketOptions): TerminalSocketState` where
  - `TerminalSocketOptions = { workspaceId: string | null | undefined; enabled?: boolean; instance?: number; onOutput?: (data: string) => void }`
  - `TerminalSocketState = { status: TerminalStatus | null; exitCode: number | null; sendInput: (data: string) => void; sendResize: (cols: number, rows: number) => void }`

Task 10 consumes exactly this.

- [ ] **Step 1: Add the xterm dependencies**

```bash
cd frontend && npm install --save @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0
```

Expected: both appear under `dependencies` in `frontend/package.json` and `package-lock.json` updates.

- [ ] **Step 2: Write the hook**

Create `frontend/src/shared/hooks/useTerminalSocket.ts`:

```typescript
// Raw WebSocket rather than WebSocketManager: that class is session/dashboard-scoped and dispatches into Redux, and terminal bytes have no business passing through the store. Mirrors useRuntimePreviewUrl's ref-pinned-callback shape.

import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAuthToken } from '@/shared/config';
import {
  decodeTerminalFrame,
  encodeInputFrame,
  encodeResizeFrame,
  TerminalStatus,
} from '@/shared/terminalFrames';

export interface TerminalSocketOptions {
  workspaceId: string | null | undefined;
  /** Gate the connect so a hidden Shell tab does not spawn a shell nobody asked for. */
  enabled?: boolean;
  instance?: number;
  onOutput?: (data: string) => void;
}

export interface TerminalSocketState {
  status: TerminalStatus | null;
  exitCode: number | null;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useTerminalSocket(opts: TerminalSocketOptions): TerminalSocketState {
  const { workspaceId, enabled = true, instance = 1, onOutput } = opts;
  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Pin the latest callback so its identity changing never tears down the socket and respawns the shell.
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;

  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let cancelled = false;
    setStatus(null);
    setExitCode(null);
    const auth = getAuthToken();
    const wsBase = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');
    const url = `${wsBase}/ws/terminal/${workspaceId}?token=${encodeURIComponent(auth || '')}&instance=${instance}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (cancelled) return;
        const frame = decodeTerminalFrame(String(ev.data));
        if (frame.kind === 'status') setStatus(frame.status);
        else if (frame.kind === 'output') onOutputRef.current?.(frame.data);
        else if (frame.kind === 'exit') setExitCode(frame.code);
      };
    } catch {
      // Construction failure leaves status null; the pane renders its disconnected state.
    }
    return () => {
      cancelled = true;
      try { ws?.close(); } catch { /* already gone */ }
      wsRef.current = null;
    };
  }, [workspaceId, enabled, instance]);

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encodeInputFrame(data));
  };

  const sendResize = (cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encodeResizeFrame(cols, rows));
  };

  return { status, exitCode, sendInput, sendResize };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. There is no unit test for this file — Node's test runner cannot import React (see Global Constraints); the logic worth testing already lives in Task 8's codec.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/shared/hooks/useTerminalSocket.ts
git commit -m "feat(terminal): add useTerminalSocket hook and xterm dependencies"
```

---

### Task 10: `ShellPanel` component

**Files:**
- Create: `frontend/src/app/pages/Views/ShellPanel.tsx`

**Interfaces:**
- Consumes: `useTerminalSocket` (Task 9), `useTermColors` from `@/app/pages/AgentChat/parsing/toolColorize`, `useClaudeTokens` from `@/shared/styles/ThemeContext`.
- Produces: `export function ShellPanel(props: { workspaceId: string; instance: number; active: boolean })`.

Task 11 mounts exactly this.

- [ ] **Step 1: Write the component**

Create `frontend/src/app/pages/Views/ShellPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useTermColors } from '@/app/pages/AgentChat/parsing/toolColorize';
import { useTerminalSocket } from '@/shared/hooks/useTerminalSocket';

interface ShellPanelProps {
  workspaceId: string;
  instance: number;
  /** False while another tab is showing; the pane stays mounted but must not fit or focus. */
  active: boolean;
}

export function ShellPanel({ workspaceId, instance, active }: ShellPanelProps) {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const tc = useTermColors();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // The socket's onOutput fires before the effect below assigns termRef in some orders; writing through a ref avoids dropping the replay burst.
  const writeRef = useRef<(data: string) => void>(() => {});

  const { status, exitCode, sendInput, sendResize } = useTerminalSocket({
    workspaceId,
    instance,
    enabled: true,
    onOutput: (data) => writeRef.current(data),
  });

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: c.font.mono,
      fontSize: 12,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: tc.TERM_BG,
        foreground: tc.OUTPUT,
        cursor: tc.CMD,
        selectionBackground: `${tc.CMD}44`,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    writeRef.current = (data: string) => term.write(data);
    const disposable = term.onData((data) => sendInput(data));
    return () => {
      disposable.dispose();
      writeRef.current = () => {};
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [workspaceId, instance]);

  useEffect(() => {
    if (!active || !hostRef.current || !fitRef.current) return;
    // Fitting a hidden element measures zero and collapses the viewport to 1x1, so this only runs while visible.
    const doFit = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term) sendResize(term.cols, term.rows);
      } catch { /* element not laid out yet */ }
    };
    doFit();
    termRef.current?.focus();
    const observer = new ResizeObserver(doFit);
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [active, status]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: tc.TERM_BG }}>
      <Box ref={hostRef} sx={{ flex: 1, minHeight: 0, p: 0.5, '& .xterm': { height: '100%' } }} />
      {exitCode !== null && (
        <Typography sx={{ px: 1, py: 0.5, fontFamily: c.font.mono, fontSize: '0.7rem', color: c.text.muted }}>
          {t('views.shell.exited', { code: exitCode })}
        </Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Verify the term color names exist**

The theme above references `tc.TERM_BG`, `tc.OUTPUT`, and `tc.CMD`. Confirm those are the real property names before trusting the build:

```bash
grep -n "TERM_BG\|OUTPUT\|CMD" frontend/src/app/pages/AgentChat/parsing/toolColorize.tsx | head -20
```

If any name differs, use the actual name from that file rather than adding one.

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. If `@xterm/xterm/css/xterm.css` fails to resolve as a module, the webpack config needs no change — but the TS side may need a `declare module '*.css'` entry; check whether `frontend/src/` already has one before adding it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/Views/ShellPanel.tsx
git commit -m "feat(terminal): add ShellPanel xterm.js pane"
```

---

### Task 11: Wire the tab strip — `terminal` becomes `logs`, add `shell`

**Files:**
- Modify: `frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx` (line 39 type; line 561 tab array; line 588 tooltip; lines 662-678 pane block; the `activeView === 'terminal'` reference near line 401)
- Modify: `frontend/src/shared/i18n/en.json`
- Modify: `frontend/src/shared/i18n/pt-BR.json`

**Interfaces:**
- Consumes: `ShellPanel` from Task 10.
- Produces: nothing downstream.

- [ ] **Step 1: Widen the view union**

In `DashboardViewCard.tsx` line 39, replace:

```tsx
type AppCardView = 'preview' | 'code' | 'terminal' | 'history';
```

with:

```tsx
type AppCardView = 'preview' | 'code' | 'logs' | 'shell' | 'history';
```

- [ ] **Step 2: Rename every `'terminal'` occurrence to `'logs'`**

Find them all first:

```bash
grep -n "'terminal'" frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx
```

Expected hits at roughly lines 401, 561, 588, and 664. Change each `activeView === 'terminal'` to `activeView === 'logs'` and the tab array's `view: 'terminal' as const` to `view: 'logs' as const`. The behavior at each site is unchanged — the read-only log pane keeps its hard-reload semantics.

- [ ] **Step 3: Add the Shell tab to the strip**

In the tab array at line 558-563, add an entry after the `logs` one so the strip reads preview, code, logs, shell, history:

```tsx
{([
  { view: 'preview' as const, labelKey: 'dashboard.viewCard.preview', Icon: VisibilityRoundedIcon },
  { view: 'code' as const, labelKey: 'dashboard.viewCard.code', Icon: CodeRoundedIcon },
  { view: 'logs' as const, labelKey: 'dashboard.viewCard.logs', Icon: TerminalRoundedIcon },
  { view: 'shell' as const, labelKey: 'dashboard.viewCard.shell', Icon: KeyboardCommandKeyRoundedIcon },
  { view: 'history' as const, labelKey: 'dashboard.viewCard.history', Icon: HistoryRoundedIcon },
]).map(({ view, labelKey, Icon }) => (
```

Add the icon import next to the other MUI icon imports at the top of the file:

```tsx
import KeyboardCommandKeyRoundedIcon from '@mui/icons-material/KeyboardCommandKeyRounded';
```

- [ ] **Step 4: Render the Shell pane**

Replace the pane block at lines 662-678 with:

```tsx
{output.workspace_id && activeView !== 'preview' && (
  <Box sx={{ position: 'absolute', inset: 0, zIndex: 13, bgcolor: c.bg.surface }}>
    {activeView === 'logs' ? (
      <TerminalPanel lines={terminalLines} />
    ) : activeView === 'history' ? (
      <Box sx={{ height: '100%', overflow: 'auto' }}>
        <HistoryPanel
          outputId={output.id}
          isAgentActive={showBuildingOverlay}
          onRestored={() => previewRef.current?.reload()}
        />
      </Box>
    ) : activeView === 'shell' ? null : (
      <AppCodePanel workspaceId={output.workspace_id} onFileSaved={() => previewRef.current?.reload()} />
    )}
  </Box>
)}
{/* Shell sits outside the overlay switch and stays mounted once opened: re-initializing xterm and re-fitting on every tab switch is visibly jarring, even though the PTY itself survives server-side. */}
{output.workspace_id && shellOpened && (
  <Box sx={{ position: 'absolute', inset: 0, zIndex: 13, bgcolor: c.bg.surface, visibility: activeView === 'shell' ? 'visible' : 'hidden' }}>
    <ShellPanel workspaceId={output.workspace_id} instance={instance} active={activeView === 'shell'} />
  </Box>
)}
```

- [ ] **Step 5: Add the `shellOpened` latch and the import**

Next to the other state declarations (around line 161), add:

```tsx
// Latches on first visit so the shell is never spawned for a card the user never opened it on, but survives every tab switch after.
const [shellOpened, setShellOpened] = useState(false);
```

Immediately after it, add the effect that sets it:

```tsx
useEffect(() => {
  if (activeView === 'shell') setShellOpened(true);
}, [activeView]);
```

And import the component next to the other panel imports:

```tsx
import { ShellPanel } from '@/app/pages/Views/ShellPanel';
```

- [ ] **Step 6: Add the i18n keys to `en.json`**

In the `dashboard.viewCard` object, rename `"terminal"` to `"logs"` and add `"shell"`:

```json
"logs": "Logs",
"shell": "Shell",
```

Add a `views.shell` object next to `views.terminal`:

```json
"shell": {
  "exited": "Shell exited with code {{code}}",
  "connecting": "Starting shell…"
}
```

- [ ] **Step 7: Add the identical key paths to `pt-BR.json`**

In `dashboard.viewCard`:

```json
"logs": "Logs",
"shell": "Terminal",
```

In `views`:

```json
"shell": {
  "exited": "O terminal encerrou com código {{code}}",
  "connecting": "Iniciando terminal…"
}
```

- [ ] **Step 8: Verify i18n parity**

```bash
node scripts/check-i18n-parity.mjs
```

Expected: pass. This is a hard-failing gate in `npm run verify`, so a missing pt-BR key breaks the build, not just the translation.

- [ ] **Step 9: Confirm no stale `dashboard.viewCard.terminal` reference survives**

```bash
grep -rn "viewCard.terminal" frontend/src/
```

Expected: no hits. If any remain, point them at `dashboard.viewCard.logs`.

- [ ] **Step 10: Typecheck and lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/app/pages/Dashboard/cards/DashboardViewCard.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/pt-BR.json
git commit -m "feat(terminal): split view-card tab into Logs and interactive Shell"
```

---

### Task 12: Full verification

**Files:**
- Modify: none expected; fix whatever the gate surfaces.

**Interfaces:**
- Consumes: every task above.
- Produces: a merge-ready branch.

- [ ] **Step 1: Run the full gate**

```bash
npm run verify
```

This runs lint → typecheck → webpack build → golden e2e → backend pytest, then `check-callhome.mjs`, `check-fork-drift.mjs`, and `check-i18n-parity.mjs`.

- [ ] **Step 2: Confirm the backend baseline held**

The backend step must show the pre-existing 6 failures and no others. If a new failure appears, it belongs to this branch — fix it rather than adding a `--deselect`.

- [ ] **Step 3: Measure what xterm.js cost the bundle**

The spec's risk table flags bundle growth against an installer deliberately trimmed to 389 MB. Compare the built bundle against the pre-branch size:

```bash
cd frontend && npm run build && ls -la build/static/js/
git stash list
```

Expected: roughly 250 KB of growth from `@xterm/xterm` plus the fit addon. If it is dramatically more, check whether the whole `@xterm` package tree was pulled in rather than tree-shaken.

- [ ] **Step 4: Manually drive the terminal once**

Automated tests cover the codec, the session, and the route, but nothing has yet typed into a real terminal through the real UI. Launch the app, open an app card, click the Shell tab, and confirm:

- a prompt appears within a few seconds, in the card's workspace directory
- `dir` (or `ls`) prints readable output with colors intact
- resizing the card reflows the terminal rather than clipping it
- switching to Logs and back preserves the scrollback and the shell's state (`cd` somewhere, switch away, switch back, confirm you are still there)
- `echo $env:PROVEDOR_IA_TOKEN` prints nothing, confirming the env scrub
- closing the card and reopening it within the idle window resumes the same session

- [ ] **Step 5: Confirm no shells leak on quit**

Quit the app entirely, then:

```bash
powershell -NoProfile -Command "Get-Process pwsh,powershell -ErrorAction SilentlyContinue | Select-Object Id,StartTime"
```

Expected: nothing left over from the session. A survivor means the SubApp lifespan from Task 5 is not running on this shutdown path — check whether Electron kills the backend hard enough to skip lifespans, and if so, hook the reap into the existing pre-quit shutdown POST instead.

- [ ] **Step 6: Commit any fixes and push**

```bash
git push -u origin worktree-terminal-support
```
