"""The provedor-ia token's expiry, read locally so the app can prompt instead of dying silently.

A provedor-ia token is a Keycloak access token with a ~10h lifetime and no refresh
token, so the only question these tests care about is the one the UI asks: is there
something usable to send, and if so for how much longer. Four classes are pinned
(missing / expired / valid / undecodable), plus the rule that matters most for data
loss: an already-expired paste is REJECTED, never written to settings.

Every token here is synthesized locally with an unsigned header and a payload we
choose; nothing is minted, nothing is sent anywhere, and no real bearer appears.

Split by test group across sibling files (this one covers token_status() parsing,
i.e. detection): test_maestro_token_status_settings.py covers maestro_token_status()
reading real settings/env, test_maestro_token_status_routes.py covers the HTTP
routes, and test_maestro_token_status_sync.py covers the 9Router sync gate. The
P_NOW/p_b64/jwt_token helpers below are shared and imported by the others (each
of those files keeps its own local no_env_token fixture, matching the existing
one-fixture-per-file convention in test_maestro.py/test_maestro_scheduler.py).
"""

from __future__ import annotations

import base64
import json
from typing import Any, Dict

import pytest

from backend.apps.settings.maestro_token_status import (
    EXPIRY_WARNING_MINUTES,
    needs_login,
    token_status,
)

P_NOW = 1_800_000_000.0


def p_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def jwt_token(claims: Dict[str, Any]) -> str:
    """A structurally valid, deliberately unsigned JWT; the helper never checks the signature."""
    return f"{p_b64(b'{\"alg\":\"RS256\",\"typ\":\"JWT\"}')}.{p_b64(json.dumps(claims).encode())}.not-a-signature"


# --------------------------------------------------------------------------- Detection.
@pytest.mark.parametrize("token", [None, "", "   ", "\n\t "])
def test_no_token_reads_missing(token):
    status = token_status(token, now=P_NOW)
    assert status.state == "missing"
    assert status.expires_at is None and status.expires_in_minutes is None
    assert needs_login(status)


def test_expired_token_reads_expired():
    exp = int(P_NOW) - 60
    status = token_status(jwt_token({"exp": exp}), now=P_NOW)
    assert status.state == "expired"
    assert status.expires_at == exp and status.expires_in_minutes == 0
    assert needs_login(status)


def test_exactly_at_expiry_reads_expired():
    """The boundary belongs to expired: a token that dies this instant must not be offered."""
    assert token_status(jwt_token({"exp": int(P_NOW)}), now=P_NOW).state == "expired"


def test_fresh_token_reads_valid_with_its_runway():
    """A freshly minted Keycloak token: ~10h of life, reported in whole minutes."""
    status = token_status(jwt_token({"exp": int(P_NOW) + 10 * 3600}), now=P_NOW)
    assert status.state == "valid"
    assert status.expires_in_minutes == 600
    assert not needs_login(status)


def test_token_inside_the_warning_window_reads_expiring():
    """The quiet 'your session is ending' notice, not a block: there is still a usable token."""
    status = token_status(jwt_token({"exp": int(P_NOW) + 10 * 60}), now=P_NOW)
    assert status.state == "expiring"
    assert status.expires_in_minutes == 10
    assert not needs_login(status)


def test_the_warning_window_boundary_is_the_documented_one():
    below = token_status(jwt_token({"exp": int(P_NOW) + EXPIRY_WARNING_MINUTES * 60 - 60}), now=P_NOW)
    at = token_status(jwt_token({"exp": int(P_NOW) + EXPIRY_WARNING_MINUTES * 60}), now=P_NOW)
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
    status = token_status(jwt_token({"exp": P_NOW + 3600.7}), now=P_NOW)
    assert status.state == "valid" and status.expires_at == int(P_NOW + 3600.7)
