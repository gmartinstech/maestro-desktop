"""The background refresh: silently rotate the Maestro access token off the stored
Keycloak refresh token before it dies, so the sign-in prompt almost never fires.

Every Keycloak call and every keyring call is mocked; only the DECISION (refresh or
not, what gets persisted) is under test.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Dict

import pytest

from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
from backend.apps.settings.maestro_keycloak_auth import MaestroKeycloakAuthError
from backend.apps.settings.models import AppSettings
from backend.apps.settings.maestro_scheduler import refresh_maestro_access_token_if_needed


def p_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def p_jwt(exp: int) -> str:
    header = p_b64(b'{"alg":"RS256","typ":"JWT"}')
    return f"{header}.{p_b64(json.dumps({'exp': exp}).encode())}.sig"


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


@pytest.mark.asyncio
async def test_a_valid_token_with_plenty_of_runway_is_left_alone(no_env_token, monkeypatch):
    live = p_jwt(int(time.time()) + 10 * 3600)
    settings = AppSettings(provedor_ia_token=live)

    async def p_should_not_be_called(*a, **k):
        raise AssertionError("refresh_tokens must not be called for a valid token")

    import backend.apps.settings.maestro_scheduler as mod
    monkeypatch.setattr(mod, "refresh_tokens", p_should_not_be_called)
    changed = await refresh_maestro_access_token_if_needed(settings)
    assert changed is False
    assert settings.provedor_ia_token == live


@pytest.mark.asyncio
async def test_an_expiring_token_with_a_stored_refresh_token_is_silently_refreshed(no_env_token, monkeypatch):
    expiring = p_jwt(int(time.time()) + 10 * 60)
    settings = AppSettings(provedor_ia_token=expiring)
    import backend.apps.settings.maestro_scheduler as mod
    monkeypatch.setattr(mod, "load_refresh_token", lambda: "rt-old")
    stored: Dict[str, str] = {}
    monkeypatch.setattr(mod, "store_refresh_token", lambda t: stored.__setitem__("rt", t))

    fresh_access = p_jwt(int(time.time()) + 12 * 3600)

    async def p_fake_refresh(refresh_token: str) -> Dict[str, Any]:
        assert refresh_token == "rt-old"
        return {"access_token": fresh_access, "refresh_token": "rt-new", "expires_in": 43200}

    monkeypatch.setattr(mod, "refresh_tokens", p_fake_refresh)
    changed = await refresh_maestro_access_token_if_needed(settings)
    assert changed is True
    assert settings.provedor_ia_token == fresh_access
    assert stored["rt"] == "rt-new"


@pytest.mark.asyncio
async def test_no_stored_refresh_token_means_no_refresh_attempt(no_env_token, monkeypatch):
    expired = p_jwt(int(time.time()) - 3600)
    settings = AppSettings(provedor_ia_token=expired)
    import backend.apps.settings.maestro_scheduler as mod
    monkeypatch.setattr(mod, "load_refresh_token", lambda: None)

    async def p_should_not_be_called(*a, **k):
        raise AssertionError("refresh_tokens must not be called with no stored refresh token")

    monkeypatch.setattr(mod, "refresh_tokens", p_should_not_be_called)
    changed = await refresh_maestro_access_token_if_needed(settings)
    assert changed is False
    assert settings.provedor_ia_token == expired


@pytest.mark.asyncio
async def test_a_revoked_refresh_token_leaves_settings_untouched_so_the_sign_in_prompt_fires(no_env_token, monkeypatch):
    expired = p_jwt(int(time.time()) - 3600)
    settings = AppSettings(provedor_ia_token=expired)
    import backend.apps.settings.maestro_scheduler as mod
    monkeypatch.setattr(mod, "load_refresh_token", lambda: "rt-dead")

    async def p_reject(refresh_token: str) -> Dict[str, Any]:
        raise MaestroKeycloakAuthError(400, "invalid_grant")

    monkeypatch.setattr(mod, "refresh_tokens", p_reject)
    changed = await refresh_maestro_access_token_if_needed(settings)
    assert changed is False
    assert settings.provedor_ia_token == expired


@pytest.mark.asyncio
async def test_a_missing_token_with_a_stored_refresh_token_still_refreshes(no_env_token, monkeypatch):
    settings = AppSettings(provedor_ia_token=None)
    import backend.apps.settings.maestro_scheduler as mod
    monkeypatch.setattr(mod, "load_refresh_token", lambda: "rt-old")
    monkeypatch.setattr(mod, "store_refresh_token", lambda t: None)
    fresh_access = p_jwt(int(time.time()) + 12 * 3600)

    async def p_fake_refresh(refresh_token: str) -> Dict[str, Any]:
        return {"access_token": fresh_access, "refresh_token": "rt-new"}

    monkeypatch.setattr(mod, "refresh_tokens", p_fake_refresh)
    changed = await refresh_maestro_access_token_if_needed(settings)
    assert changed is True
    assert settings.provedor_ia_token == fresh_access
