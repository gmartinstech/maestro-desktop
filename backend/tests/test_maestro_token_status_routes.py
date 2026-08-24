"""The hand-pasted-JWT path is gone; sign-in is Keycloak-only now.

Split out of test_maestro_token_status.py to stay under the 300-line file
convention. This file covers the settings-app HTTP routes: the removed
paste endpoint, the renamed token-status route, and the Keycloak login-start
route.
"""

from __future__ import annotations

import pytest

from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


def test_the_paste_endpoint_no_longer_exists(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
    r = client.post("/api/settings/provedor-ia/token", json={"token": "anything"})
    assert r.status_code == 404


def test_the_renamed_token_status_route_answers(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    from backend.apps.settings.settings import load_settings, save_settings
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    original = load_settings().model_copy(deep=True)
    # A hand-pasted JWT would be purged by the upgrade migration on the next load; use
    # the still-supported opaque credential type instead to exercise the route itself.
    opaque = "mtok_a_static_api_key_0000"
    try:
        s = load_settings()
        s.provedor_ia_token = opaque
        save_settings(s)
        client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
        old_route = client.get("/api/settings/provedor-ia/token-status")
        assert old_route.status_code == 404
        status = client.get("/api/settings/maestro/token-status")
        assert status.status_code == 200 and status.json()["state"] == "opaque"
        # The status route must not leak the token it just classified.
        assert opaque not in status.text
    finally:
        save_settings(original)


def test_login_start_returns_a_keycloak_authorize_url_and_stores_pending_state(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    from backend.apps.oauth_state import pending_oauth
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
    r = client.post("/api/settings/maestro/login/start")
    assert r.status_code == 200
    authorize_url = r.json()["authorize_url"]
    assert authorize_url.startswith("https://martinstech.net/auth/realms/MartinsTech/protocol/openid-connect/auth?")
    assert "client_id=provedor-ia-web" in authorize_url
    assert "code_challenge_method=S256" in authorize_url
    assert "client_secret" not in authorize_url
    from urllib.parse import urlparse, parse_qs
    qs = parse_qs(urlparse(authorize_url).query)
    state = qs["state"][0]
    try:
        assert state in pending_oauth
        assert pending_oauth[state]["provider"] == "maestro"
        assert pending_oauth[state]["code_verifier"]
    finally:
        pending_oauth.pop(state, None)
