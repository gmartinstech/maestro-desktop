"""Resolution of the app's dot-directories, with a one-time migration off the pre-rebrand `.openswarm` name.

Two distinct directories share the name and both predate the rebrand, so both get
the same migrate-on-first-touch treatment through one helper: `~/.maestro`
(user-global workspaces, caches, tool reports, spool) and `<workspace>/.maestro`
(per-app terminal.log and restart sentinel).
"""

import os
import shutil
import threading

from typeguard import typechecked

STATE_DIR_NAME = ".maestro"
LEGACY_STATE_DIR_NAME = ".openswarm"

p_migrate_lock = threading.Lock()


@typechecked
def p_merge_legacy_entries(legacy: str, current: str) -> None:
    """Move legacy entries into an already-populated new dir, never overwriting a name that exists there."""
    for name in os.listdir(legacy):
        dst = os.path.join(current, name)
        if os.path.exists(dst):
            continue
        src = os.path.join(legacy, name)
        try:
            os.replace(src, dst)
        except OSError:
            try:
                shutil.move(src, dst)
            except (OSError, shutil.Error):
                pass


@typechecked
def migrate_state_dir(parent: str) -> str:
    """Rename `<parent>/.openswarm` to `<parent>/.maestro` and return the new path.

    Safe when neither, either, or both exist: a populated `.maestro` is never
    clobbered (conflicting names stay behind in `.openswarm` rather than being
    lost), and every failure mode degrades to "the new path, empty"."""
    current = os.path.join(parent, STATE_DIR_NAME)
    legacy = os.path.join(parent, LEGACY_STATE_DIR_NAME)
    # Stat before taking the lock: the overwhelmingly common case is "no legacy dir", and that must not serialize callers.
    if not os.path.isdir(legacy):
        return current
    with p_migrate_lock:
        try:
            if not os.path.isdir(legacy):
                return current
            if not os.path.exists(current):
                os.replace(legacy, current)
            else:
                p_merge_legacy_entries(legacy, current)
                try:
                    os.rmdir(legacy)
                except OSError:
                    pass
        except OSError:
            pass
    return current


@typechecked
def state_dir(parent: str, *parts: str) -> str:
    """Path inside `<parent>/.maestro`, migrating a pre-rebrand `.openswarm` first."""
    return os.path.join(migrate_state_dir(parent), *parts)


@typechecked
def p_state_home() -> str:
    """`$MAESTRO_STATE_HOME` when set, else the real home. The override exists so an e2e run against
    a packaged build cannot write workspaces and caches into the developer's own `~/.maestro`."""
    override = (os.environ.get("MAESTRO_STATE_HOME") or "").strip()
    return os.path.abspath(os.path.expanduser(override)) if override else os.path.expanduser("~")


@typechecked
def home_state_dir(*parts: str) -> str:
    """Path inside `~/.maestro` (workspaces, caches, tool reports)."""
    return state_dir(p_state_home(), *parts)
