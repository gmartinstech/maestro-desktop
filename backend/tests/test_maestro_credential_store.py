"""The refresh token's one home: the OS credential store, reached via `keyring`.

The real OS store (Windows Credential Manager / macOS Keychain / Secret Service) is
NEVER touched here: every `keyring` call is monkeypatched onto an in-memory fake, so
this suite runs identically on every CI machine and never leaves a stray credential
behind on the dev box.
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

import pytest

from backend.apps.settings.maestro_credential_store import (
    MAESTRO_KEYRING_SERVICE,
    MAESTRO_KEYRING_USERNAME,
    clear_refresh_token,
    load_refresh_token,
    store_refresh_token,
)


class p_FakeKeyringErrors:
    class PasswordDeleteError(Exception):
        pass


class p_FakeKeyring:
    """An in-memory stand-in for the `keyring` module's three functions."""

    def __init__(self):
        self.store: Dict[Tuple[str, str], str] = {}
        self.errors = p_FakeKeyringErrors

    def set_password(self, service: str, username: str, password: str) -> None:
        self.store[(service, username)] = password

    def get_password(self, service: str, username: str) -> Optional[str]:
        return self.store.get((service, username))

    def delete_password(self, service: str, username: str) -> None:
        if (service, username) not in self.store:
            raise self.errors.PasswordDeleteError("no such entry")
        del self.store[(service, username)]


@pytest.fixture
def fake_keyring(monkeypatch):
    import backend.apps.settings.maestro_credential_store as mod
    fake = p_FakeKeyring()
    monkeypatch.setattr(mod, "keyring", fake)
    return fake


def test_round_trips_through_the_store(fake_keyring):
    assert load_refresh_token() is None
    store_refresh_token("rt-abc123")
    assert load_refresh_token() == "rt-abc123"
    assert fake_keyring.store[(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME)] == "rt-abc123"


def test_storing_again_overwrites(fake_keyring):
    store_refresh_token("rt-first")
    store_refresh_token("rt-second")
    assert load_refresh_token() == "rt-second"


def test_clear_removes_it(fake_keyring):
    store_refresh_token("rt-abc123")
    clear_refresh_token()
    assert load_refresh_token() is None


def test_clear_when_nothing_stored_is_a_no_op_not_an_error(fake_keyring):
    clear_refresh_token()
    assert load_refresh_token() is None


def test_a_missing_entry_reads_none(fake_keyring):
    assert load_refresh_token() is None


def test_store_failure_is_swallowed_not_raised(fake_keyring, monkeypatch):
    def p_boom(*a, **k):
        raise RuntimeError("backend unavailable")
    monkeypatch.setattr(fake_keyring, "set_password", p_boom)
    store_refresh_token("rt-x")  # must not raise


def test_load_failure_is_swallowed_and_reads_none(fake_keyring, monkeypatch):
    def p_boom(*a, **k):
        raise RuntimeError("backend unavailable")
    monkeypatch.setattr(fake_keyring, "get_password", p_boom)
    assert load_refresh_token() is None


def test_the_service_and_username_are_stable_identifiers():
    assert MAESTRO_KEYRING_SERVICE == "MaestroStudio"
    assert MAESTRO_KEYRING_USERNAME == "keycloak-refresh-token"
