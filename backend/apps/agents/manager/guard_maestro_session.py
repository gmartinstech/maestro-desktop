"""Refuse to start a turn whose model routes through Maestro on a dead token.

WHY HERE, and only here: a Maestro token is a ~12h Keycloak access token, kept alive by
a background refresh off the stored Keycloak refresh token (see maestro_scheduler.py), and
sync_custom_providers deliberately does NOT register the 9Router node once that token is
definitively expired (replaying a dead bearer costs a 401 per poll against the gateway's
10/min failed-auth throttle). With no node, `cp-<slug>/<model>` resolves to nothing and the
Claude CLI reports the only thing it can see: "the selected model may not exist or you may
not have access to it. Run --model to pick a different model." That is a credential problem
wearing a configuration problem's clothes, and its advice is wrong, switching models does
not help.

So the fix is to answer the question one step earlier, at the single point that knows BOTH
facts, that the run routes through Maestro and that the token is dead:
configure_provider_env's custom branch, the last gate before the CLI spawns and the place
that would otherwise hand the SDK the dead bearer. Every turn reaches it (chat, workflow
step, scheduled run), so the renderer's session gate being dismissed or bypassed cannot
route around it, and it needs no network round-trip to decide.
"""

from __future__ import annotations

from typeguard import typechecked

from backend.apps.agents.core.MaestroSessionExpiredError import MaestroSessionExpiredError
from backend.apps.agents.providers.registry import (
    CUSTOM_VALUE_PREFIX,
    find_custom_provider_for_value,
)
from backend.apps.settings.models import AppSettings
from backend.apps.settings.maestro import MAESTRO_NAME, MAESTRO_SLUG
from backend.apps.settings.maestro_token_status import needs_login, maestro_token_status


@typechecked
def routes_through_maestro(model_value: str, settings: AppSettings) -> bool:
    """True when a `custom/<slug>/<model>` picker value belongs to the managed Maestro entry."""
    cp = find_custom_provider_for_value(settings, model_value)
    if cp is not None:
        return (getattr(cp, "name", "") or "").strip().casefold() == MAESTRO_NAME.casefold()
    # A cleared token leaves no entry to match, so fall back to the slug the picker value carries.
    if not model_value.startswith(CUSTOM_VALUE_PREFIX):
        return False
    return model_value[len(CUSTOM_VALUE_PREFIX):].partition("/")[0] == MAESTRO_SLUG


@typechecked
def guard_maestro_session(model_value: str, settings: AppSettings) -> None:
    """Raise MaestroSessionExpiredError when this run would go out on a token that cannot work."""
    if not routes_through_maestro(model_value, settings):
        return
    status = maestro_token_status(settings)
    # `opaque` (a static API key, not a JWT) is never treated as dead: only the gateway may judge it.
    if needs_login(status):
        raise MaestroSessionExpiredError(status.state)
