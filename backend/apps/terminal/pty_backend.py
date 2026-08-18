"""The platform seam for pseudo-terminals. Everything above this file is platform-agnostic, so swapping the Windows implementation (pywinpty today, ctypes/ConPTY if the wheel ever stops shipping) must not touch PtySession or the WS route."""

import asyncio
import os
import shutil
import sys
from typing import Dict, List, Optional, Protocol, runtime_checkable
from typeguard import typechecked


@typechecked
def p_windows_powershell_fallback() -> str:
    """Absolute path to the always-present Windows PowerShell, used when pwsh is not installed."""
    system_root = os.environ.get("SystemRoot") or r"C:\Windows"
    return os.path.join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")


@typechecked
def resolve_shell() -> List[str]:
    """Return the argv for an interactive shell. argv[0] is always absolute because pywinpty's spawn() feeds it to shutil.which and raises FileNotFoundError on an unresolvable bare name."""
    if sys.platform == "win32":
        # pwsh is the modern cross-platform PowerShell; Windows PowerShell is the guaranteed fallback.
        pwsh = shutil.which("pwsh.exe")
        if pwsh:
            return [pwsh, "-NoLogo"]
        return [p_windows_powershell_fallback(), "-NoLogo"]
    shell = os.environ.get("SHELL") or shutil.which("bash") or "/bin/bash"
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
            # pywinpty's read() blocks and returns str; the executor hop is what keeps one terminal from stalling every other socket.
            chunk = await loop.run_in_executor(None, self.p_proc.read)
        except EOFError:
            chunk = ""
        except Exception:
            chunk = ""
        if not chunk:
            status = getattr(self.p_proc, "exitstatus", None)
            self.p_exit_code = status if status is not None else 0
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
