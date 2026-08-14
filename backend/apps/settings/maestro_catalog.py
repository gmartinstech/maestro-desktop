"""What Maestro actually serves, asked of the gateway instead of assumed.

`maestro.MAESTRO_MODELS` is a hand-kept list, and a hand-kept list drifts:
the vendor installer still offers three models while `GET /v1/models` returns four.
So the catalog is fetched here and the constant demotes to the offline fallback,
which means a model added server-side reaches the picker with no app release.

The gateway answers with ids and nothing else — no label, no context window — so
labels come from P_KNOWN_LABELS (else the id, prettified) and the window keeps the
vendor's 128k/4096.

Split in two on purpose. `parse_catalog` is pure, and the cache is read through a
*sync* accessor, because `apply_maestro_defaults` runs on every settings load
and every settings write; a network call on that path would block the app. Only
`refresh_catalog` touches the network, from startup and after a token is stored.
"""

from __future__ import annotations

import logging
import time
from typing import Dict, List, Optional, Tuple

import httpx
from pydantic import BaseModel, ConfigDict, InstanceOf
from typeguard import typechecked

from backend.apps.settings.maestro import MaestroModel

logger = logging.getLogger(__name__)

# Long enough that startup plus a token rotation covers a working day, short enough that a model withdrawn server-side stops being offered the same session.
CATALOG_TTL_SECONDS = 900
# The vendor's numbers; the gateway reports neither, so every row inherits them.
P_DEFAULT_CONTEXT_WINDOW = 128_000
P_DEFAULT_MAX_COMPLETION_TOKENS = 4_096
# Labels we already ship, kept verbatim so a fetched catalog is byte-identical to the constant.
P_KNOWN_LABELS: Dict[str, str] = {
    "maestro": "Maestro (default, fast)",
    "maestro-fast": "Maestro Fast",
    "maestro-ultra": "Maestro Ultra",
    "maestro-code": "Maestro Code",
}
# `maestro` is the default model, so it heads the picker whatever order the gateway serves.
P_PREFERRED_ORDER: Tuple[str, ...] = ("maestro", "maestro-fast", "maestro-ultra", "maestro-code")


class P_CachedCatalog(BaseModel):
    """The last catalog the gateway confirmed, with the clock reading that proves its age."""

    model_config = ConfigDict(validate_assignment=True)
    models: List[InstanceOf[MaestroModel]]
    fetched_at: float


p_cached_catalog: Optional[P_CachedCatalog] = None


@typechecked
def p_label_for(model_id: str) -> str:
    """A shipped label when we have one, else the id title-cased into something presentable."""
    known = P_KNOWN_LABELS.get(model_id)
    if known:
        return known
    return " ".join(part.capitalize() for part in model_id.split("-") if part)


@typechecked
def p_sort_key(model_id: str) -> Tuple[int, int, str]:
    """Known models in their shipped order, then anything new alphabetically."""
    if model_id in P_PREFERRED_ORDER:
        return (0, P_PREFERRED_ORDER.index(model_id), "")
    return (1, 0, model_id)


@typechecked
def parse_catalog(payload: object) -> Optional[List[MaestroModel]]:
    """Rows from an OpenAI `/v1/models` body, or None when it taught us nothing.

    None and empty are deliberately different: None keeps the caller on its
    fallback, whereas an empty list would leave the user a picker with no models.
    """
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, list):
        return None
    ids: List[str] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        model_id = row.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        cleaned = model_id.strip()
        if cleaned not in ids:
            ids.append(cleaned)
    if not ids:
        return None
    return [
        MaestroModel(
            value=model_id,
            label=p_label_for(model_id),
            context_window=P_DEFAULT_CONTEXT_WINDOW,
            max_completion_tokens=P_DEFAULT_MAX_COMPLETION_TOKENS,
        )
        for model_id in sorted(ids, key=p_sort_key)
    ]


@typechecked
def remember_catalog(models: List[MaestroModel], now: Optional[float] = None) -> None:
    """Publish a fetched catalog to the sync readers."""
    global p_cached_catalog
    p_cached_catalog = P_CachedCatalog(
        models=list(models), fetched_at=time.time() if now is None else now
    )


@typechecked
def forget_catalog() -> None:
    """Drop the cache; the next read falls back to the shipped constant."""
    global p_cached_catalog
    p_cached_catalog = None


@typechecked
def catalog_models(now: Optional[float] = None) -> Optional[List[MaestroModel]]:
    """The cached catalog while it is fresh, else None. Safe on any hot path."""
    cached = p_cached_catalog
    if cached is None:
        return None
    age = (time.time() if now is None else now) - cached.fetched_at
    if age > CATALOG_TTL_SECONDS:
        return None
    return list(cached.models)


@typechecked
async def refresh_catalog(
    token: Optional[str], base_url: str, now: Optional[float] = None
) -> Optional[List[MaestroModel]]:
    """Fetch and cache the catalog. Never raises, never logs the token.

    Returns None on every miss — no token, a rejection, a malformed body, a dead
    network — and leaves any previously cached catalog in place, because none of
    those is evidence that the model list changed.
    """
    bearer = (token or "").strip()
    # The gateway throttles at 10 failed auths a minute, so a tokenless probe costs more than it can return.
    if not bearer:
        return None
    url = f"{base_url.rstrip('/')}/models"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {bearer}"})
    except Exception as e:
        logger.debug("Maestro catalog fetch failed: %s", type(e).__name__)
        return None
    if response.status_code != 200:
        logger.debug("Maestro catalog fetch returned %s", response.status_code)
        return None
    try:
        payload = response.json()
    except Exception:
        logger.debug("Maestro catalog body was not JSON")
        return None
    models = parse_catalog(payload)
    if models is None:
        logger.debug("Maestro catalog body carried no usable models")
        return None
    remember_catalog(models, now=now)
    return models
