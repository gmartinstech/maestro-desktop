"""The provedor-ia contract: Maestro Studio's own OpenAI-compatible gateway.

Constants only, so the settings store can seed the provider without importing the
provider registry (which pulls httpx + the OpenRouter catalog). The wire is
OpenAI chat-completions; the gateway also serves the Responses shape, but the
agent loop reaches it through 9Router's chat translator, so chat is what we
configure.

The token is never baked in: it comes from AppSettings.provedor_ia_token or the
PROVEDOR_IA_TOKEN env var, and users mint one at https://llm.martinstech.net/login.
"""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict

PROVEDOR_IA_NAME = "provedor-ia"
# 9Router prefix + picker-value slug derived from the name; a test pins it to custom_provider_slug_for_lookup.
PROVEDOR_IA_SLUG = "provedor-ia"
PROVEDOR_IA_TOKEN_ENV = "PROVEDOR_IA_TOKEN"
PROVEDOR_IA_TOKEN_FIELD = "provedor_ia_token"


class ProvedorIaModel(BaseModel):
    """One row of the provedor-ia catalog, mirrored into CustomProvider.models."""

    model_config = ConfigDict(validate_assignment=True)
    value: str
    label: str
    context_window: int
    max_completion_tokens: int


# Straight from the vendor installers (launch.ps1?pi and ?chatgpt): three models, 128k context and 4096 max output each.
PROVEDOR_IA_MODELS: List[ProvedorIaModel] = [
    ProvedorIaModel(value="maestro", label="Maestro (default, fast)",
                    context_window=128_000, max_completion_tokens=4_096),
    ProvedorIaModel(value="maestro-ultra", label="Maestro Ultra",
                    context_window=128_000, max_completion_tokens=4_096),
    ProvedorIaModel(value="maestro-code", label="Maestro Code",
                    context_window=128_000, max_completion_tokens=4_096),
]

PROVEDOR_IA_DEFAULT_MODEL_ID = "maestro"
# Picker-value shape is CUSTOM_VALUE_PREFIX + slug + "/" + model id, spelled out so this stays a leaf module; a test pins it to the registry's composition.
PROVEDOR_IA_DEFAULT_MODEL = f"custom/{PROVEDOR_IA_SLUG}/{PROVEDOR_IA_DEFAULT_MODEL_ID}"
# Where default_model lands when there is no token, hence no provedor-ia entry for the picker to offer.
FALLBACK_DEFAULT_MODEL = "sonnet"
