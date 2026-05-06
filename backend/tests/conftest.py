"""Shared fixtures for the backend test suite.

The hard part of testing this app is environment setup — every sub-app
reads `OPENSWARM_DATA_DIR` (via `backend.config.paths`) at import time and
several lifespans kick off network/IO side effects (PostHog, 9Router,
MCP registry refresh). This conftest centralises that boilerplate so a
new endpoint test can be a one-liner:

    def test_x(client):
        r = client.get("/api/x/list")
        assert r.status_code == 200

What's done here:

  1. `OPENSWARM_DATA_DIR` is redirected to a fresh tmpdir BEFORE any
     `backend.*` import. Same trick as the existing stress-test files.
  2. PostHog is replaced with a Mock so `record(...)` never tries to
     phone home.
  3. `nine_router.ensure_running` is no-opped so the analytics lifespan
     doesn't try to spawn a node subprocess.
  4. Exposes a `client` fixture that builds a TestClient against the real
     `backend.main:app`, drives the FastAPI lifespan (which seeds the
     built-in modes / runs the dashboards migration), and pre-injects
     the per-install bearer token.
  5. Opt-in fixtures (`patched_skills_dir`, `stub_agent_loop`) for
     individual test files that need extra isolation.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Iterator
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# Pre-import bootstrap: redirect data dir BEFORE backend.* is imported.
# ---------------------------------------------------------------------------
# This MUST happen at module load time. backend/config/paths.py snapshots
# the env var into module-level constants (DATA_ROOT, SESSIONS_DIR, etc.),
# so any backend.* import after this line will pick up our tmp root.

_TMPROOT = tempfile.mkdtemp(prefix="openswarm-tests-")
os.environ["OPENSWARM_DATA_DIR"] = _TMPROOT
# Defensive: never let any test run hit the real OAuth helper service.
os.environ.setdefault("OPENSWARM_OAUTH_BASE_URL", "http://127.0.0.1:0")

# Re-home the user. Several agent paths fall back to `~/.openswarm/workspaces/...`
# when no default_folder/target_directory is configured (see
# `AgentManager.launch_agent`). On a CI runner that's likely fine, but on a
# developer machine it would write into the real home directory — and on
# sandboxed runs (e.g. agent tests under macOS sandbox) it fails outright with
# PermissionError. Pinning HOME inside the tmp root keeps the tests
# self-contained AND prevents accidental writes to the user's `~/.claude/skills`.
_FAKE_HOME = os.path.join(_TMPROOT, "home")
os.makedirs(_FAKE_HOME, exist_ok=True)
os.environ["HOME"] = _FAKE_HOME


# ---------------------------------------------------------------------------
# Mock external services BEFORE backend.main is imported.
# ---------------------------------------------------------------------------

def _install_external_service_mocks() -> None:
    """Patch PostHog + 9Router so lifespans don't make outbound calls.

    Called once at module load. We don't unwind these — they live for
    the entire pytest session (matching the lifetime of the app fixture).
    """
    # PostHog: replace the class so `Posthog(...)` returns a mock that
    # silently absorbs `.capture(...)` / `.set(...)` / `.shutdown()`.
    import posthog
    _posthog_mock = MagicMock()
    _posthog_mock.capture = MagicMock()
    _posthog_mock.set = MagicMock()
    _posthog_mock.shutdown = MagicMock()
    posthog.Posthog = MagicMock(return_value=_posthog_mock)


_install_external_service_mocks()


# ---------------------------------------------------------------------------
# Now safe to import backend.* — paths are pinned to _TMPROOT, posthog
# is a mock.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def app():
    """The real FastAPI app, lifespan NOT yet run.

    Importing main is what registers all routers and middleware. We
    additionally patch out the real 9Router and Skills sync triggers
    that the analytics + settings lifespans spawn.
    """
    # nine_router.ensure_running (called from analytics_lifespan) tries
    # to pgrep / spawn a Node process. Replace with no-ops, matching
    # each function's original sync/async shape (mismatch produces a
    # "coroutine was never awaited" RuntimeWarning).
    from backend.apps import nine_router as _nine

    async def _async_noop(*args, **kwargs):
        return None

    def _sync_noop(*args, **kwargs):
        return None

    _nine.ensure_running = _async_noop  # type: ignore[assignment]
    _nine.stop = _sync_noop  # type: ignore[assignment]
    _nine.sync_gemini_api_key = _async_noop  # type: ignore[assignment]
    _nine.sync_openswarm_pro_as_claude = _async_noop  # type: ignore[assignment]

    from backend.main import app as _app

    return _app


@pytest.fixture(scope="session")
def auth_token() -> str:
    """Initialise the per-install bearer token once for the session."""
    from backend.auth import get_auth_token, init_auth_token

    token = get_auth_token() or init_auth_token()
    return token


@pytest.fixture(scope="session")
def auth_headers(auth_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def tmp_data_dirs(monkeypatch) -> Iterator[str]:
    """Wipe + recreate every per-feature data dir before each test.

    Keeps tests order-independent. We don't move DATA_ROOT itself
    (paths.py snapshotted that at import time); we just clear the
    children so a previous test's mode/dashboard/tool/etc files don't
    leak into the next.
    """
    from backend.config import paths as _p

    targets = [
        _p.SESSIONS_DIR,
        _p.MODES_DIR,
        _p.DASHBOARDS_DIR,
        _p.SETTINGS_DIR,
        _p.TOOLS_DIR,
        _p.OUTPUTS_DIR,
        _p.OUTPUTS_WORKSPACE_DIR,
        _p.SKILLS_WORKSPACE_DIR,
        _p.DASHBOARD_LAYOUT_DIR,
    ]
    for d in targets:
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d, exist_ok=True)

    # Drop in-memory agent_manager state that survived a prior test.
    try:
        from backend.apps.agents.agent_manager import agent_manager as _am

        _am.sessions.clear()
        _am.tasks.clear()
    except Exception:
        pass

    # Drop in-memory seq_log state too. Session ids are UUIDs so cross-test
    # collisions are vanishingly rare, but a leaked ring buffer between
    # tests can still produce confusing replay results in any test that
    # inspects seq_log directly.
    try:
        from backend.apps.agents.seq_log import seq_log as _sl

        _sl._per_session.clear()
    except Exception:
        pass

    yield _p.DATA_ROOT


@pytest.fixture
def client(app, auth_headers, tmp_data_dirs):
    """A pre-authenticated TestClient with FastAPI lifespan running.

    The `with` block triggers startup events — this is what seeds the
    built-in modes (modes_lifespan) and runs the dashboards migration
    (dashboards_lifespan). Without it the modes endpoint would return
    an empty list and the dashboards list would be empty too.
    """
    from fastapi.testclient import TestClient

    # Per-test: seed the built-ins manually too. Lifespan only seeds
    # them if the directory is empty, which `tmp_data_dirs` guarantees.
    with TestClient(app) as tc:
        tc.headers.update(auth_headers)
        yield tc


# ---------------------------------------------------------------------------
# Opt-in fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_skills_dir(monkeypatch, tmp_path) -> str:
    """Repoint backend.apps.skills at a tmp dir.

    The real SKILLS_DIR lives at `~/.claude/skills` and is shared with
    the user's actual Claude Code install. Tests must never touch it.
    Hard-asserts that the patched path is inside the test tmpdir before
    yielding.
    """
    from backend.apps.skills import skills as skills_mod

    skills_root = str(tmp_path / "skills")
    os.makedirs(skills_root, exist_ok=True)

    # Sanity gate — fail fast if pytest's tmp_path is somehow ~/.claude.
    real_skills = os.path.expanduser("~/.claude/skills")
    assert os.path.abspath(skills_root) != os.path.abspath(real_skills), (
        "patched_skills_dir would clobber the real ~/.claude/skills"
    )

    monkeypatch.setattr(skills_mod, "SKILLS_DIR", skills_root)
    monkeypatch.setattr(
        skills_mod, "INDEX_PATH", os.path.join(skills_root, ".skills_index.json")
    )
    return skills_root


@pytest.fixture
def stub_agent_loop(monkeypatch):
    """Replace AgentManager._run_agent_loop with a no-op coroutine.

    Lets routes that internally `asyncio.create_task(self._run_agent_loop(...))`
    succeed without spawning the Claude Code CLI / making real model calls.
    """
    from backend.apps.agents.agent_manager import AgentManager

    async def _noop(self, session_id, prompt, *args, **kwargs):
        return None

    monkeypatch.setattr(AgentManager, "_run_agent_loop", _noop)
