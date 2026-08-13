"""The provedor-ia token's expiry, read locally so the app can prompt instead of dying silently.

A provedor-ia token is a Keycloak access token with a ~10h lifetime and no refresh
token, so the only question these tests care about is the one the UI asks: is there
something usable to send, and if so for how much longer. Four classes are pinned
(missing / expired / valid / undecodable), plus the rule that matters most for data
loss: an already-expired paste is REJECTED, never written to settings.

Every token here is synthesized locally with an unsigned header and a payload we
choose; nothing is minted, nothing is sent anywhere, and no real bearer appears.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any, Dict, Optional

import pytest

from backend.apps.settings.models import AppSettings
from backend.apps.settings.provedor_ia import PROVEDOR_IA_NAME, PROVEDOR_IA_TOKEN_ENV
from backend.apps.settings.provedor_ia_token_status import (
    EXPIRY_WARNING_MINUTES,
    needs_login,
    provedor_ia_token_status,
    token_status,
)

P_NOW = 1_800_000_000.0


def p_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def p_jwt(claims: Dict[str, Any]) -> str:
    """A structurally valid, deliberately unsigned JWT; the helper never checks the signature."""
    return f"{p_b64(b'{\"alg\":\"RS256\",\"typ\":\"JWT\"}')}.{p_b64(json.dumps(claims).encode())}.not-a-signature"


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


# --------------------------------------------------------------------------- Detection.
@pytest.mark.parametrize("token", [None, "", "   ", "\n\t "])
def test_no_token_reads_missing(token):
    status = token_status(token, now=P_NOW)
    assert status.state == "missing"
    assert status.expires_at is None and status.expires_in_minutes is None
    assert needs_login(status)


def test_expired_token_reads_expired():
    exp = int(P_NOW) - 60
    status = token_status(p_jwt({"exp": exp}), now=P_NOW)
    assert status.state == "expired"
    assert status.expires_at == exp and status.expires_in_minutes == 0
    assert needs_login(status)


def test_exactly_at_expiry_reads_expired():
    """The boundary belongs to expired: a token that dies this instant must not be offered."""
    assert token_status(p_jwt({"exp": int(P_NOW)}), now=P_NOW).state == "expired"


def test_fresh_token_reads_valid_with_its_runway():
    """A freshly minted Keycloak token: ~10h of life, reported in whole minutes."""
    status = token_status(p_jwt({"exp": int(P_NOW) + 10 * 3600}), now=P_NOW)
    assert status.state == "valid"
    assert status.expires_in_minutes == 600
    assert not needs_login(status)


def test_token_inside_the_warning_window_reads_expiring():
    """The quiet 'your session is ending' notice, not a block: there is still a usable token."""
    status = token_status(p_jwt({"exp": int(P_NOW) + 10 * 60}), now=P_NOW)
    assert status.state == "expiring"
    assert status.expires_in_minutes == 10
    assert not needs_login(status)


def test_the_warning_window_boundary_is_the_documented_one():
    below = token_status(p_jwt({"exp": int(P_NOW) + EXPIRY_WARNING_MINUTES * 60 - 60}), now=P_NOW)
    at = token_status(p_jwt({"exp": int(P_NOW) + EXPIRY_WARNING_MINUTES * 60}), now=P_NOW)
    assert below.state == "expiring"
    assert at.state == "valid"


@pytest.mark.parametrize("token", [
    "mtok_a_static_api_key",                         # a legitimate non-JWT provedor-ia credential
    "only.two",                                      # too few segments
    "a.b.c.d",                                       # too many segments
    "aaa.!!!not-base64!!!.sig",                      # payload isn't base64url
    f"aaa.{p_b64(b'not json at all')}.sig",          # payload isn't JSON
    f"aaa.{p_b64(b'[1,2,3]')}.sig",                  # payload is JSON but not an object
    f"aaa.{p_b64(b'{}')}.sig",                       # object with no exp claim
    f"aaa.{p_b64(b'{\"exp\":\"soon\"}')}.sig",       # exp is a string
    f"aaa.{p_b64(b'{\"exp\":true}')}.sig",           # exp is a bool, which is an int subclass
])
def test_undecodable_tokens_read_opaque_and_are_never_treated_as_dead(token):
    """Blocking on a credential we cannot parse would lock out a working static-key setup."""
    status = token_status(token, now=P_NOW)
    assert status.state == "opaque"
    assert not needs_login(status)


def test_float_exp_is_accepted():
    """Some issuers emit exp as a float; truncating it must not flip a live token to expired."""
    status = token_status(p_jwt({"exp": P_NOW + 3600.7}), now=P_NOW)
    assert status.state == "valid" and status.expires_at == int(P_NOW + 3600.7)


# --------------------------------------------------------------------------- Reading the app's real token.
def test_status_reads_the_settings_field_first(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, p_jwt({"exp": int(time.time()) - 60}))
    s = AppSettings(provedor_ia_token=p_jwt({"exp": int(time.time()) + 10 * 3600}))
    assert provedor_ia_token_status(s).state == "valid"


def test_status_falls_back_to_the_env_var(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, p_jwt({"exp": int(time.time()) - 60}))
    assert provedor_ia_token_status(AppSettings()).state == "expired"


def test_status_with_no_token_anywhere_is_missing(no_env_token):
    assert provedor_ia_token_status(AppSettings()).state == "missing"


def test_status_never_carries_any_part_of_the_token(no_env_token):
    """The status crosses to the renderer, so it must be state + runway and nothing else."""
    token = p_jwt({"exp": int(time.time()) + 3600, "sub": "someone", "preferred_username": "someone"})
    status = provedor_ia_token_status(AppSettings(provedor_ia_token=token))
    dumped = json.dumps(status.model_dump())
    assert set(status.model_dump()) == {"state", "expires_at", "expires_in_minutes"}
    for fragment in token.split("."):
        assert fragment not in dumped


# --------------------------------------------------------------------------- The paste path: an expired token must never be stored.
def test_an_expired_paste_is_rejected_and_not_stored(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    from backend.apps.settings.settings import load_settings, save_settings
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    original = load_settings().model_copy(deep=True)
    expired = p_jwt({"exp": int(time.time()) - 3600})
    try:
        client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
        r = client.post("/api/settings/provedor-ia/token", json={"token": expired})
        assert r.status_code == 400
        assert r.json() == {"ok": False, "reason": "expired"}
        # The rejection body must name a state, never echo the credential back.
        assert expired.split(".")[1] not in r.text
        assert load_settings().provedor_ia_token != expired
    finally:
        save_settings(original)


def test_a_blank_paste_is_rejected(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
    r = client.post("/api/settings/provedor-ia/token", json={"token": "   "})
    assert r.status_code == 400
    assert r.json()["reason"] == "missing"


def test_a_live_paste_is_stored_and_reported(no_env_token):
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    import backend.main as p_main
    from backend.apps.settings.settings import load_settings, save_settings
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    original = load_settings().model_copy(deep=True)
    live = p_jwt({"exp": int(time.time()) + 10 * 3600})
    try:
        client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
        r = client.post("/api/settings/provedor-ia/token", json={"token": live})
        assert r.status_code == 200 and r.json()["ok"] is True
        assert r.json()["status"]["state"] == "valid"
        assert load_settings().provedor_ia_token == live
        status = client.get("/api/settings/provedor-ia/token-status")
        assert status.status_code == 200 and status.json()["state"] == "valid"
        # The status route must not leak the token it just classified.
        assert live.split(".")[1] not in status.text
    finally:
        save_settings(original)


# --------------------------------------------------------------------------- Stop handing an expired bearer to 9Router.
class p_FakeResponse:
    def __init__(self, status_code: int, payload: Optional[Dict] = None):
        self.status_code = status_code
        self.text = json.dumps(payload or {})
        self.p_payload = payload or {}

    def json(self) -> Dict:
        return self.p_payload


class p_FakeClient:
    """Records every call; serves an empty provider-node list."""

    def __init__(self, calls: list):
        self.calls = calls

    async def __aenter__(self) -> "p_FakeClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def get(self, url: str, **kw) -> p_FakeResponse:
        self.calls.append(("GET", url))
        return p_FakeResponse(200, {"nodes": []})

    async def post(self, url: str, json: Optional[Dict] = None, **kw) -> p_FakeResponse:
        self.calls.append(("POST", url, json or {}))
        return p_FakeResponse(200, {"node": {"id": "new-node-id"}})

    async def put(self, url: str, json: Optional[Dict] = None, **kw) -> p_FakeResponse:
        self.calls.append(("PUT", url, json or {}))
        return p_FakeResponse(200, {})

    async def patch(self, url: str, json: Optional[Dict] = None, **kw) -> p_FakeResponse:
        self.calls.append(("PATCH", url, json or {}))
        return p_FakeResponse(200, {})

    async def delete(self, url: str, **kw) -> p_FakeResponse:
        self.calls.append(("DELETE", url))
        return p_FakeResponse(200, {})


def p_run_sync(monkeypatch, providers: list) -> list:
    import backend.apps.nine_router.sync_custom as sc
    calls: list = []

    class p_Httpx:
        def AsyncClient(self, **kwargs) -> p_FakeClient:
            return p_FakeClient(calls)

    class p_Nr:
        def __init__(self) -> None:
            self.httpx = p_Httpx()

        def is_running(self) -> bool:
            return True

    async def p_no_connection(node_id: str, name: str) -> None:
        return None

    monkeypatch.setattr(sc, "nr", lambda: p_Nr())
    monkeypatch.setattr(sc, "cli_auth_headers", lambda: {})
    monkeypatch.setattr(sc, "find_keyed_connection", p_no_connection)
    asyncio.run(sc.sync_custom_providers(providers))
    return calls


def p_provider(api_key: str) -> Dict[str, str]:
    return {"name": PROVEDOR_IA_NAME, "base_url": "https://llm.martinstech.net/v1", "api_key": api_key}


def test_an_expired_provedor_ia_token_is_not_pushed_to_9router(monkeypatch):
    """9Router would keep replaying a dead bearer at the gateway, burning its failed-auth throttle."""
    calls = p_run_sync(monkeypatch, [p_provider(p_jwt({"exp": int(time.time()) - 3600}))])
    assert not any(m in ("POST", "PUT", "PATCH") for m, *_ in calls)


def test_a_live_provedor_ia_token_is_still_pushed(monkeypatch):
    calls = p_run_sync(monkeypatch, [p_provider(p_jwt({"exp": int(time.time()) + 10 * 3600}))])
    assert any(m == "POST" and u.endswith("/provider-nodes") for m, u, *_ in calls)


def test_an_opaque_provedor_ia_key_is_still_pushed(monkeypatch):
    """A static API key cannot be dated, so it must never be mistaken for an expired one."""
    calls = p_run_sync(monkeypatch, [p_provider("mtok_a_static_api_key")])
    assert any(m == "POST" and u.endswith("/provider-nodes") for m, u, *_ in calls)
