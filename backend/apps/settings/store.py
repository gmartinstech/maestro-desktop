"""Settings persistence primitives (read/write/migrate the settings.json file).

A leaf: imports only settings.models, settings.apply_maestro_defaults and
config.paths, never service or nine_router. Lets service.client reach load/save
downward instead of looping back up through settings.settings.
"""

import json
import logging
import os
import tempfile
import threading
import time
from typing import List, Tuple

from pydantic import ValidationError

from backend.config.paths import SETTINGS_DIR as DATA_DIR
from backend.apps.settings.apply_maestro_defaults import apply_maestro_defaults
from backend.apps.settings.maestro_credential_store import load_refresh_token
from backend.apps.settings.maestro_picker_migration import migrate_picker_value
from backend.apps.settings.maestro_token_status import token_looks_like_jwt
from backend.apps.settings.models import AppSettings, DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_PT_BR

logger = logging.getLogger(__name__)

SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

p_refresh_token_seen = False


def p_has_refresh_token() -> bool:
    """Whether the OS credential store holds a Keycloak refresh token, memoized once true.

    A Windows Credential Manager read measures ~15ms, and this sits in load_settings(), which is
    called all over the request path — so once a refresh token exists (i.e. after sign-in, when the
    answer stops changing) the lookup must not be repeated. The false case is not cached: it flips to
    true the moment a sign-in completes, and it costs nothing to re-check because the only caller
    short-circuits on the JWT shape test first, and a token with no refresh pair is purged on the
    spot, so the field stops looking like a JWT after one pass.
    """
    global p_refresh_token_seen
    if p_refresh_token_seen:
        return True
    p_refresh_token_seen = bool(load_refresh_token())
    return p_refresh_token_seen


# Old field name -> new field name, applied oldest-first so a two-generation-old settings.json chains all the way through (openswarm_auth_token -> openswarm_bearer_token -> maestro_bearer_token).
P_LEGACY_FIELD_RENAMES: List[Tuple[str, str]] = [
    ("openswarm_auth_token", "openswarm_bearer_token"),
    ("openswarm_bearer_token", "maestro_bearer_token"),
    ("openswarm_proxy_url", "maestro_proxy_url"),
]


def migrate_legacy_fields(raw: dict) -> dict:
    """Translate deprecated pre-launch field names ('managed', 'openswarm-pro', 'free-trial') and the pre-rebrand openswarm_* keys into the production schema."""
    # The paid tier and the zero-config trial are both gone; any record still carrying one of those modes routes as own_key.
    if raw.get("connection_mode") in ("managed", "openswarm-pro", "free-trial"):
        raw["connection_mode"] = "own_key"
    for old, new in P_LEGACY_FIELD_RENAMES:
        if old in raw:
            # A value already written under the newer name wins; the stale one is just dropped.
            value = raw.pop(old)
            if new not in raw:
                raw[new] = value
    p_migrate_provedor_ia_identity(raw)
    return raw


def p_migrate_provedor_ia_identity(raw: dict) -> None:
    """One-time (idempotent, runs on every load) cleanup of the pre-Keycloak
    provedor-ia install shape, mutating `raw` in place:

    1. A hand-pasted Keycloak JWT in provedor_ia_token is cleared, but ONLY when the
       OS credential store holds no refresh token. The access token minted by the new
       PKCE flow is itself a JWT and lives in this same field, so a shape check alone
       cannot tell the two apart -- clearing on shape alone wiped a freshly obtained
       token on the very next load, flipping token_status to `missing` and kicking off
       another sign-in in a loop. A stored refresh token is what proves the JWT is ours
       and refreshable; without one it is a legacy paste that can never be renewed, and
       clearing it is what triggers the automatic sign-in. A static opaque key
       (`mtok_...`) is a distinct, still-supported credential type and is left
       completely untouched, never even inspected past the JWT shape check.
    2. The stale `custom_providers` entry literally named "provedor-ia" is dropped;
       apply_maestro_defaults (called right after this, by every load_settings /
       atomic_write_settings) re-inserts a fresh "Maestro"-named entry when a
       (surviving, i.e. opaque) token still exists, so the picker never shows both
       the dead entry and the new one side by side.
    3. default_model is rewritten `custom/provedor-ia/<model>` -> `custom/maestro/<model>`.

    Never logs the token value; only that a stale one was found and cleared.
    """
    token_field = raw.get("provedor_ia_token")
    if isinstance(token_field, str) and token_field.strip() and token_looks_like_jwt(token_field.strip()) and not p_has_refresh_token():
        raw["provedor_ia_token"] = None
        logger.info("Cleared a stale hand-pasted Maestro sign-in token; a fresh Keycloak sign-in will run automatically")
    providers = raw.get("custom_providers")
    if isinstance(providers, list):
        kept = [
            cp for cp in providers
            if not (isinstance(cp, dict) and (cp.get("name") or "").strip().casefold() == "provedor-ia")
        ]
        if len(kept) != len(providers):
            raw["custom_providers"] = kept
    default_model = raw.get("default_model")
    if isinstance(default_model, str):
        migrated = migrate_picker_value(default_model)
        if migrated != default_model:
            raw["default_model"] = migrated


