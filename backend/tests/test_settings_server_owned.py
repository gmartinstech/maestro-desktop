"""Server-owned settings fields must survive full-object PUTs from the renderer.

Reproduces the production bug where a Settings save built from a stale snapshot
(the renderer PUTs the ENTIRE AppSettings object) silently wiped
maestro_bearer_token + connection_mode. The fix: identity/connection fields are
written only by their dedicated flows; PUT /api/settings preserves whatever is on
disk for them.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    import backend.auth as auth_mod
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    return TestClient(app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})


@pytest.fixture
def reset_settings():
    from backend.apps.settings.settings import load_settings, save_settings

    original = load_settings().model_copy(deep=True)
    yield
    save_settings(original)


def p_seed_server_owned(token="repro-bearer-0123456789abcdef"):
    """Write the server-owned fields the way their dedicated flow would."""
    from backend.apps.settings.settings import load_settings, save_settings

    s = load_settings()
    s.maestro_bearer_token = token
    s.user_id = "u-real"
    save_settings(s)
    return token


def test_stale_settings_put_cannot_wipe_server_owned_state(client, reset_settings):
    """Snapshot settings, have a dedicated flow write server-owned fields, then
    PUT the stale snapshot back (renderer Save of a pre-write draft). The
    server-owned fields must survive; the user's editable change must apply."""
    snapshot = client.get("/api/settings").json()
    assert snapshot is not None

    token = p_seed_server_owned()

    stale = dict(snapshot)
    stale["user_name"] = "Stale Draft Save"
    r = client.put("/api/settings", json=stale)
    assert r.status_code == 200

    from backend.apps.settings.settings import load_settings
    s = load_settings()
    assert s.user_name == "Stale Draft Save"
    assert s.maestro_bearer_token == token, "stale PUT wiped the bearer"
    assert s.user_id == "u-real", "stale PUT wiped the user id"

    body = r.json()["settings"]
    assert body["maestro_bearer_token"] == token


def test_put_cannot_inject_server_owned_fields(client, reset_settings):
    """The inverse direction: a client PUT must not be able to SET connection or
    identity state either (it would imply entitlement nothing ever granted)."""
    snapshot = client.get("/api/settings").json()
    forged = dict(snapshot)
    forged["connection_mode"] = "forged-mode"
    forged["maestro_bearer_token"] = "forged-bearer-fedcba9876543210"
    forged["user_id"] = "u-forged"

    r = client.put("/api/settings", json=forged)
    assert r.status_code == 200

    from backend.apps.settings.settings import load_settings
    s = load_settings()
    assert s.maestro_bearer_token == snapshot.get("maestro_bearer_token")
    assert s.connection_mode == snapshot.get("connection_mode")
    assert s.user_id == snapshot.get("user_id")
