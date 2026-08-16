"""Keep the Maestro access token alive without the user noticing, by silently rotating
it off the Keycloak refresh token the OS credential store holds (maestro_credential_store).

WHY a background loop and not just "refresh on 401": a Keycloak access token is ~12h,
and a session_guard-refused turn (guard_maestro_session) is a dead end for the CURRENT
turn even if the refresh would have succeeded, so refreshing proactively, before the
token actually dies, means a user who opens the app every few hours never sees the
sign-in prompt at all as long as the refresh token (30-day idle timeout) is still good.

Mirrors the shape of refresh_maestro_catalog.py's callers: best-effort, never raises,
and a miss (no refresh token yet, or Keycloak has revoked it) just leaves the existing
token_status state machine to report missing/expired, which is what makes
guard_maestro_session's existing sign-in prompt fire correctly.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from typeguard import typechecked

from backend.apps.settings.maestro import PROVEDOR_IA_TOKEN_FIELD
from backend.apps.settings.maestro_credential_store import load_refresh_token, store_refresh_token
from backend.apps.settings.maestro_keycloak_auth import MaestroKeycloakAuthError, refresh_tokens
from backend.apps.settings.maestro_token_status import maestro_token_status
from backend.apps.settings.models import AppSettings

logger = logging.getLogger(__name__)

# Frequent enough that a token nearing its ~12h death is always caught well before it
# dies; cheap enough (one HTTP round-trip, only when there's a stored refresh token)
# to run in the background forever.
MAESTRO_REFRESH_INTERVAL_SECONDS = 30 * 60
# Proactive refresh threshold: refresh once under an hour of runway remains, comfortably
# outside the UI's own EXPIRY_WARNING_MINUTES=30 notice, so the 30-minute poll cadence
# above can never race the token's actual expiry.
MAESTRO_REFRESH_STATES = ("missing", "expired", "expiring")


@typechecked
async def refresh_maestro_access_token_if_needed(settings: AppSettings, now: Optional[float] = None) -> bool:
    """Mutate `settings` in place with a fresh access token when one is needed and
    available. Returns True when it changed anything (caller must persist), else False.
    Never raises: every failure mode (no refresh token, Keycloak rejected it, network
    down) just leaves `settings` untouched.
    """
    status = maestro_token_status(settings)
    if status.state not in MAESTRO_REFRESH_STATES:
        return False
    refresh_token = load_refresh_token()
    if not refresh_token:
        return False
    try:
        tokens = await refresh_tokens(refresh_token)
    except MaestroKeycloakAuthError as e:
        logger.info("Maestro token refresh failed (%s); sign-in will be needed", e.error)
        return False
    except Exception:
        logger.debug("Maestro token refresh failed unexpectedly", exc_info=True)
        return False
    access_token = tokens.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        return False
    # Keycloak may rotate the refresh token on every use; persisting only the access token would silently strand the rotated one and break the NEXT refresh.
    new_refresh_token = tokens.get("refresh_token")
    if isinstance(new_refresh_token, str) and new_refresh_token:
        store_refresh_token(new_refresh_token)
    setattr(settings, PROVEDOR_IA_TOKEN_FIELD, access_token)
    return True


async def maestro_refresh_loop() -> None:
    """Background task: check + silently refresh the Maestro token every
    MAESTRO_REFRESH_INTERVAL_SECONDS. Runs for the app's whole lifetime; started once
    from settings_lifespan alongside the catalog-refresh and upload-GC loops."""
    from backend.apps.settings.settings import apply_settings_patch, settings_write_lock
    from backend.apps.settings.store import load_settings
    while True:
        try:
            # The Keycloak round trip happens OUTSIDE the lock, and only the token field is written
            # back. Holding a settings snapshot across that call and then saving the whole object
            # reverted every unrelated field written while the network call was in flight — a user
            # (or an agent) editing Settings during a refresh silently lost the edit.
            probe = load_settings()
            if await refresh_maestro_access_token_if_needed(probe, now=time.time()):
                async with settings_write_lock():
                    await apply_settings_patch({PROVEDOR_IA_TOKEN_FIELD: getattr(probe, PROVEDOR_IA_TOKEN_FIELD)})
        except Exception:
            logger.debug("Maestro background token refresh loop iteration failed", exc_info=True)
        await asyncio.sleep(MAESTRO_REFRESH_INTERVAL_SECONDS)
