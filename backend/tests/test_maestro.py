"""provedor-ia as the app's default provider: seeding, the default model, and the token's blast radius.

Two things are proved here. First, that a fresh install carrying a
PROVEDOR_IA_TOKEN needs no configuration: the provider exists, the picker offers
it, and default_model resolves to `maestro`. Second, that the bearer is treated
as a credential everywhere a credential is treated as one, because the same
field being missed by one of those sets is exactly the leak c0ac9ddd fixed.

No live call is made and no token value is shipped: every token here is a local
literal invented by the test.
"""

from __future__ import annotations

import json

import pytest

from backend.apps.settings.apply_maestro_defaults import (
    apply_maestro_defaults,
    provedor_ia_token,
)
from backend.apps.settings.credentials import MAESTRO_DEFAULT_PROXY_URL
from backend.apps.settings.models import AppSettings, CustomProvider
from backend.apps.settings.maestro import (
    FALLBACK_DEFAULT_MODEL,
    MAESTRO_DEFAULT_MODEL,
    MAESTRO_DEFAULT_MODEL_ID,
    MAESTRO_MODELS,
    MAESTRO_NAME,
    MAESTRO_SLUG,
    PROVEDOR_IA_TOKEN_ENV,
    PROVEDOR_IA_TOKEN_FIELD,
)

P_FAKE_TOKEN = "pi-test-token-000000000000"


@pytest.fixture
def no_env_token(monkeypatch):
    monkeypatch.delenv(PROVEDOR_IA_TOKEN_ENV, raising=False)


# --------------------------------------------------------------------------- The contract (values come from the vendor installers, not from us). ---------------------------------------------------------------------------

def test_contract_matches_the_vendor_installers():
    assert [m.value for m in MAESTRO_MODELS] == [
        "maestro-fast", "maestro", "maestro-ultra", "maestro-code",
    ]
    assert [m.label for m in MAESTRO_MODELS] == [
        "Maestro Fast", "Maestro", "Maestro Ultra", "Maestro Code",
    ]
    for m in MAESTRO_MODELS:
        assert m.context_window == 128_000
        assert m.max_completion_tokens == 4_096
        assert m.reasoning is True
    assert MAESTRO_DEFAULT_PROXY_URL == "https://llm.martinstech.net/v1"


def test_default_model_value_matches_the_registry_composition():
    """MAESTRO_DEFAULT_MODEL is spelled out so the settings store stays a
    leaf; this pins it to how the registry actually parses a picker value."""
    from backend.apps.agents.providers.registry import (
        CUSTOM_VALUE_PREFIX,
        custom_provider_slug_for_lookup,
    )
    assert custom_provider_slug_for_lookup(MAESTRO_NAME) == MAESTRO_SLUG
    assert MAESTRO_DEFAULT_MODEL == (
        f"{CUSTOM_VALUE_PREFIX}{MAESTRO_SLUG}/{MAESTRO_DEFAULT_MODEL_ID}"
    )


# --------------------------------------------------------------------------- Requirement 1: a token is all a fresh install needs. ---------------------------------------------------------------------------

def test_env_token_seeds_the_provider_and_keeps_maestro_default(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, P_FAKE_TOKEN)
    s = apply_maestro_defaults(AppSettings())
    assert s.default_model == MAESTRO_DEFAULT_MODEL
    cp = s.custom_providers[0]
    assert cp.name == MAESTRO_NAME
    assert cp.base_url == MAESTRO_DEFAULT_PROXY_URL
    assert cp.api_key == P_FAKE_TOKEN
    assert [m["value"] for m in cp.models] == [
        "maestro-fast", "maestro", "maestro-ultra", "maestro-code",
    ]


def test_settings_field_token_wins_over_env(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, "pi-env-token-111111111111")
    s = AppSettings(provedor_ia_token=P_FAKE_TOKEN)
    assert provedor_ia_token(s) == P_FAKE_TOKEN
    assert apply_maestro_defaults(s).custom_providers[0].api_key == P_FAKE_TOKEN


def test_no_token_downgrades_the_default_model(no_env_token):
    s = apply_maestro_defaults(AppSettings())
    assert s.custom_providers == []
    # The shipped default would name a model the picker cannot offer, so it falls back.
    assert s.default_model == FALLBACK_DEFAULT_MODEL


