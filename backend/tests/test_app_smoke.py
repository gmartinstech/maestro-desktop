"""App-level smoke test.

Goal: catch the failure mode where adding a new sub-app silently breaks
imports, or a refactor accidentally drops a router from the
`MainApp([...])` registration list in `backend/main.py`. Hits no business
logic — just verifies the FastAPI app boots and its OpenAPI surface
contains the routes we expect every release to ship.
"""

from __future__ import annotations


def test_app_module_imports():
    """Importing backend.main must not raise.

    A regression in any sub-app module would surface here as an
    ImportError during collection. Cheap canary worth keeping
    independent of the other tests.
    """
    from backend.main import app

    assert app is not None


def test_openapi_lists_expected_routes(client):
    """Each long-lived sub-app's flagship route must appear in /openapi.json.

    These are intentionally one-per-router so adding/removing an
    individual endpoint doesn't churn the test, but accidentally
    dropping an entire sub-app from `MainApp([...])` breaks loudly.
    """
    resp = client.get("/openapi.json")
    assert resp.status_code == 200

    paths = set(resp.json()["paths"].keys())
    expected = {
        "/api/health/check",
        "/api/modes/list",
        "/api/dashboards/list",
        "/api/agents/sessions",
        "/api/settings",
        "/api/tools/list",
        "/api/skills/list",
        "/api/outputs/list",
    }
    missing = expected - paths
    assert not missing, f"Routes missing from /openapi.json: {missing}"


def test_app_has_cors_and_auth_middleware(app):
    """Defensive: regression-guard the security posture of the app.

    The CORS + auth middlewares are added unconditionally in main.py.
    If a refactor ever drops one, this test catches it before it ships.
    """
    middleware_names = [m.cls.__name__ for m in app.user_middleware]
    assert any("CORS" in n for n in middleware_names), (
        f"CORSMiddleware missing from app — saw {middleware_names}"
    )
