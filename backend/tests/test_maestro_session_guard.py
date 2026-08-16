"""The reported symptom, pinned: an expired Maestro session must not read as a bad model.

The bug chain was: token dies (10h Keycloak access token, no refresh) -> sync_custom_providers
skips registering the Maestro node rather than replay a dead bearer -> `cp-maestro/...`
resolves to no provider -> the Claude CLI says "the selected model may not exist or you may not
have access to it. Run --model to pick a different model." Wrong cause, wrong advice.

Every token here is synthesized locally with an unsigned header; nothing is minted and nothing
is sent anywhere. The live gateway is NOT exercised: every available token is expired, and the
guard is deliberately decidable offline.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any, Dict, List, Tuple

import pytest

import backend.apps.agents.core.ws_manager as ws_mod
from backend.apps.agents.core.error_classify import is_auth_error, is_unknown_model_error
from backend.apps.agents.core.models import AgentSession
from backend.apps.agents.core.MaestroSessionExpiredError import MaestroSessionExpiredError
from backend.apps.agents.manager.configure_provider_env import configure_provider_env
from backend.apps.agents.manager.guard_maestro_session import (
    guard_maestro_session,
    routes_through_maestro,
)
from backend.apps.agents.manager.run.handle_run_error import handle_run_error
from backend.apps.agents.manager.streaming.state import TurnState
from backend.apps.settings.apply_maestro_defaults import apply_maestro_defaults
from backend.apps.settings.models import AppSettings, CustomProvider
from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV

P_ULTRA = "custom/maestro/maestro-ultra"


def p_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def p_jwt(exp: int) -> str:
    """A structurally valid, deliberately unsigned JWT; the status reader never checks the signature."""
    header = p_b64(b'{"alg":"RS256","typ":"JWT"}')
    return f"{header}.{p_b64(json.dumps({'exp': exp}).encode())}.not-a-signature"


P_EXPIRED = p_jwt(int(time.time()) - 3_600)
P_LIVE = p_jwt(int(time.time()) + 36_000)


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


def p_settings(token: str) -> AppSettings:
    return apply_maestro_defaults(AppSettings(provedor_ia_token=token))


# --------------------------------------------------------------------------- Which runs the guard claims.

def test_guard_claims_the_maestro_lane_only(no_env_token):
    settings = p_settings(P_LIVE)
    assert routes_through_maestro(P_ULTRA, settings)
    assert not routes_through_maestro("custom/lmstudio/llama", settings)
    assert not routes_through_maestro("sonnet", settings)


def test_a_live_token_is_never_blocked(no_env_token):
    guard_maestro_session(P_ULTRA, p_settings(P_LIVE))


def test_an_opaque_credential_is_never_blocked(no_env_token):
    """A static API key can't be decoded, and only the gateway may judge it; blocking would lock out a valid setup."""
    guard_maestro_session(P_ULTRA, p_settings("pi-static-api-key-000000"))


def test_a_neighbouring_custom_provider_is_untouched(no_env_token):
    settings = p_settings(P_EXPIRED)
    settings.custom_providers.append(
        CustomProvider(name="LM Studio", base_url="http://127.0.0.1:1234/v1", api_key="", models=[])
    )
    guard_maestro_session("custom/lm-studio/llama", settings)


# --------------------------------------------------------------------------- The reported symptom.

def test_expired_token_on_maestro_ultra_raises_the_session_error(no_env_token):
    with pytest.raises(MaestroSessionExpiredError) as excinfo:
        guard_maestro_session(P_ULTRA, p_settings(P_EXPIRED))
    assert excinfo.value.state == "expired"
    # A credential is never allowed to ride out in an error message.
    assert P_EXPIRED not in str(excinfo.value)


def test_a_cleared_token_still_raises_even_with_a_stale_entry(no_env_token):
    """apply_maestro_defaults never deletes, so a cleared token leaves the old entry behind."""
    settings = p_settings(P_EXPIRED)
    settings.provedor_ia_token = ""
    with pytest.raises(MaestroSessionExpiredError) as excinfo:
        guard_maestro_session(P_ULTRA, settings)
    assert excinfo.value.state == "missing"


def test_the_turn_fails_before_the_cli_spawns(no_env_token):
    """configure_provider_env is the gate: it must refuse instead of handing the SDK a dead bearer."""
    settings = p_settings(P_EXPIRED)
    session = AgentSession(name="t", model=P_ULTRA, dashboard_id="d")
    options_kwargs: Dict[str, Any] = {}
    with pytest.raises(MaestroSessionExpiredError):
        asyncio.run(configure_provider_env(
            options_kwargs, session, "cp-maestro/maestro-ultra", "custom", settings, [],
        ))
    assert "env" not in options_kwargs


def test_the_error_classifies_as_auth_and_not_as_an_unknown_model():
    err = MaestroSessionExpiredError("expired")
    assert is_auth_error(err)
    assert not is_unknown_model_error(err)


def p_drive_error(monkeypatch, exc: Exception) -> Tuple[AgentSession, List[Tuple[str, Dict]]]:
    events: List[Tuple[str, Dict]] = []

    async def fake_send(session_id, event, data):
        events.append((event, data))

    monkeypatch.setattr(ws_mod.ws_manager, "send_to_session", fake_send, raising=True)
    session = AgentSession(name="t", model=P_ULTRA, dashboard_id="d")
    asyncio.run(handle_run_error(exc, session, session.id, TurnState(), []))
    return session, events


def test_the_user_gets_the_sign_in_card_not_a_model_error(monkeypatch):
    session, events = p_drive_error(monkeypatch, MaestroSessionExpiredError("expired"))
    payload = next(d for e, d in events if e == "agent:auth_error")
    assert payload["reason"] == "maestro_token_expired"
    assert "sign in again" in payload["message"].lower()
    card = [m for m in session.messages if m.role == "system"][-1].content
    # The wrong advice the CLI gave must be gone: no "pick a different model", no "may not exist".
    assert "--model" not in card and "may not exist" not in card
