"""Fetch the Maestro catalog, then re-derive the provider entry from it.

The seam both callers share: the settings lifespan (so a launch picks up models
added server-side) and the Keycloak sign-in callback (so a fresh sign-in seeds the live
catalog in the same write). Lives in its own module because it needs the gateway
constant *and* the seeding helper, and the catalog module is imported by the
latter — putting it there would close an import cycle.

Re-deriving in place matters: `load_settings` caches by file signature, so a reload
after the fetch would hand back the object derived from the stale catalog. Mutating
the live instance is what makes the fetched models visible without a settings write.
"""

from __future__ import annotations

import logging

from typeguard import typechecked

from backend.apps.settings.apply_maestro_defaults import (
    apply_maestro_defaults,
    provedor_ia_token,
)
from backend.apps.settings.credentials import MAESTRO_DEFAULT_PROXY_URL
from backend.apps.settings.models import AppSettings
from backend.apps.settings.maestro_catalog import refresh_catalog

logger = logging.getLogger(__name__)


@typechecked
async def refresh_maestro_catalog(settings: AppSettings) -> bool:
    """True when the gateway answered and `settings` now carries its catalog.

    False on every miss (no token, rejection, dead network) with `settings`
    untouched, so the caller keeps whatever seeding already gave it. Never raises:
    both callers are best-effort, and one of them is a background startup task.
    """
    models = await refresh_catalog(provedor_ia_token(settings), MAESTRO_DEFAULT_PROXY_URL)
    if models is None:
        return False
    apply_maestro_defaults(settings)
    logger.debug("Maestro catalog refreshed: %d models", len(models))
    return True
