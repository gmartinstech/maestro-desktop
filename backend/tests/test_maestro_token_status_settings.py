"""maestro_token_status() reading the app's real settings/env token.

Split out of test_maestro_token_status.py (see that file for the shared
P_NOW/p_b64/jwt_token helpers, imported below) to stay under the 300-line
file convention. This file covers the settings-field-first,
opaque-env-var-fallback, and hand-pasted-JWT-is-refused behaviors.
"""

from __future__ import annotations

import json
import time

import pytest

from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
from backend.apps.settings.maestro_token_status import maestro_token_status
from backend.apps.settings.models import AppSettings

from backend.tests.test_maestro_token_status import jwt_token


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


def test_status_reads_the_settings_field_first(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, jwt_token({"exp": int(time.time()) - 60}))
    s = AppSettings(provedor_ia_token=jwt_token({"exp": int(time.time()) + 10 * 3600}))
    assert maestro_token_status(s).state == "valid"


def test_status_falls_back_to_an_opaque_env_var(no_env_token, monkeypatch):
    """A static key from the env var is a still-supported credential type."""
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, "mtok_a_static_api_key_0000")
    assert maestro_token_status(AppSettings()).state == "opaque"


def test_a_jwt_from_the_env_var_is_refused_not_honored(no_env_token, monkeypatch):
    """The old vendor-installer contract: a hand-minted, non-refreshable Keycloak
    access token. It can never be silently refreshed, so it is never read, live or
    dead, rather than resurrecting the exact broken session this flow replaced."""
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, jwt_token({"exp": int(time.time()) + 10 * 3600}))
    assert maestro_token_status(AppSettings()).state == "missing"
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, jwt_token({"exp": int(time.time()) - 60}))
    assert maestro_token_status(AppSettings()).state == "missing"


def test_status_with_no_token_anywhere_is_missing(no_env_token):
    assert maestro_token_status(AppSettings()).state == "missing"


def test_status_never_carries_any_part_of_the_token(no_env_token):
    """The status crosses to the renderer, so it must be state + runway and nothing else."""
    token = jwt_token({"exp": int(time.time()) + 3600, "sub": "someone", "preferred_username": "someone"})
    status = maestro_token_status(AppSettings(provedor_ia_token=token))
    dumped = json.dumps(status.model_dump())
    assert set(status.model_dump()) == {"state", "expires_at", "expires_in_minutes"}
    for fragment in token.split("."):
        assert fragment not in dumped
