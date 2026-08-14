"""The Keycloak Authorization Code + PKCE flow: URL shape, the token exchange, and refresh.

No live Keycloak call is ever made: every httpx call is mocked. This tests the
CONTRACT (exact params, no client_secret, redaction on failure), never the network.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

import pytest

from backend.apps.settings.maestro_keycloak_auth import (
    MAESTRO_KEYCLOAK_CLIENT_ID,
    MAESTRO_KEYCLOAK_REDIRECT_URI,
    MAESTRO_KEYCLOAK_SCOPE,
    MAESTRO_KEYCLOAK_TOKEN_URL,
    MaestroKeycloakAuthError,
    build_authorize_url,
    exchange_code_for_tokens,
    refresh_tokens,
)


class p_FakeResponse:
    def __init__(self, status_code: int, payload: Optional[Dict[str, Any]] = None):
        self.status_code = status_code
        self.p_payload = payload if payload is not None else {}
        self.text = json.dumps(self.p_payload)

    def json(self) -> Dict[str, Any]:
        return self.p_payload


class p_FakeClient:
    def __init__(self, response: p_FakeResponse):
        self.response = response
        self.last_call: Optional[Dict[str, Any]] = None

    async def __aenter__(self) -> "p_FakeClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def post(self, url: str, data: Dict[str, str], headers: Dict[str, str]) -> p_FakeResponse:
        self.last_call = {"url": url, "data": data, "headers": headers}
        return self.response


def p_patch_client(monkeypatch, response: p_FakeResponse) -> p_FakeClient:
    import backend.apps.settings.maestro_keycloak_auth as mod
    fake = p_FakeClient(response)
    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda **kw: fake)
    return fake


# --------------------------------------------------------------------------- build_authorize_url


def test_authorize_url_carries_the_exact_verified_params():
    authorize_url, state, code_verifier = build_authorize_url()
    parsed = urlparse(authorize_url)
    qs = parse_qs(parsed.query)
    assert qs["response_type"] == ["code"]
    assert qs["client_id"] == [MAESTRO_KEYCLOAK_CLIENT_ID] == ["provedor-ia-web"]
    assert qs["redirect_uri"] == [MAESTRO_KEYCLOAK_REDIRECT_URI] == ["http://127.0.0.1:20128/callback"]
    assert qs["scope"] == [MAESTRO_KEYCLOAK_SCOPE] == ["openid offline_access"]
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["state"] == [state]
    assert "client_secret" not in qs


def test_authorize_url_code_challenge_matches_s256_of_the_verifier():
    authorize_url, _state, code_verifier = build_authorize_url()
    qs = parse_qs(urlparse(authorize_url).query)
    expected = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()
    assert qs["code_challenge"] == [expected]


def test_code_verifier_is_rfc7636_shaped():
    """43-128 chars, url-safe."""
    for _ in range(5):
        _url, _state, verifier = build_authorize_url()
        assert 43 <= len(verifier) <= 128
        assert all(c.isalnum() or c in "-_" for c in verifier)


def test_every_call_mints_a_fresh_state_and_verifier():
    _u1, s1, v1 = build_authorize_url()
    _u2, s2, v2 = build_authorize_url()
    assert s1 != s2 and v1 != v2


# --------------------------------------------------------------------------- exchange_code_for_tokens


@pytest.mark.asyncio
async def test_exchange_posts_the_documented_body_with_no_secret(monkeypatch):
    fake = p_patch_client(monkeypatch, p_FakeResponse(200, {
        "access_token": "at-1", "refresh_token": "rt-1", "expires_in": 43200,
    }))
    result = await exchange_code_for_tokens("auth-code", "verifier-x", "http://127.0.0.1:20128/callback")
    assert result == {"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 43200}
    assert fake.last_call["url"] == MAESTRO_KEYCLOAK_TOKEN_URL
    body = fake.last_call["data"]
    assert body == {
        "grant_type": "authorization_code",
        "client_id": MAESTRO_KEYCLOAK_CLIENT_ID,
        "code": "auth-code",
        "redirect_uri": "http://127.0.0.1:20128/callback",
        "code_verifier": "verifier-x",
    }
    assert "client_secret" not in body


@pytest.mark.asyncio
async def test_exchange_raises_a_specific_error_on_rejection_and_never_echoes_the_body(monkeypatch):
    p_patch_client(monkeypatch, p_FakeResponse(400, {"error": "invalid_grant", "error_description": "auth-code-xyz consumed"}))
    with pytest.raises(MaestroKeycloakAuthError) as excinfo:
        await exchange_code_for_tokens("auth-code-xyz", "verifier", "http://127.0.0.1:20128/callback")
    assert excinfo.value.status_code == 400
    assert excinfo.value.error == "invalid_grant"
    assert "auth-code-xyz" not in str(excinfo.value)


@pytest.mark.asyncio
async def test_exchange_network_failure_raises_without_leaking_the_underlying_message(monkeypatch):
    import backend.apps.settings.maestro_keycloak_auth as mod

    class p_BrokenClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, *a, **kw):
            raise ConnectionError("dial tcp 10.0.0.1:443: super-secret-detail")

    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda **kw: p_BrokenClient())
    with pytest.raises(MaestroKeycloakAuthError) as excinfo:
        await exchange_code_for_tokens("code", "verifier", "http://127.0.0.1:20128/callback")
    assert "super-secret-detail" not in str(excinfo.value)


# --------------------------------------------------------------------------- refresh_tokens


@pytest.mark.asyncio
async def test_refresh_posts_the_documented_body_with_no_secret(monkeypatch):
    fake = p_patch_client(monkeypatch, p_FakeResponse(200, {
        "access_token": "at-2", "refresh_token": "rt-2", "expires_in": 43200,
    }))
    result = await refresh_tokens("rt-1")
    assert result["access_token"] == "at-2"
    # Keycloak may rotate the refresh token; the caller must see the NEW one to persist it.
    assert result["refresh_token"] == "rt-2"
    body = fake.last_call["data"]
    assert body == {
        "grant_type": "refresh_token",
        "client_id": MAESTRO_KEYCLOAK_CLIENT_ID,
        "refresh_token": "rt-1",
    }
    assert "client_secret" not in body


@pytest.mark.asyncio
async def test_refresh_raises_on_a_revoked_token(monkeypatch):
    p_patch_client(monkeypatch, p_FakeResponse(400, {"error": "invalid_grant"}))
    with pytest.raises(MaestroKeycloakAuthError) as excinfo:
        await refresh_tokens("dead-refresh-token")
    assert excinfo.value.error == "invalid_grant"
    assert "dead-refresh-token" not in str(excinfo.value)
