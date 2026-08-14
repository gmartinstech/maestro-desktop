"""The Maestro Keycloak refresh token's ONE home: the OS credential store.

An access token is short-lived (~12h) and cheap to lose, so it stays in settings.json
next to the field it always lived in (`provedor_ia_token`). A refresh token is the
opposite: it is what keeps a sign-in alive for up to 30 days of idle time with no user
action, so leaking it is a real account-takeover risk, and settings.json is a plaintext
file that already leaves the machine in a support .swarm bundle. `keyring` puts it
instead in Windows Credential Manager (Keychain on macOS, Secret Service on Linux) —
the same OS-native store the reference `windows-provider.ps1` tool already uses, just
reached from Python instead of PowerShell.

Every function here is a thin, total wrapper: never raises on a missing entry (returns
None), and never logs a token value.
"""

from __future__ import annotations

import logging
from typing import Optional

import keyring
from typeguard import typechecked

logger = logging.getLogger(__name__)

MAESTRO_KEYRING_SERVICE = "MaestroStudio"
MAESTRO_KEYRING_USERNAME = "keycloak-refresh-token"


@typechecked
def store_refresh_token(token: str) -> None:
    """Persist the Keycloak refresh token. Never raises the token itself on failure."""
    try:
        keyring.set_password(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME, token)
    except Exception as e:
        logger.warning("Failed to store the Maestro refresh token in the OS credential store: %s", type(e).__name__)


@typechecked
def load_refresh_token() -> Optional[str]:
    """The stored refresh token, or None when there is none (fresh install, cleared, or the OS store errored)."""
    try:
        return keyring.get_password(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME)
    except Exception as e:
        logger.warning("Failed to read the Maestro refresh token from the OS credential store: %s", type(e).__name__)
        return None


@typechecked
def clear_refresh_token() -> None:
    """Drop the stored refresh token (sign-out). A no-op, not an error, when none was stored."""
    try:
        keyring.delete_password(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME)
    except keyring.errors.PasswordDeleteError:
        pass
    except Exception as e:
        logger.warning("Failed to clear the Maestro refresh token from the OS credential store: %s", type(e).__name__)