def test_seeding_is_idempotent_and_refreshes_a_rotated_token(no_env_token):
    s = AppSettings(provedor_ia_token=P_FAKE_TOKEN)
    apply_maestro_defaults(s)
    apply_maestro_defaults(s)
    assert len(s.custom_providers) == 1
    s.provedor_ia_token = "pi-rotated-222222222222"
    apply_maestro_defaults(s)
    assert len(s.custom_providers) == 1
    assert s.custom_providers[0].api_key == "pi-rotated-222222222222"


def test_seeding_preserves_other_custom_providers(no_env_token):
    s = AppSettings(
        provedor_ia_token=P_FAKE_TOKEN,
        custom_providers=[CustomProvider(name="LMStudio", base_url="http://localhost:1234/v1")],
    )
    apply_maestro_defaults(s)
    assert [cp.name for cp in s.custom_providers] == [MAESTRO_NAME, "LMStudio"]


def test_explicit_non_provedor_default_is_never_promoted(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, P_FAKE_TOKEN)
    s = apply_maestro_defaults(AppSettings(default_model="opus-4-8"))
    assert s.default_model == "opus-4-8"


def test_load_settings_seeds_from_disk(no_env_token, monkeypatch, tmp_path):
    """The end-to-end path a fresh install actually takes: a settings.json with
    only a token in it comes back with the provider and the maestro default."""
    from backend.apps.settings import store
    p = tmp_path / "settings.json"
    p.write_text(json.dumps({PROVEDOR_IA_TOKEN_FIELD: P_FAKE_TOKEN}), encoding="utf-8")
    monkeypatch.setattr(store, "SETTINGS_FILE", str(p))
    monkeypatch.setattr(store, "p_cached_settings", None)
    monkeypatch.setattr(store, "p_cached_sig", None)
    s = store.load_settings()
    assert s.default_model == MAESTRO_DEFAULT_MODEL
    assert s.custom_providers[0].name == MAESTRO_NAME


def test_resolved_model_routes_through_the_9router_custom_node(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, P_FAKE_TOKEN)
    from backend.apps.agents.providers.registry import (
        find_builtin_model,
        find_custom_provider_for_value,
        get_context_window,
        resolve_model_id_for_sdk,
    )
    s = apply_maestro_defaults(AppSettings())
    entry = find_builtin_model(MAESTRO_DEFAULT_MODEL)
    assert entry is not None and entry["api"] == "custom" and entry["route"] == "api"
    assert resolve_model_id_for_sdk(MAESTRO_DEFAULT_MODEL, s) == f"cp-{MAESTRO_SLUG}/maestro-fast"
    assert find_custom_provider_for_value(s, MAESTRO_DEFAULT_MODEL) is not None
    assert get_context_window(MAESTRO_NAME, MAESTRO_DEFAULT_MODEL, s) == 128_000


def test_list_models_offers_provedor_ia_first(no_env_token, monkeypatch):
    monkeypatch.setenv(PROVEDOR_IA_TOKEN_ENV, P_FAKE_TOKEN)
    import asyncio
    from unittest.mock import patch
    from backend.apps.agents.agents import list_models
    cfg = apply_maestro_defaults(AppSettings())
    with patch("backend.apps.settings.settings.load_settings", return_value=cfg), \
         patch("backend.apps.nine_router.is_running", return_value=False):
        groups = asyncio.run(list_models())["models"]
    assert list(groups)[0] == MAESTRO_NAME
    rows = groups[MAESTRO_NAME]
    assert rows[0]["value"] == MAESTRO_DEFAULT_MODEL
    assert rows[0]["label"] == "Maestro Fast"
    assert rows[0]["context_window"] == 128_000
    assert rows[0]["max_completion_tokens"] == 4_096


# --------------------------------------------------------------------------- Requirement 2: the bearer is a credential in every set that matters. ---------------------------------------------------------------------------

def test_token_is_in_every_secret_set():
    from backend.apps.settings.redaction import is_secret_field
    from backend.apps.settings.settings import RESET_PRESERVE_FIELDS
    from backend.apps.swarm.redact import is_denied_key
    from backend.apps.agents.session_credential import ALL_API_KEY_FIELDS
    assert is_secret_field(PROVEDOR_IA_TOKEN_FIELD), "agent-facing settings read would leak the token"
    assert is_denied_key(PROVEDOR_IA_TOKEN_FIELD), "a .swarm bundle would carry the token"
    assert PROVEDOR_IA_TOKEN_FIELD in RESET_PRESERVE_FIELDS, "a preferences reset would disconnect the user"
    assert PROVEDOR_IA_TOKEN_FIELD in ALL_API_KEY_FIELDS


