"""Boot-time recovery of app workspaces whose Output record went missing.

An app is a record under OUTPUTS_DIR plus a workspace directory under OUTPUTS_WORKSPACE_DIR. Lose
the record (failed write, partial delete, crash mid-create) and the user's work is still on disk
but nothing in the UI can reach it: silent data loss. This scans for workspace directories no
record points at and re-registers them.

Two things it deliberately does NOT do:
  - resurrect a deliberate delete. `delete_output` leaves the workspace on disk on purpose, so it
    now drops a tombstone inside it (see TOMBSTONE_NAME); a tombstoned directory is skipped.
  - fabricate a healthy-looking record. A recovered row carries recovered=True, an empty `files`
    map and no session link, because we genuinely do not know any of that. A workspace with no
    sign of real work (no run.sh / index.html / meta.json) is left alone rather than surfaced as
    an app that cannot open.
"""

import json
import logging
import os
from datetime import datetime
from typing import List, Optional

from typeguard import typechecked

from backend.apps.outputs.models import Output
from backend.config.paths import OUTPUTS_WORKSPACE_DIR
from backend.config.state_paths import state_dir

logger = logging.getLogger(__name__)

# Written into the workspace's own .maestro dir when the user deletes the app, so recovery can tell "deleted on purpose" from "record lost".
TOMBSTONE_NAME = "deleted"

# A directory holding any of these has had real work done in it; anything else is a husk we must not advertise as an openable app.
P_WORK_EVIDENCE = ("run.sh", "index.html", "meta.json", "backend.py", "package.json")

# Distinct Material symbol so a recovered app is visually distinguishable with no locale-specific copy in the record.
RECOVERED_ICON = "restore_page"


@typechecked
def tombstone(workspace_id: str) -> None:
    """Mark a workspace as deliberately deleted. Best-effort: without it recovery would offer the app back on the next boot, which is worse than a leftover directory."""
    folder = os.path.join(OUTPUTS_WORKSPACE_DIR, workspace_id)
    if not os.path.isdir(folder):
        return
    try:
        path = state_dir(folder, TOMBSTONE_NAME)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(datetime.now().isoformat())
    except OSError:
        logger.exception("could not tombstone deleted workspace %s", workspace_id)


@typechecked
def is_tombstoned(folder: str) -> bool:
    return os.path.exists(state_dir(folder, TOMBSTONE_NAME))


@typechecked
def p_has_work(folder: str) -> bool:
    return any(os.path.exists(os.path.join(folder, name)) for name in P_WORK_EVIDENCE)


@typechecked
def p_meta_name(folder: str) -> Optional[str]:
    """The app's own name from meta.json, when the agent got far enough to write one."""
    try:
        with open(os.path.join(folder, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(meta, dict):
        return None
    name = str(meta.get("name") or "").strip()
    return name or None


@typechecked
def orphan_workspace_ids(known_workspace_ids: set) -> List[str]:
    """Workspace directories worth recovering: unreferenced, not tombstoned, and holding real work.
    Sorted so a boot log reads the same twice."""
    if not os.path.isdir(OUTPUTS_WORKSPACE_DIR):
        return []
    out: List[str] = []
    for name in sorted(os.listdir(OUTPUTS_WORKSPACE_DIR)):
        folder = os.path.join(OUTPUTS_WORKSPACE_DIR, name)
        if not os.path.isdir(folder) or name in known_workspace_ids:
            continue
        if is_tombstoned(folder) or not p_has_work(folder):
            continue
        out.append(name)
    return out


@typechecked
def recover_orphan_workspaces() -> List[Output]:
    """Re-register every recoverable orphan workspace and return the new rows.

    Imports load_all/save lazily: workspace_io imports cleanly, but keeping the dependency at call
    time means a failure in the store cannot break this module's import at boot."""
    from backend.apps.outputs.workspace_io import load_all, save

    try:
        known = {o.workspace_id for o in load_all() if o.workspace_id}
    except Exception:
        logger.exception("workspace recovery: could not read existing records; skipping")
        return []
    recovered: List[Output] = []
    for workspace_id in orphan_workspace_ids(known):
        try:
            now = datetime.now().isoformat()
            # "App" reads identically in en and pt-BR, so the fallback name ships no untranslated copy; the UI badges the row off `recovered`.
            output = Output(
                name=p_meta_name(os.path.join(OUTPUTS_WORKSPACE_DIR, workspace_id)) or f"App {workspace_id[:8]}",
                icon=RECOVERED_ICON,
                files={},
                workspace_id=workspace_id,
                recovered=True,
                created_at=now,
                updated_at=now,
            )
            save(output)
            recovered.append(output)
            logger.info("recovered app workspace %s with no record as output %s", workspace_id, output.id)
        except Exception:
            logger.exception("workspace recovery: could not re-register %s", workspace_id)
    return recovered
