"""The provedor-ia catalog: what the gateway says it serves, not what we shipped believing.

The hardcoded list in `provedor_ia.py` drifts. Proof it already did: the vendor
installer at https://llm.martinstech.net/launch.ps1?pi offers three models while
`GET /v1/models` returns four (it is missing `maestro-fast`). So the catalog is
fetched, and the constant becomes the offline fallback.

The gateway reports ids only — no label, no context window — so labels come from a
known map (else the id, prettified) and the window keeps the vendor's 128k/4096.

No live call is made here: every payload is a local literal and the transport is a
stub, so this suite is offline and deterministic.
"""

from __future__ import annotations

import pytest

from backend.apps.settings.maestro import MAESTRO_MODELS
from backend.apps.settings.maestro_catalog import (
    CATALOG_TTL_SECONDS,
    catalog_models,
    forget_catalog,
    parse_catalog,
    refresh_catalog,
    remember_catalog,
)

# The exact body the live gateway returned on 2026-08-13, ids in the order it served them.
P_LIVE_PAYLOAD = {
    "object": "list",
    "data": [
        {"id": "maestro-ultra", "object": "model", "created": 1786637799, "owned_by": "martinstech"},
        {"id": "maestro", "object": "model", "created": 1786637799, "owned_by": "martinstech"},
        {"id": "maestro-fast", "object": "model", "created": 1786637799, "owned_by": "martinstech"},
        {"id": "maestro-code", "object": "model", "created": 1786637799, "owned_by": "martinstech"},
    ],
}


@pytest.fixture(autouse=True)
def clean_catalog():
    """The cache is module state, so a leaked entry would cross-contaminate tests."""
    forget_catalog()
    yield
    forget_catalog()


# --------------------------------------------------------------------------- parse_catalog: the wire shape in, our rows out. ---------------------------------------------------------------------------

def test_live_payload_parses_into_the_shipped_contract():
    """The fetched catalog must be indistinguishable from the constant we ship."""
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    assert [m.model_dump() for m in rows] == [m.model_dump() for m in MAESTRO_MODELS]


def test_preferred_order_wins_over_the_gateway_order():
    """`maestro` is the default model, so it must head the picker regardless of serve order."""
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    assert [m.value for m in rows] == ["maestro-fast", "maestro", "maestro-ultra", "maestro-code"]


def test_an_unknown_model_is_offered_with_a_prettified_label():
    """A model added server-side must reach the picker without an app release."""
    rows = parse_catalog({"data": [{"id": "maestro"}, {"id": "maestro-vision-pro"}]})
    assert rows is not None
    assert [(m.value, m.label) for m in rows] == [
        ("maestro", "Maestro"),
        ("maestro-vision-pro", "Maestro Vision Pro"),
    ]
    assert rows[1].context_window == 128_000
    assert rows[1].max_completion_tokens == 4_096


def test_parsed_rows_are_presumptively_reasoning_capable():
    """Anything served off this Ollama-backed gateway is presumptively reasoning-capable."""
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    assert all(m.reasoning is True for m in rows)


def test_unknown_models_sort_alphabetically_after_the_known_ones():
    rows = parse_catalog({"data": [{"id": "zeta"}, {"id": "maestro-code"}, {"id": "alpha"}]})
    assert rows is not None
    assert [m.value for m in rows] == ["maestro-code", "alpha", "zeta"]


def test_rows_without_a_usable_id_are_dropped():
    rows = parse_catalog({"data": [{"id": "maestro"}, {"id": ""}, {"id": None}, {"no_id": 1}, "junk"]})
    assert rows is not None
    assert [m.value for m in rows] == ["maestro"]


@pytest.mark.parametrize("payload", [
    None, {}, {"data": []}, {"data": "nope"}, {"object": "list"}, [], "junk", {"data": [{"id": ""}]},
])
def test_an_unusable_payload_yields_none_so_the_fallback_stands(payload):
    """None means "I learned nothing"; an empty list would wipe the picker."""
    assert parse_catalog(payload) is None


# --------------------------------------------------------------------------- The cache: sync readers, async writer. ---------------------------------------------------------------------------

def test_nothing_is_cached_before_a_refresh():
    assert catalog_models() is None


def test_a_remembered_catalog_reads_back():
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    remember_catalog(rows, now=1000.0)
    got = catalog_models(now=1000.0)
    assert got is not None
    assert [m.value for m in got] == [m.value for m in rows]


def test_a_stale_catalog_is_ignored():
    """Past the TTL the cache stops answering, so a removed model cannot linger forever."""
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    remember_catalog(rows, now=1000.0)
    assert catalog_models(now=1000.0 + CATALOG_TTL_SECONDS - 1) is not None
    assert catalog_models(now=1000.0 + CATALOG_TTL_SECONDS + 1) is None


# --------------------------------------------------------------------------- refresh_catalog: the one network call. ---------------------------------------------------------------------------

class P_StubResponse:
    def __init__(self, status_code: int, payload: object):
        self.status_code = status_code
        self.p_payload = payload

    def json(self) -> object:
        return self.p_payload


class P_StubClient:
    """Stands in for httpx.AsyncClient; records the request so auth can be asserted."""

    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        P_StubClient.calls.append((url, headers or {}))
        return P_StubResponse(P_StubClient.status, P_StubClient.payload)


@pytest.fixture
def stub_http(monkeypatch):
    import httpx
    P_StubClient.calls = []
    P_StubClient.status = 200
    P_StubClient.payload = P_LIVE_PAYLOAD
    monkeypatch.setattr(httpx, "AsyncClient", P_StubClient)
    return P_StubClient


