"""Seed provedor-ia into settings so it is the app's provider with zero configuration.

Derived, never migrated: this runs on every settings load and every settings
write, so a token arriving through PROVEDOR_IA_TOKEN is picked up without the
user touching Settings, and a token rotated in Settings re-derives the provider
entry (which is what makes apply_settings_update's custom_providers diff re-sync
the 9Router node).

Integration path is a seeded custom provider rather than a BUILTIN_MODELS lane:
the gateway speaks OpenAI, the agent loop speaks Anthropic, so the wire has to
cross 9Router's translator either way, and custom_providers already does exactly
that end to end (sync_custom_providers registers the cp-<slug> node,
configure_provider_env's custom branch hands the SDK OPENAI_BASE_URL/KEY).
"""

from __future__ import annotations

import os
from typing import List, Optional

from typeguard import typechecked

from backend.apps.settings.credentials import MAESTRO_DEFAULT_PROXY_URL
from backend.apps.settings.models import AppSettings, CustomProvider
from backend.apps.settings.provedor_ia import (
    FALLBACK_DEFAULT_MODEL,
    PROVEDOR_IA_DEFAULT_MODEL,
    PROVEDOR_IA_MODELS,
    PROVEDOR_IA_NAME,
    PROVEDOR_IA_TOKEN_ENV,
    PROVEDOR_IA_TOKEN_FIELD,
)


@typechecked
def provedor_ia_token(settings: AppSettings) -> Optional[str]:
    """The provedor-ia bearer: the settings field first, then PROVEDOR_IA_TOKEN."""
    stored = (getattr(settings, PROVEDOR_IA_TOKEN_FIELD, None) or "").strip()
    if stored:
        return stored
    return (os.environ.get(PROVEDOR_IA_TOKEN_ENV) or "").strip() or None


@typechecked
def provedor_ia_provider(token: str) -> CustomProvider:
    """The managed provedor-ia entry; base_url reuses the one gateway constant."""
    return CustomProvider(
        name=PROVEDOR_IA_NAME,
        base_url=MAESTRO_DEFAULT_PROXY_URL,
        api_key=token,
        models=[m.model_dump() for m in PROVEDOR_IA_MODELS],
    )


@typechecked
def p_managed_index(providers: List[CustomProvider]) -> Optional[int]:
    for i, cp in enumerate(providers):
        if (getattr(cp, "name", "") or "").strip().casefold() == PROVEDOR_IA_NAME:
            return i
    return None


@typechecked
def apply_provedor_ia_defaults(settings: AppSettings) -> AppSettings:
    """Upsert the provedor-ia provider when a token exists and keep default_model honest.

    Mutates and returns `settings`. Idempotent, so running it on every load and
    every write can never accumulate duplicate entries. Never deletes: a token
    that goes away leaves the user's existing entry alone rather than silently
    disconnecting them.
    """
    token = provedor_ia_token(settings)
    providers = list(settings.custom_providers or [])
    at = p_managed_index(providers)
    if token:
        managed = provedor_ia_provider(token)
        if at is None:
            # First in the list so it heads the model picker: provedor-ia is the app's own provider, not an add-on.
            providers.insert(0, managed)
        else:
            providers[at] = managed
        settings.custom_providers = providers
    elif at is None and settings.default_model == PROVEDOR_IA_DEFAULT_MODEL:
        # No token means no provedor-ia entry, so the shipped default would name a model the picker cannot offer.
        settings.default_model = FALLBACK_DEFAULT_MODEL
    return settings
