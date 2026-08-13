"""Boot-time recovery of app workspaces whose Output record was lost.

Without recover_workspaces these fail: a workspace with no record is unreachable from the UI even
though every file the user made is still on disk.
"""

import json
import os

import pytest

from backend.apps.outputs import recover_workspaces, workspace_io
from backend.apps.outputs.models import Output
from backend.apps.outputs.recover_workspaces import (
    orphan_workspace_ids,
    recover_orphan_workspaces,
    tombstone,
)


@pytest.fixture(autouse=True)
def p_isolated_store(tmp_path, monkeypatch):
    """Records and workspaces in throwaway dirs; both modules read their own module-level constant."""
    records = tmp_path / "outputs"
    workspaces = tmp_path / "outputs_workspace"
    records.mkdir()
    workspaces.mkdir()
    monkeypatch.setattr(workspace_io, "DATA_DIR", str(records))
    monkeypatch.setattr(recover_workspaces, "OUTPUTS_WORKSPACE_DIR", str(workspaces))
    yield workspaces


def p_make_workspace(root, workspace_id: str, *, with_work: bool = True, name: str = "") -> str:
    folder = os.path.join(str(root), workspace_id)
    os.makedirs(folder)
    if with_work:
        with open(os.path.join(folder, "run.sh"), "w", encoding="utf-8") as f:
            f.write("#!/bin/bash\necho hi\n")
    if name:
        with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as f:
            json.dump({"name": name}, f)
    return folder


def test_workspace_with_no_record_is_recovered(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-lost", name="Painel de Vendas")
    recovered = recover_orphan_workspaces()
    assert [o.workspace_id for o in recovered] == ["ws-lost"]
    assert recovered[0].name == "Painel de Vendas"
    # Reachable through the normal store read, which is what the UI lists.
    assert [o.workspace_id for o in workspace_io.load_all()] == ["ws-lost"]


def test_recovered_record_does_not_pretend_to_be_healthy(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-broken")
    output = recover_orphan_workspaces()[0]
    assert output.recovered is True
    # We do not know these, so we must not invent them.
    assert output.files == {}
    assert output.session_id is None
    assert output.icon == recover_workspaces.RECOVERED_ICON
    # No meta.json name, so the fallback must still be a usable, locale-neutral label.
    assert output.name.startswith("App ")


def test_a_deliberately_deleted_workspace_is_not_resurrected(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-deleted", name="Gone")
    tombstone("ws-deleted")
    assert orphan_workspace_ids(set()) == []
    assert recover_orphan_workspaces() == []


def test_a_workspace_that_still_has_its_record_is_left_alone(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-fine", name="Fine")
    workspace_io.save(Output(name="Fine", workspace_id="ws-fine"))
    assert recover_orphan_workspaces() == []
    assert len(workspace_io.load_all()) == 1


def test_an_empty_directory_is_not_advertised_as_an_app(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-husk", with_work=False)
    assert orphan_workspace_ids(set()) == []


def test_recovery_is_idempotent_across_boots(p_isolated_store):
    p_make_workspace(p_isolated_store, "ws-lost")
    first = recover_orphan_workspaces()
    second = recover_orphan_workspaces()
    assert len(first) == 1 and second == []
    assert len(workspace_io.load_all()) == 1
