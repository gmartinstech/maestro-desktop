"""Smoke tests for /api/skills.

Skills are SKILL.md files synced into `~/.claude/skills`. Tests MUST
NEVER touch the user's real skills dir, so this whole module relies on
the `patched_skills_dir` fixture.

Tests:
  - empty list on a fresh dir
  - dropping a SKILL.md into the patched dir surfaces in /list
  - create / get / update / delete round-trip
  - workspace/seed writes SKILL.md and meta.json
"""

from __future__ import annotations

import json
import os


def test_list_empty_on_fresh_dir(client, patched_skills_dir):
    resp = client.get("/api/skills/list")
    assert resp.status_code == 200
    assert resp.json() == {"skills": []}


def test_list_picks_up_dropped_skill(client, patched_skills_dir):
    """Filesystem-driven discovery — dropping a .md file is enough."""
    skill_path = os.path.join(patched_skills_dir, "test-skill.md")
    with open(skill_path, "w") as f:
        f.write("# Test Skill\n\nBody content.\n")

    resp = client.get("/api/skills/list")
    assert resp.status_code == 200
    skills = resp.json()["skills"]
    assert any(s["id"] == "test-skill" for s in skills)


def test_create_get_update_delete_skill(client, patched_skills_dir):
    create = client.post(
        "/api/skills/create",
        json={
            "name": "Smoke",
            "description": "smoke skill",
            "content": "---\nname: smoke\ndescription: a smoke skill\n---\n\nBody.",
        },
    )
    assert create.status_code == 200, create.text
    skill_id = create.json()["skill"]["id"]

    fetched = client.get(f"/api/skills/{skill_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Smoke"

    update = client.put(
        f"/api/skills/{skill_id}",
        json={"description": "smoke v2"},
    )
    assert update.status_code == 200
    assert update.json()["skill"]["description"] == "smoke v2"

    deleted = client.delete(f"/api/skills/{skill_id}")
    assert deleted.status_code == 200
    assert not os.path.exists(os.path.join(patched_skills_dir, f"{skill_id}.md"))


def test_workspace_seed_writes_files(client, patched_skills_dir):
    """seed_skill_workspace writes SKILL.md + meta.json under
    SKILLS_WORKSPACE_DIR (patched at import time via OPENSWARM_DATA_DIR)."""
    from backend.config.paths import SKILLS_WORKSPACE_DIR

    workspace_id = "test-workspace"
    resp = client.post(
        "/api/skills/workspace/seed",
        json={
            "workspace_id": workspace_id,
            "skill_content": "---\nname: x\n---\nbody",
            "meta": {"name": "X", "description": "y"},
        },
    )
    assert resp.status_code == 200

    folder = os.path.join(SKILLS_WORKSPACE_DIR, workspace_id)
    assert os.path.isfile(os.path.join(folder, "SKILL.md"))

    with open(os.path.join(folder, "meta.json")) as f:
        meta = json.load(f)
    assert meta["name"] == "X"