@pytest.mark.asyncio
async def test_refresh_fetches_models_with_the_bearer_and_caches(stub_http):
    rows = await refresh_catalog("mtok-local-test-000", "https://gw.example/v1", now=500.0)
    assert rows is not None
    assert [m.value for m in rows] == ["maestro-fast", "maestro", "maestro-ultra", "maestro-code"]
    url, headers = stub_http.calls[0]
    assert url == "https://gw.example/v1/models"
    assert headers["Authorization"] == "Bearer mtok-local-test-000"
    # Cached, so every later sync reader sees the fetched catalog rather than the constant.
    assert catalog_models(now=500.0) is not None


@pytest.mark.asyncio
async def test_refresh_without_a_token_never_calls_the_gateway(stub_http):
    """The 401 throttle is 10 failed auths a minute, so a tokenless probe is worse than useless."""
    assert await refresh_catalog(None, "https://gw.example/v1") is None
    assert await refresh_catalog("   ", "https://gw.example/v1") is None
    assert stub_http.calls == []


@pytest.mark.asyncio
async def test_an_expired_token_leaves_the_previous_catalog_intact(stub_http):
    rows = parse_catalog(P_LIVE_PAYLOAD)
    assert rows is not None
    remember_catalog(rows, now=1000.0)
    stub_http.status = 401
    stub_http.payload = {"reason": "jwt expired"}
    assert await refresh_catalog("mtok-local-test-000", "https://gw.example/v1", now=1000.0) is None
    # A rejection is not evidence the catalog changed, so the user keeps a working picker.
    assert catalog_models(now=1000.0) is not None


@pytest.mark.asyncio
async def test_a_transport_error_is_swallowed(stub_http, monkeypatch):
    """Startup refresh runs in a background task; a raise there would be an unretrieved exception."""
    import httpx

    class P_Boom(P_StubClient):
        async def get(self, url, headers=None):
            raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "AsyncClient", P_Boom)
    assert await refresh_catalog("mtok-local-test-000", "https://gw.example/v1") is None


@pytest.mark.asyncio
async def test_the_token_never_reaches_the_logs(stub_http, caplog):
    secret = "mtok-local-test-do-not-log"
    with caplog.at_level("DEBUG"):
        stub_http.status = 500
        await refresh_catalog(secret, "https://gw.example/v1")
    for rec in caplog.records:
        assert secret not in rec.getMessage()


# --------------------------------------------------------------------------- The seam: seeding prefers the live catalog. ---------------------------------------------------------------------------

def test_seeding_offers_the_fetched_catalog_over_the_constant(monkeypatch):
    from backend.apps.settings.apply_maestro_defaults import apply_maestro_defaults
    from backend.apps.settings.models import AppSettings
    from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)
    rows = parse_catalog({"data": [{"id": "maestro"}, {"id": "maestro-brand-new"}]})
    assert rows is not None
    remember_catalog(rows)
    s = apply_maestro_defaults(AppSettings(provedor_ia_token="pi-test-token-000000000000"))
    assert [m["value"] for m in s.custom_providers[0].models] == ["maestro", "maestro-brand-new"]


@pytest.mark.asyncio
async def test_refreshing_from_settings_reseeds_the_provider(stub_http, monkeypatch):
    """The wiring startup and the sign-in endpoint both call: fetch, then re-derive."""
    from backend.apps.settings.models import AppSettings
    from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
    from backend.apps.settings.refresh_maestro_catalog import refresh_maestro_catalog
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)
    stub_http.payload = {"data": [{"id": "maestro"}, {"id": "maestro-brand-new"}]}
    s = AppSettings(provedor_ia_token="pi-test-token-000000000000")
    assert await refresh_maestro_catalog(s) is True
    # The live gateway constant is the one the app actually ships against.
    assert stub_http.calls[0][0] == "https://llm.martinstech.net/v1/models"
    assert [m["value"] for m in s.custom_providers[0].models] == ["maestro", "maestro-brand-new"]


@pytest.mark.asyncio
async def test_refreshing_without_a_token_is_a_no_op(stub_http, monkeypatch):
    from backend.apps.settings.models import AppSettings
    from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
    from backend.apps.settings.refresh_maestro_catalog import refresh_maestro_catalog
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)
    s = AppSettings()
    assert await refresh_maestro_catalog(s) is False
    assert stub_http.calls == []
    assert s.custom_providers == []


@pytest.mark.asyncio
async def test_refreshing_against_a_dead_gateway_leaves_settings_alone(stub_http, monkeypatch):
    from backend.apps.settings.models import AppSettings
    from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
    from backend.apps.settings.refresh_maestro_catalog import refresh_maestro_catalog
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)
    stub_http.status = 401
    s = AppSettings(provedor_ia_token="pi-test-token-000000000000")
    assert await refresh_maestro_catalog(s) is False
    # Seeding still happened at load time, so the fallback models remain on offer.
    s_seeded = [m.value for m in MAESTRO_MODELS]
    from backend.apps.settings.apply_maestro_defaults import apply_maestro_defaults
    apply_maestro_defaults(s)
    assert [m["value"] for m in s.custom_providers[0].models] == s_seeded


def test_seeding_falls_back_to_the_constant_with_no_catalog(monkeypatch):
    """Cold start, or a gateway that has never answered: the picker still works."""
    from backend.apps.settings.apply_maestro_defaults import apply_maestro_defaults
    from backend.apps.settings.models import AppSettings
    from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_ENV
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)
    s = apply_maestro_defaults(AppSettings(provedor_ia_token="pi-test-token-000000000000"))
    assert [m["value"] for m in s.custom_providers[0].models] == [m.value for m in MAESTRO_MODELS]