def test_redacted_settings_never_carry_the_token(no_env_token):
    from backend.apps.settings.redaction import redact_settings
    s = apply_maestro_defaults(AppSettings(provedor_ia_token=P_FAKE_TOKEN))
    red = redact_settings(s.model_dump())
    assert red[PROVEDOR_IA_TOKEN_FIELD] == {"configured": True, "last4": P_FAKE_TOKEN[-4:]}
    # The seeded provider mirrors the token into its api_key, so that copy has to be redacted too.
    assert isinstance(red["custom_providers"][0]["api_key"], dict)
    assert P_FAKE_TOKEN not in json.dumps(red)


def test_swarm_scrub_drops_the_token(no_env_token):
    from backend.apps.swarm.redact import find_denied_keys, scrub_payload
    s = apply_maestro_defaults(AppSettings(provedor_ia_token=P_FAKE_TOKEN))
    scrubbed = scrub_payload(s.model_dump())
    assert find_denied_keys(scrubbed) == []
    assert P_FAKE_TOKEN not in json.dumps(scrubbed)


def test_settings_meta_read_never_returns_the_token(no_env_token, monkeypatch):
    """The always-on agent read tool, driven through the real route."""
    import backend.main as p_main
    from backend.apps.settings.settings import load_settings, save_settings
    from fastapi.testclient import TestClient
    import backend.auth as auth_mod
    if not auth_mod.TOKEN:
        import secrets
        auth_mod.TOKEN = secrets.token_urlsafe(32)
    original = load_settings().model_copy(deep=True)
    try:
        s = load_settings()
        s.provedor_ia_token = P_FAKE_TOKEN
        save_settings(s)
        client = TestClient(p_main.app, headers={"Authorization": f"Bearer {auth_mod.TOKEN}"})
        r = client.post("/api/settings-meta/read", json={})
        assert r.status_code == 200
        assert P_FAKE_TOKEN not in r.text
        assert r.json()["settings"][PROVEDOR_IA_TOKEN_FIELD]["configured"] is True
    finally:
        save_settings(original)


@pytest.mark.asyncio
async def test_a_settings_write_logs_nothing_containing_the_token(no_env_token, caplog):
    """The real write path (renderer PUT and the agent tool share it) must not
    narrate the bearer into the log file, where a bug report would carry it out."""
    from backend.apps.settings.settings import (
        apply_settings_update, load_settings, save_settings, settings_write_lock,
    )
    original = load_settings().model_copy(deep=True)
    try:
        with caplog.at_level("DEBUG"):
            body = load_settings()
            body.provedor_ia_token = P_FAKE_TOKEN
            async with settings_write_lock():
                saved = await apply_settings_update(body)
        assert saved.provedor_ia_token == P_FAKE_TOKEN
        # The write also derived the provider, which is what re-syncs the 9Router node.
        assert any(cp.name == MAESTRO_NAME for cp in saved.custom_providers)
        for rec in caplog.records:
            assert P_FAKE_TOKEN not in rec.getMessage()
    finally:
        save_settings(original)


def test_agent_cannot_blank_the_token_powering_its_own_run(no_env_token):
    from backend.apps.agents.session_credential import (
        ALL_API_KEY_FIELDS,
        resolve_powering_credential,
        write_would_suicide,
    )
    s = apply_maestro_defaults(AppSettings(provedor_ia_token=P_FAKE_TOKEN))
    p = resolve_powering_credential(MAESTRO_DEFAULT_MODEL, s)
    assert p.kind == "api_key" and p.protected_field == PROVEDOR_IA_TOKEN_FIELD
    for blank in (None, "", "   "):
        assert write_would_suicide(PROVEDOR_IA_TOKEN_FIELD, blank, p)
    # Removing the seeded provider entry is the other way to disconnect the run.
    assert write_would_suicide("custom_providers", [], p)
    # Every other provider's key stays clearable.
    for other in ALL_API_KEY_FIELDS - {PROVEDOR_IA_TOKEN_FIELD}:
        assert not write_would_suicide(other, "", p)


def test_token_is_never_hardcoded_in_the_source():
    """The token must only ever come from settings or the env var."""
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1] / "apps" / "settings"
    for name in ("maestro.py", "apply_maestro_defaults.py"):
        body = (root / name).read_text(encoding="utf-8")
        assert not re.search(r"api_key\s*=\s*[\"'][^\"']+[\"']", body)
