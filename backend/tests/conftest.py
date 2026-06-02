"""Shared test fixtures.

Isolate the persistent browser-skill store (and metrics) into throwaway temp
dirs for the whole test session, so tests never write skills/metrics into the
real ~/Library/Application Support/OpenSwarm/data tree (which would pollute the
dev machine and let a stale persisted skill leak across test runs).
"""

import os
import tempfile

import pytest


@pytest.fixture(autouse=True)
def _isolate_browser_state(monkeypatch):
    skills_dir = tempfile.mkdtemp(prefix="os_skills_")
    metrics_dir = tempfile.mkdtemp(prefix="os_metrics_")
    monkeypatch.setenv("OPENSWARM_BROWSER_SKILLS_DIR", skills_dir)
    monkeypatch.setenv("OPENSWARM_BROWSER_METRICS_DIR", metrics_dir)
    try:
        from backend.apps.agents.browser import browser_skills as sk
        sk.clear(wipe_disk=True)
    except Exception:
        pass
    yield
    try:
        from backend.apps.agents.browser import browser_skills as sk
        sk.clear(wipe_disk=True)
    except Exception:
        pass
