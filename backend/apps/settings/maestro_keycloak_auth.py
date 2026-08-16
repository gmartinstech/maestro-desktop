"""The Keycloak Authorization Code + PKCE flow that replaces the hand-pasted-JWT login.

Three calls make up the whole flow: build_authorize_url() mints the PKCE pair and the
URL Electron opens in the system browser; exchange_code_for_tokens() trades the
callback's `code` for an access + refresh token pair; refresh_tokens() rotates that
pair again once the access token nears expiry (see maestro_scheduler.py). All three
talk to the SAME public client (`MAESTRO_CLIENT_ID`, no secret: PKCE authenticates the
request), so nothing here can leak a client credential because there isn't one.

Every response is read for its JSON shape only. Neither an access nor a refresh token,
nor the authorization `code`, is ever logged or folded into an exception message: a
non-200 reaches MaestroKeycloakAuthError with the HTTP status and the response's `error`
field only, never the raw body (which, on a slow/misconfigured proxy, could echo the
request back).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from typing import Any, Dict, Tuple
from urllib.parse import urlencode

import httpx
from typeguard import typechecked

logger = logging.getLogger(__name__)

MAESTRO_KEYCLOAK_ISSUER = "https://martinstech.net/auth/realms/MartinsTech"
MAESTRO_KEYCLOAK_AUTHORIZE_URL = f"{MAESTRO_KEYCLOAK_ISSUER}/protocol/openid-connect/auth"
MAESTRO_KEYCLOAK_TOKEN_URL = f"{MAESTRO_KEYCLOAK_ISSUER}/protocol/openid-connect/token"
# Fixed infrastructure, not a display name: the Keycloak client this app authenticates as. Never renamed alongside the Maestro display-identity rename.
MAESTRO_KEYCLOAK_CLIENT_ID = "provedor-ia-web"
# 127.0.0.1 is the primary (9Router's bundled Node subprocess already proxies any hit on
# this port's /callback to /api/subscriptions/callback); localhost is the registered
# fallback should a resolver quirk make 127.0.0.1 unreachable in the user's browser.
MAESTRO_KEYCLOAK_REDIRECT_URI = "http://127.0.0.1:20128/callback"
MAESTRO_KEYCLOAK_REDIRECT_URI_FALLBACK = "http://localhost:20128/callback"
MAESTRO_KEYCLOAK_SCOPE = "openid offline_access"


class MaestroKeycloakAuthError(Exception):
    """A Keycloak token-endpoint call failed. Carries the HTTP status and the endpoint's
    own `error` code only, never the response body, which on this endpoint can contain
    an echoed authorization code or (for a slow-to-fail proxy) a token."""

    def __init__(self, status_code: int, error: str) -> None:
        self.status_code = status_code
        self.error = error
        super().__init__(f"Keycloak token request failed: {status_code} {error}")


def p_code_verifier() -> str:
    """A PKCE code_verifier per RFC 7636: url-safe, 43-128 chars. token_urlsafe(64) lands at 86."""
    return secrets.token_urlsafe(64)


def p_code_challenge(verifier: str) -> str:
    """S256 code_challenge: base64url(sha256(verifier)) with padding stripped."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@typechecked
def build_authorize_url() -> Tuple[str, str, str]:
    """A fresh (authorize_url, state, code_verifier) triple for one login attempt.

    The caller persists `state -> {code_verifier, ...}` (oauth_state.pending_oauth) and
    hands `authorize_url` to Electron's shell.openExternal; the callback later looks the
    pending entry back up by `state` to complete the exchange.
    """
    state = secrets.token_urlsafe(24)
    verifier = p_code_verifier()
    challenge = p_code_challenge(verifier)
    params = {
        "response_type": "code",
        "client_id": MAESTRO_KEYCLOAK_CLIENT_ID,
        "redirect_uri": MAESTRO_KEYCLOAK_REDIRECT_URI,
        "scope": MAESTRO_KEYCLOAK_SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    authorize_url = f"{MAESTRO_KEYCLOAK_AUTHORIZE_URL}?{urlencode(params)}"
    return authorize_url, state, verifier


def p_token_error(response: httpx.Response) -> str:
    """The endpoint's own `error` code, never the raw body (which can carry secrets)."""
    try:
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("error"), str):
            return payload["error"]
    except Exception:
        pass
    return "unknown_error"


async def p_post_token_endpoint(data: Dict[str, str]) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                MAESTRO_KEYCLOAK_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as e:
        # Never let the underlying exception (which can quote the request body) escape as-is.
        logger.warning("Maestro Keycloak token request failed: %s", type(e).__name__)
        raise MaestroKeycloakAuthError(0, "network_error") from None
    if response.status_code != 200:
        error = p_token_error(response)
        logger.warning("Maestro Keycloak token endpoint rejected the request: %s %s", response.status_code, error)
        raise MaestroKeycloakAuthError(response.status_code, error)
    try:
        return response.json()
    except Exception:
        raise MaestroKeycloakAuthError(response.status_code, "invalid_response") from None


@typechecked
async def exchange_code_for_tokens(code: str, code_verifier: str, redirect_uri: str) -> Dict[str, Any]:
    """Trade an authorization `code` for `{access_token, refresh_token, expires_in, ...}`.

    No client_secret: this is a public client, PKCE (`code_verifier`) is what
    authenticates the request instead.
    """
    return await p_post_token_endpoint({
        "grant_type": "authorization_code",
        "client_id": MAESTRO_KEYCLOAK_CLIENT_ID,
        "code": code,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    })


@typechecked
async def refresh_tokens(refresh_token: str) -> Dict[str, Any]:
    """Trade a refresh_token for a fresh token pair.

    Keycloak may rotate the refresh token on every use: the caller MUST persist
    whatever `refresh_token` comes back in the response, not just the access token,
    or the next refresh will replay a stale one and fail.
    """
    return await p_post_token_endpoint({
        "grant_type": "refresh_token",
        "client_id": MAESTRO_KEYCLOAK_CLIENT_ID,
        "refresh_token": refresh_token,
    })
