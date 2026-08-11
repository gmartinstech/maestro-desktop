"""The `.openswarm` -> `.maestro` on-disk rename. Existing installs keep their
workspaces, warm caches and terminal.log across the upgrade, and an already-populated
`.maestro` is never clobbered by a stale legacy dir. Every call site resolves through
backend.config.state_paths, so these tests pin the one shared behaviour."""
import os

from backend.config.state_paths import (
    LEGACY_STATE_DIR_NAME,
    STATE_DIR_NAME,
    home_state_dir,
    migrate_state_dir,
    state_dir,
)


def p_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def p_read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_no_legacy_dir_is_a_noop(tmp_path):
    out = migrate_state_dir(str(tmp_path))
    assert out == os.path.join(str(tmp_path), STATE_DIR_NAME)
    assert not os.path.exists(out)


def test_legacy_dir_is_renamed_with_contents(tmp_path):
    legacy = tmp_path / LEGACY_STATE_DIR_NAME
    p_write(str(legacy / "terminal.log"), "boot ok")
    p_write(str(legacy / "workspaces" / "sess-1" / "app.py"), "print(1)")
    out = migrate_state_dir(str(tmp_path))
    assert out == str(tmp_path / STATE_DIR_NAME)
    assert p_read(os.path.join(out, "terminal.log")) == "boot ok"
    assert p_read(os.path.join(out, "workspaces", "sess-1", "app.py")) == "print(1)"
    assert not legacy.exists()


def test_both_dirs_present_merges_without_clobbering(tmp_path):
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "terminal.log"), "old")
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "cache" / "warm.txt"), "warm")
    p_write(str(tmp_path / STATE_DIR_NAME / "terminal.log"), "new")
    migrate_state_dir(str(tmp_path))
    current = tmp_path / STATE_DIR_NAME
    # The populated new dir wins on collisions; non-colliding legacy state still comes across.
    assert p_read(str(current / "terminal.log")) == "new"
    assert p_read(str(current / "cache" / "warm.txt")) == "warm"
    # The colliding entry is left behind rather than deleted, so nothing is destroyed.
    assert p_read(str(tmp_path / LEGACY_STATE_DIR_NAME / "terminal.log")) == "old"


def test_migration_is_idempotent(tmp_path):
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "terminal.log"), "boot ok")
    first = migrate_state_dir(str(tmp_path))
    second = migrate_state_dir(str(tmp_path))
    assert first == second
    assert p_read(os.path.join(second, "terminal.log")) == "boot ok"


def test_state_dir_joins_parts_and_migrates(tmp_path):
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "workspaces" / "s" / "keep"), "x")
    got = state_dir(str(tmp_path), "workspaces", "s", "keep")
    assert got == str(tmp_path / STATE_DIR_NAME / "workspaces" / "s" / "keep")
    assert p_read(got) == "x"


def test_home_state_dir_follows_expanduser(tmp_path, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "cache" / "skill_registry.json"), "{}")
    got = home_state_dir("cache", "skill_registry.json")
    assert got == str(tmp_path / STATE_DIR_NAME / "cache" / "skill_registry.json")
    assert p_read(got) == "{}"


def test_terminal_log_path_migrates_for_an_existing_workspace(tmp_path, monkeypatch):
    # The concrete upgrade case: a workspace created by the old build already has .openswarm/terminal.log, and the new runtime must resolve to the same bytes under .maestro.
    from backend.apps.outputs import runtime as p_runtime
    p_write(str(tmp_path / LEGACY_STATE_DIR_NAME / "terminal.log"), "previous run")
    rt = p_runtime.AppRuntime(workspace_id="ws-1", workspace_path=str(tmp_path))
    assert rt.p_terminal_log_path == str(tmp_path / STATE_DIR_NAME / "terminal.log")
    assert p_read(rt.p_terminal_log_path) == "previous run"
