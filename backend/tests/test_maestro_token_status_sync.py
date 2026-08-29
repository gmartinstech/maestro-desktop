"""Stop handing an expired bearer to 9Router.

Split out of test_maestro_token_status.py (see that file for the shared
jwt_token helper, imported below) to stay under the 300-line file convention.
This file covers sync_custom_providers' gate: an expired provedor-ia token
must never be pushed to 9Router, while a live or opaque one still is.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Dict, Optional

from backend.apps.settings.maestro import MAESTRO_NAME

from backend.tests.test_maestro_token_status import jwt_token


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

        async def is_running(self) -> bool:
            return True

    async def p_no_connection(node_id: str, name: str) -> None:
        return None

    monkeypatch.setattr(sc, "nr", lambda: p_Nr())
    monkeypatch.setattr(sc, "cli_auth_headers", lambda: {})
    monkeypatch.setattr(sc, "find_keyed_connection", p_no_connection)
    asyncio.run(sc.sync_custom_providers(providers))
    return calls


def p_provider(api_key: str) -> Dict[str, str]:
    return {"name": MAESTRO_NAME, "base_url": "https://llm.martinstech.net/v1", "api_key": api_key}


def test_an_expired_provedor_ia_token_is_not_pushed_to_9router(monkeypatch):
    """9Router would keep replaying a dead bearer at the gateway, burning its failed-auth throttle."""
    calls = p_run_sync(monkeypatch, [p_provider(jwt_token({"exp": int(time.time()) - 3600}))])
    assert not any(m in ("POST", "PUT", "PATCH") for m, *_ in calls)


def test_a_live_provedor_ia_token_is_still_pushed(monkeypatch):
    calls = p_run_sync(monkeypatch, [p_provider(jwt_token({"exp": int(time.time()) + 10 * 3600}))])
    assert any(m == "POST" and u.endswith("/provider-nodes") for m, u, *_ in calls)


def test_an_opaque_provedor_ia_key_is_still_pushed(monkeypatch):
    """A static API key cannot be dated, so it must never be mistaken for an expired one."""
    calls = p_run_sync(monkeypatch, [p_provider("mtok_a_static_api_key")])
    assert any(m == "POST" and u.endswith("/provider-nodes") for m, u, *_ in calls)
