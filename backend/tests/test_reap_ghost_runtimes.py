"""A reaper that misjudges ownership kills working apps, so ownership is the thing under test.

The first draft matched on the workspace path alone; a dry run on a live machine showed it would
have killed 14 running app runtimes whose backend was up. These pin the discriminator.
"""

import os
from unittest.mock import patch

from backend.apps.outputs import reap_ghost_runtimes as mod


def p_ps(pid_args: str, pid_ppid: str):
    """Fake `ps` with two different outputs depending on the requested format."""
    class R:
        def __init__(self, out): self.stdout = out
    def run(cmd, **kw):
        return R(pid_args if "args=" in cmd[-1] or "pid=,args=" in " ".join(cmd) else pid_ppid)
    return run


def test_runtime_owned_by_a_live_backend_is_never_reaped():
    ws = os.path.abspath(mod.WORKSPACE_DIR)
    args = f"100 python -m uvicorn backend.main:app\n200 node {ws}/app/vite\n"
    ppid = "100 1\n200 100\n"
    with patch.object(mod.subprocess, "run", side_effect=p_ps(args, ppid)):
        assert mod.find_ghost_runtime_pids() == []


def test_runtime_whose_backend_died_is_reaped():
    ws = os.path.abspath(mod.WORKSPACE_DIR)
    args = f"200 node {ws}/app/vite\n"          # no uvicorn anywhere
    ppid = "200 1\n"                             # reparented to init
    with patch.object(mod.subprocess, "run", side_effect=p_ps(args, ppid)):
        assert mod.find_ghost_runtime_pids() == [200]


def test_ownership_is_inherited_through_the_bash_wrapper():
    """run.sh sits between the backend and vite; the walk must climb past it."""
    ws = os.path.abspath(mod.WORKSPACE_DIR)
    args = f"100 python -m uvicorn backend.main:app\n150 bash run.sh\n200 node {ws}/app/vite\n"
    ppid = "100 1\n150 100\n200 150\n"
    with patch.object(mod.subprocess, "run", side_effect=p_ps(args, ppid)):
        assert mod.find_ghost_runtime_pids() == []


def test_unrelated_processes_are_never_matched():
    """A user's own npm dev server elsewhere on the machine must be invisible to this."""
    args = "300 node /Users/someone/other-project/vite\n"
    ppid = "300 1\n"
    with patch.object(mod.subprocess, "run", side_effect=p_ps(args, ppid)):
        assert mod.find_ghost_runtime_pids() == []


def test_a_broken_ps_reaps_nothing_rather_than_guessing():
    def boom(*a, **k):
        raise OSError("ps unavailable")
    with patch.object(mod.subprocess, "run", side_effect=boom):
        assert mod.find_ghost_runtime_pids() == []
        assert mod.reap_ghost_runtimes() == 0
