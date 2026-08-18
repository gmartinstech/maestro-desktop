"""Shell resolution must be deterministic, platform-correct, and ABSOLUTE: pywinpty's spawn() feeds argv[0] to shutil.which and raises FileNotFoundError on a bare name it cannot find, so a relative shell name is a terminal that opens to nothing."""

import os
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


def test_resolve_shell_returns_an_absolute_existing_path():
    argv = resolve_shell()
    assert os.path.isabs(argv[0]), f"shell must be absolute for pywinpty.spawn, got {argv[0]}"
    assert os.path.isfile(argv[0]), f"resolved shell does not exist: {argv[0]}"


@pytest.mark.skipif(sys.platform != "win32", reason="windows shell resolution")
def test_resolve_shell_windows_prefers_pwsh(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: r"C:\pwsh\pwsh.exe" if name == "pwsh.exe" else None)
    argv = resolve_shell()
    assert argv[0] == r"C:\pwsh\pwsh.exe"
    assert "-NoLogo" in argv


@pytest.mark.skipif(sys.platform != "win32", reason="windows shell resolution")
def test_resolve_shell_windows_falls_back_to_absolute_powershell(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: None)
    argv = resolve_shell()
    assert os.path.isabs(argv[0])
    assert argv[0].lower().endswith("powershell.exe")
    assert "-NoLogo" in argv
