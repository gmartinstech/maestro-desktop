"""The one-time upgrade cleanup: an existing install's stale provedor-ia shape must
not survive into the Keycloak-only world, but its still-supported opaque static key
must survive untouched.

Exercises `migrate_legacy_fields` directly on a raw dict (the exact seam both
load_settings and atomic_write_settings's cache-refresh already call), so no file I/O
is needed and no real credential ever appears.
"""

from __future__ import annotations

import base64
import json
import time

from backend.apps.settings.store import migrate_legacy_fields
from backend.apps.settings.maestro_picker_migration import migrate_picker_value


def p_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def p_jwt(exp: int) -> str:
    header = p_b64(b'{"alg":"RS256","typ":"JWT"}')
    return f"{header}.{p_b64(json.dumps({'exp': exp}).encode())}.not-a-real-signature-zzz"


# --------------------------------------------------------------------------- (a) a stale JWT is purged.


def test_a_live_jwt_in_the_field_is_still_purged():
    """Even a currently-VALID pasted JWT must go: it has no refresh token, so
    keeping it just delays the dead-end by up to ~12h."""
    live = p_jwt(int(time.time()) + 10 * 3600)
    raw = {"provedor_ia_token": live}
    out = migrate_legacy_fields(dict(raw))
    assert out["provedor_ia_token"] is None
    from backend.apps.settings.maestro_token_status import token_status
    assert token_status(out["provedor_ia_token"]).state == "missing"


def test_an_expired_jwt_in_the_field_is_purged_too():
    expired = p_jwt(int(time.time()) - 3600)
    out = migrate_legacy_fields({"provedor_ia_token": expired})
    assert out["provedor_ia_token"] is None


def test_the_purge_never_logs_the_token_value(caplog):
    live = p_jwt(int(time.time()) + 3600)
    with caplog.at_level("INFO"):
        migrate_legacy_fields({"provedor_ia_token": live})
    for record in caplog.records:
        assert live not in record.getMessage()
        for fragment in live.split("."):
            assert fragment not in record.getMessage()


# --------------------------------------------------------------------------- (b) an opaque static key survives untouched.


def test_an_opaque_static_key_survives_the_migration_untouched():
    raw = {"provedor_ia_token": "mtok_a_static_api_key_0000"}
    out = migrate_legacy_fields(dict(raw))
    assert out["provedor_ia_token"] == "mtok_a_static_api_key_0000"
    from backend.apps.settings.maestro_token_status import token_status
    assert token_status(out["provedor_ia_token"]).state == "opaque"


# --------------------------------------------------------------------------- (c) default_model / custom_providers migrate.


def test_default_model_picker_value_migrates():
    assert migrate_picker_value("custom/provedor-ia/maestro") == "custom/maestro/maestro"
    assert migrate_picker_value("custom/provedor-ia/maestro-ultra") == "custom/maestro/maestro-ultra"
    # Untouched values pass straight through.
    assert migrate_picker_value("sonnet") == "sonnet"
    assert migrate_picker_value("custom/lmstudio/llama") == "custom/lmstudio/llama"


def test_default_model_is_migrated_in_the_raw_settings_dict():
    out = migrate_legacy_fields({"default_model": "custom/provedor-ia/maestro"})
    assert out["default_model"] == "custom/maestro/maestro"


def test_the_stale_named_custom_provider_entry_is_dropped():
    raw = {
        "custom_providers": [
            {"name": "provedor-ia", "base_url": "https://llm.martinstech.net/v1", "api_key": "mtok_x", "models": []},
            {"name": "LM Studio", "base_url": "http://localhost:1234/v1", "api_key": "", "models": []},
        ],
    }
    out = migrate_legacy_fields(dict(raw))
    names = [cp["name"] for cp in out["custom_providers"]]
    assert "provedor-ia" not in names
    assert "LM Studio" in names


def test_a_provedor_ia_named_entry_is_dropped_case_insensitively():
    raw = {"custom_providers": [{"name": "Provedor-IA", "base_url": "x", "api_key": "k", "models": []}]}
    out = migrate_legacy_fields(dict(raw))
    assert out["custom_providers"] == []


# --------------------------------------------------------------------------- (d) idempotent.


def test_the_migration_is_idempotent():
    live = p_jwt(int(time.time()) + 3600)
    raw = {
        "provedor_ia_token": live,
        "default_model": "custom/provedor-ia/maestro",
        "custom_providers": [{"name": "provedor-ia", "base_url": "x", "api_key": live, "models": []}],
    }
    once = migrate_legacy_fields(dict(raw))
    twice = migrate_legacy_fields(dict(once))
    assert once == twice
    assert twice["provedor_ia_token"] is None
    assert twice["default_model"] == "custom/maestro/maestro"
    assert twice["custom_providers"] == []


def test_running_twice_on_an_already_opaque_already_migrated_record_changes_nothing():
    raw = {
        "provedor_ia_token": "mtok_stable_key",
        "default_model": "custom/maestro/maestro",
        "custom_providers": [{"name": "Maestro", "base_url": "x", "api_key": "mtok_stable_key", "models": []}],
    }
    once = migrate_legacy_fields(dict(raw))
    twice = migrate_legacy_fields(dict(once))
    assert once == raw
    assert twice == raw


# --------------------------------------------------------------------------- (e) a fresh install is unaffected.


