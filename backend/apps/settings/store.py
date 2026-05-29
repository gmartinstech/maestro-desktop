"""Settings persistence primitives (read/write/migrate the settings.json file).

A leaf: imports only settings.models + config.paths, never service or
nine_router. Lets service.client reach load/save downward instead of looping
back up through settings.settings.
"""

import json
import logging
import os
import tempfile
import threading
import time

from pydantic import ValidationError

from backend.config.paths import SETTINGS_DIR as DATA_DIR
from backend.apps.settings.models import AppSettings, DEFAULT_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")


def _migrate_legacy_fields(raw: dict) -> dict:
    """Translate deprecated pre-launch field names ('managed', 'openswarm_auth_token') into production schema."""
    if raw.get("connection_mode") == "managed":
        raw["connection_mode"] = "openswarm-pro"
    if "openswarm_auth_token" in raw and "openswarm_bearer_token" not in raw:
        raw["openswarm_bearer_token"] = raw.pop("openswarm_auth_token")
    return raw


def _coerce_settings(raw: dict) -> AppSettings:
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
            # Still invalid after dropping the flagged fields (nested shape we
            # can't surgically repair); fall back to all defaults rather than crash.
            logger.warning("settings.json still invalid after dropping bad fields; using defaults")
            return AppSettings()


def _preserve_corrupt_settings() -> None:
    """Move an unparseable settings.json aside so boot proceeds on defaults while
    the original stays recoverable (the next save would otherwise overwrite it)."""
    try:
        backup = SETTINGS_FILE + ".corrupt"
        os.replace(SETTINGS_FILE, backup)
        logger.warning("settings.json was unparseable; preserved at %s", backup)
    except OSError:
        pass


def load_settings() -> AppSettings:
    """Load settings from JSON file, returning defaults if not found. Never raises
    on a corrupt or version-mismatched file: a single bad settings.json must not
    brick boot (it is read at startup, by the settings endpoint, and per dispatch)."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                raw = json.load(f)
        except (json.JSONDecodeError, OSError, ValueError):
            _preserve_corrupt_settings()
            return AppSettings()
        if not isinstance(raw, dict):
            # Valid JSON but not an object (e.g. a bare list/number); unusable.
            _preserve_corrupt_settings()
            return AppSettings()
        settings = _coerce_settings(_migrate_legacy_fields(raw))
        if settings.default_system_prompt is None:
            settings.default_system_prompt = DEFAULT_SYSTEM_PROMPT
        return settings
    return AppSettings()


# threading.Lock guards every SETTINGS_FILE write; works for sync paths and async run_in_executor paths.
_settings_write_lock = threading.Lock()


def _atomic_write_settings(payload: dict) -> None:
    """Atomic SETTINGS_FILE write; call via save_settings*, not directly."""
    with _settings_write_lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".settings.", suffix=".tmp", dir=DATA_DIR)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            # Windows: Defender can briefly lock the destination; one retry handles every real case.
            for attempt in range(2):
                try:
                    os.replace(tmp, SETTINGS_FILE)
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
    _atomic_write_settings(settings_obj.model_dump())


def _save_settings(settings_obj: AppSettings) -> None:
    save_settings(settings_obj)
