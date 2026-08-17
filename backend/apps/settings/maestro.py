"""The Maestro contract: Maestro Studio's own OpenAI-compatible gateway.

Constants only, so the settings store can seed the provider without importing the
provider registry (which pulls httpx + the OpenRouter catalog). The wire is
OpenAI chat-completions; the gateway also serves the Responses shape, but the
agent loop reaches it through 9Router's chat translator, so chat is what we
configure.

The token is never baked in: it comes from AppSettings.provedor_ia_token or the
PROVEDOR_IA_TOKEN env var (field/env names kept for on-disk compatibility), and is
now minted automatically via the Keycloak Authorization Code + PKCE flow instead of
a hand-pasted JWT; see maestro_keycloak_auth.py.
"""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict

MAESTRO_NAME = "Maestro"
# 9Router prefix + picker-value slug derived from the name; a test pins it to custom_provider_slug_for_lookup.
MAESTRO_SLUG = "maestro"
# Kept unchanged on purpose: renaming this settings-model field name or env var would silently
# break every install's persisted settings.json; only the display identity above was renamed.
PROVEDOR_IA_TOKEN_ENV = "PROVEDOR_IA_TOKEN"
PROVEDOR_IA_TOKEN_FIELD = "provedor_ia_token"


class MaestroModel(BaseModel):
    """One row of the Maestro catalog, mirrored into CustomProvider.models."""

    model_config = ConfigDict(validate_assignment=True)
    value: str
    label: str
    context_window: int
    max_completion_tokens: int


# Straight from the vendor installers (launch.ps1?pi and ?chatgpt): 128k context and 4096 max output each. The set mirrors the gateway's own `allow` list; a mask missing here is simply unreachable from the picker.
MAESTRO_MODELS: List[MaestroModel] = [
    MaestroModel(value="maestro-fast", label="Maestro Fast",
                    context_window=128_000, max_completion_tokens=4_096),
    MaestroModel(value="maestro", label="Maestro",
                    context_window=128_000, max_completion_tokens=4_096),
    MaestroModel(value="maestro-ultra", label="Maestro Ultra",
                    context_window=128_000, max_completion_tokens=4_096),
    MaestroModel(value="maestro-code", label="Maestro Code",
                    context_window=128_000, max_completion_tokens=4_096),
]

# maestro-fast, not maestro: measured straight against the gateway with an identical trivial prompt,
# `maestro` (deepseek-v4-flash) took 8.44s against maestro-fast's (nemotron-3-nano) 1.49s, because it
# spends most of its budget on reasoning tokens before emitting any content. A first turn that takes
# ~8s reads as a hung app, so the snappy model is the better default and the picker still offers the
# slower, more capable ones by name.
MAESTRO_DEFAULT_MODEL_ID = "maestro-fast"
# Picker-value shape is CUSTOM_VALUE_PREFIX + slug + "/" + model id, spelled out so this stays a leaf module; a test pins it to the registry's composition.
MAESTRO_DEFAULT_MODEL = f"custom/{MAESTRO_SLUG}/{MAESTRO_DEFAULT_MODEL_ID}"
# Where default_model lands when there is no token, hence no Maestro entry for the picker to offer.
FALLBACK_DEFAULT_MODEL = "sonnet"