def test_a_fresh_install_with_no_old_config_is_unaffected():
    out = migrate_legacy_fields({})
    assert out == {}


def test_a_fresh_install_with_only_unrelated_fields_is_unaffected():
    raw = {"theme": "dark", "anthropic_api_key": "sk-ant-real-key"}
    out = migrate_legacy_fields(dict(raw))
    assert out == raw


# --------------------------------------------------------------------------- Scope: other credentials are never touched.


def test_other_provider_credentials_are_left_alone():
    raw = {
        "provedor_ia_token": "mtok_x",
        "anthropic_api_key": "sk-ant-should-not-move",
        "openai_api_key": "sk-should-not-move",
        "google_api_key": "should-not-move",
    }
    out = migrate_legacy_fields(dict(raw))
    assert out["anthropic_api_key"] == "sk-ant-should-not-move"
    assert out["openai_api_key"] == "sk-should-not-move"
    assert out["google_api_key"] == "should-not-move"


# --------------------------------------------------------------------------- End-to-end through load_settings.


def test_load_settings_end_to_end_purges_a_stale_jwt_and_migrates_the_picker_value(tmp_path, monkeypatch):
    from backend.apps.settings import store
    live = p_jwt(int(time.time()) + 10 * 3600)
    p = tmp_path / "settings.json"
    p.write_text(json.dumps({
        "provedor_ia_token": live,
        "default_model": "custom/provedor-ia/maestro",
        "custom_providers": [{"name": "provedor-ia", "base_url": "https://llm.martinstech.net/v1", "api_key": live, "models": []}],
    }), encoding="utf-8")
    monkeypatch.setattr(store, "SETTINGS_FILE", str(p))
    monkeypatch.setattr(store, "p_cached_settings", None)
    monkeypatch.setattr(store, "p_cached_sig", None)
    monkeypatch.delenv("PROVEDOR_IA_TOKEN", raising=False)
    s = store.load_settings()
    assert s.provedor_ia_token is None
    from backend.apps.settings.maestro_token_status import maestro_token_status
    assert maestro_token_status(s).state == "missing"
    # The stale-named entry is gone, and with no surviving token nothing new was inserted in its place.
    assert s.custom_providers == []


# --------------------------------------------------------------------------- (f) agent sessions: same rename, read through session_store.


def test_a_session_with_a_stale_picker_value_migrates_on_load(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.agents.manager.session.session_store import load_session_data
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "model": "custom/provedor-ia/maestro"})
    assert load_session_data("s1")["model"] == "custom/maestro/maestro"


def test_a_session_with_an_unrelated_model_is_returned_unchanged(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.agents.manager.session.session_store import load_session_data
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "model": "sonnet"})
    am.save_session("s2", {"id": "s2", "model": "custom/other-provider/x"})
    assert load_session_data("s1")["model"] == "sonnet"
    assert load_session_data("s2")["model"] == "custom/other-provider/x"


def test_load_all_session_data_migrates_every_stale_session(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.agents.manager.session.session_store import load_all_session_data
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "model": "custom/provedor-ia/maestro"})
    am.save_session("s2", {"id": "s2", "model": "sonnet"})
    loaded = dict(load_all_session_data())
    assert loaded["s1"]["model"] == "custom/maestro/maestro"
    assert loaded["s2"]["model"] == "sonnet"


def test_session_load_does_not_rewrite_the_file_on_disk(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.agents.manager.session.session_store import load_session_data
    from backend.config.json_store import read_json_or_none
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "model": "custom/provedor-ia/maestro"})
    load_session_data("s1")  # migrated in memory
    assert read_json_or_none(str(tmp_path / "s1.json"))["model"] == "custom/provedor-ia/maestro"  # untouched on disk


def test_get_history_reports_the_migrated_model(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "name": "old", "model": "custom/provedor-ia/maestro", "closed_at": "2026-01-01"})
    history = am.agent_manager.get_history()
    assert history["sessions"][0]["model"] == "custom/maestro/maestro"


def test_session_migration_is_idempotent(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.agents.manager.session.session_store import load_session_data
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    am.save_session("s1", {"id": "s1", "model": "custom/maestro/maestro"})
    assert load_session_data("s1")["model"] == "custom/maestro/maestro"


# --------------------------------------------------------------------------- (g) swarm bundle import: a stale value in the bundle is rewritten on the way in.


def test_swarm_session_import_migrates_a_stale_picker_value(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.swarm.entities.SessionExportable import SessionExportable
    from backend.apps.swarm.exportable import RemapTable
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    payload = {"name": "Shared Agent", "provider": "custom", "model": "custom/provedor-ia/maestro", "mode": "agent"}
    sid = SessionExportable.import_(payload, {}, RemapTable())
    assert am.load_session_data(sid)["model"] == "custom/maestro/maestro"


def test_swarm_session_import_leaves_an_unrelated_model_untouched(tmp_path, monkeypatch):
    from backend.apps.agents import agent_manager as am
    from backend.apps.swarm.entities.SessionExportable import SessionExportable
    from backend.apps.swarm.exportable import RemapTable
    monkeypatch.setattr(am, "SESSIONS_DIR", str(tmp_path))
    payload = {"name": "Shared Agent", "provider": "anthropic", "model": "sonnet", "mode": "agent"}
    sid = SessionExportable.import_(payload, {}, RemapTable())
    assert am.load_session_data(sid)["model"] == "sonnet"