def p_coerce_settings(raw: dict) -> AppSettings:
    """Build AppSettings, surviving a settings.json written by a different app
    version. Unknown fields are already ignored by pydantic; the case this guards
    is a field whose TYPE drifted across versions (e.g. a list that is now a
    dict, or a Literal value that was retired). Without this, one stale field
    would raise ValidationError on every load and brick boot, the GET /api/settings
    endpoint, and agent dispatch. We drop only the offending top-level fields
    (those revert to defaults) and keep every still-valid one, mirroring the
    skip-but-preserve philosophy json_store already uses for schema mismatches."""
    try:
        return AppSettings(**raw)
    except ValidationError as e:
        bad = {err["loc"][0] for err in e.errors() if err.get("loc")}
        logger.warning("settings.json had invalid fields %s; reverting them to defaults", sorted(map(str, bad)))
        cleaned = {k: v for k, v in raw.items() if k not in bad}
        try:
            return AppSettings(**cleaned)
        except ValidationError:
            # Still invalid after dropping the flagged fields (nested shape we can't surgically repair); fall back to all defaults rather than crash.
            logger.warning("settings.json still invalid after dropping bad fields; using defaults")
            return AppSettings()


def p_preserve_corrupt_settings() -> None:
    """Move an unparseable settings.json aside so boot proceeds on defaults while
    the original stays recoverable (the next save would otherwise overwrite it)."""
    try:
        backup = SETTINGS_FILE + ".corrupt"
        os.replace(SETTINGS_FILE, backup)
        logger.warning("settings.json was unparseable; preserved at %s", backup)
    except OSError:
        pass


# In-memory mirror of SETTINGS_FILE, revalidated by stat (mtime+size) on every load so even a hand-edited file or an unexpected writer is picked up immediately. A stat skips the open+parse+validate that Defender turns into 5-50ms on Windows. Copies on both sides keep handler isolation: callers mutate their copy, never the cache.
p_cached_settings: AppSettings | None = None
p_cached_sig: tuple[int, int] | None = None


def p_settings_sig() -> tuple[int, int] | None:
    try:
        st = os.stat(SETTINGS_FILE)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def load_settings() -> AppSettings:
    """Load settings from JSON file, returning defaults if not found. Never raises
    on a corrupt or version-mismatched file: a single bad settings.json must not
    brick boot (it is read at startup, by the settings endpoint, and per dispatch)."""
    global p_cached_settings, p_cached_sig
    sig = p_settings_sig()
    if sig is not None and p_cached_settings is not None and sig == p_cached_sig:
        return p_cached_settings.model_copy(deep=True)
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                raw = json.load(f)
        except (json.JSONDecodeError, OSError, ValueError):
            p_preserve_corrupt_settings()
            return apply_maestro_defaults(AppSettings())
        if not isinstance(raw, dict):
            # Valid JSON but not an object (e.g. a bare list/number); unusable.
            p_preserve_corrupt_settings()
            return apply_maestro_defaults(AppSettings())
        settings = p_coerce_settings(migrate_legacy_fields(raw))
        if settings.default_system_prompt is None:
            settings.default_system_prompt = DEFAULT_SYSTEM_PROMPT
        apply_maestro_defaults(settings)
        p_cached_settings = settings.model_copy(deep=True)
        p_cached_sig = sig
        return settings
    return apply_maestro_defaults(AppSettings())


# threading.Lock guards every SETTINGS_FILE write; works for sync paths and async run_in_executor paths.
p_settings_write_lock = threading.Lock()


def atomic_write_settings(payload: dict) -> None:
    """Atomic SETTINGS_FILE write; call via save_settings*, not directly."""
    global p_cached_settings, p_cached_sig
    with p_settings_write_lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".settings.", suffix=".tmp", dir=DATA_DIR)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            # Windows: Defender can briefly lock the destination; one retry handles every real case.
            for attempt in range(2):
                try:
                    os.replace(tmp, SETTINGS_FILE)
                    # Refresh the cache inside the lock so cache order matches disk order.
                    p_cached_settings = p_coerce_settings(migrate_legacy_fields(dict(payload)))
                    if p_cached_settings.default_system_prompt is None:
                        p_cached_settings.default_system_prompt = DEFAULT_SYSTEM_PROMPT
                    apply_maestro_defaults(p_cached_settings)
                    p_cached_sig = p_settings_sig()
                    return
                except PermissionError:
                    if attempt == 1:
                        raise
                    time.sleep(0.05)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def save_settings(settings_obj: AppSettings) -> None:
    """Sync atomic persist; thread-safe. Async callers should prefer save_settings_async (Defender can stretch writes to 50-200ms)."""
    atomic_write_settings(settings_obj.model_dump())
