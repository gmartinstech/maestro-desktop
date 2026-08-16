"""Answer one question locally: should the app ask the user to sign in to Maestro again?

A Maestro access token is a Keycloak access token with a ~12h lifetime. As long as the
Keycloak Authorization Code + PKCE flow has run once (maestro_keycloak_auth.py) and the
resulting refresh token (kept in the OS credential store, see maestro_credential_store.py)
is still within its ~30 day idle timeout, maestro_scheduler.py refreshes the access token
silently well before it expires, so this state machine should read `valid`/`expiring`
almost always. It only reads `missing`/`expired` when there is no usable refresh token
either, at which point the app must trigger a fresh browser sign-in.

The `exp` claim is read WITHOUT signature verification, on purpose. This is a UI
decision, never an authorization one: only the gateway may decide whether a token is
good. A credential that is not a JWT (a static API key) reads as `opaque` and is never
treated as dead, because blocking on an undecodable string would lock out a valid setup.
No part of the token is ever returned, logged, or put in an error message.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from typeguard import typechecked

from backend.apps.settings.apply_maestro_defaults import provedor_ia_token
from backend.apps.settings.models import AppSettings

# Under this much runway the UI shows a quiet "your session is ending" notice instead of waiting for the turn to die.
EXPIRY_WARNING_MINUTES = 30
MaestroTokenState = Literal["missing", "expired", "expiring", "valid", "opaque"]
# The two states that mean "cannot work"; `opaque` is deliberately absent (see module docstring).
P_DEAD_STATES = ("missing", "expired")


class MaestroTokenStatus(BaseModel):
    """What the login prompt needs to know, carrying no part of the token itself."""

    model_config = ConfigDict(validate_assignment=True)
    state: MaestroTokenState
    expires_at: Optional[int] = None
    expires_in_minutes: Optional[int] = None


@typechecked
def p_unverified_jwt_exp(token: str) -> Optional[int]:
    """The `exp` claim of an unverified JWT payload; None when the token is not a JWT."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    segment = parts[1]
    try:
        # JWT is base64url with the padding stripped, which urlsafe_b64decode still demands back.
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    except Exception:
        return None
    if not isinstance(claims, dict):
        return None
    exp = claims.get("exp")
    # bool is an int subclass, so exclude it explicitly before the numeric check.
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None
    return int(exp)


@typechecked
def token_looks_like_jwt(token: str) -> bool:
    """True when `token` decodes as a JWT (whether or not it's still live).

    Used by the upgrade migration (store.py) and the env-var reader
    (apply_maestro_defaults.provedor_ia_token) to tell a hand-pasted Keycloak access
    token, the credential type this whole flow replaced, apart from a static opaque
    key (`mtok_...`), which is a distinct, still-supported credential and must never
    be treated as one of these.
    """
    return p_unverified_jwt_exp(token) is not None


@typechecked
def token_status(token: Optional[str], now: Optional[float] = None) -> MaestroTokenStatus:
    """Classify a raw token string. `now` is injectable so tests never depend on the clock."""
    cleaned = (token or "").strip()
    if not cleaned:
        return MaestroTokenStatus(state="missing")
    exp = p_unverified_jwt_exp(cleaned)
    if exp is None:
        return MaestroTokenStatus(state="opaque")
    seconds_left = exp - (time.time() if now is None else now)
    if seconds_left <= 0:
        return MaestroTokenStatus(state="expired", expires_at=exp, expires_in_minutes=0)
    minutes_left = int(seconds_left // 60)
    state: MaestroTokenState = "expiring" if minutes_left < EXPIRY_WARNING_MINUTES else "valid"
    return MaestroTokenStatus(state=state, expires_at=exp, expires_in_minutes=minutes_left)


@typechecked
def maestro_token_status(settings: AppSettings) -> MaestroTokenStatus:
    """Status of the token the app would actually send: the settings field, else PROVEDOR_IA_TOKEN."""
    return token_status(provedor_ia_token(settings))


@typechecked
def needs_login(status: MaestroTokenStatus) -> bool:
    """True when there is nothing usable to send, so the sign-in prompt must block the first turn."""
    return status.state in P_DEAD_STATES
