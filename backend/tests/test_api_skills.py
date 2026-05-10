"""Smoke tests for /api/skills.

Skills live under `~/.claude/skills/<slug>/SKILL.md` — the layout the
Claude Code CLI auto-discovers (verified against the bundled CLI's path
parser, which expects exactly four segments ending in `SKILL.md`). Tests
MUST NEVER touch the user's real skills dir, so this whole module relies
on the `patched_skills_dir` fixture.

Tests:
  - empty list on a fresh dir
  - dropping a `<slug>/SKILL.md` into the patched dir surfaces in /list
  - create / get / update / delete round-trip
  - frontmatter is stamped on create even when the body has none
  - flat-file legacy layout migrates into the directory layout on startup
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
    """Filesystem-driven discovery — dropping a `<slug>/SKILL.md` is enough."""
    skill_dir = os.path.join(patched_skills_dir, "test-skill")
    os.makedirs(skill_dir)
    skill_path = os.path.join(skill_dir, "SKILL.md")
    with open(skill_path, "w") as f:
        f.write("---\nname: Test Skill\ndescription: a test\n---\n\nBody.\n")

    resp = client.get("/api/skills/list")
    assert resp.status_code == 200
    skills = resp.json()["skills"]
    assert any(s["id"] == "test-skill" for s in skills)


def test_list_ignores_legacy_flat_files(client, patched_skills_dir):
    """A stray `<slug>.md` at the top level isn't a discoverable skill —
    the CLI requires the directory layout, so we mirror that."""
    flat = os.path.join(patched_skills_dir, "stray.md")
    with open(flat, "w") as f:
        f.write("body without a home")

    resp = client.get("/api/skills/list")
    assert resp.status_code == 200
    assert resp.json() == {"skills": []}


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

    skill_md = os.path.join(patched_skills_dir, skill_id, "SKILL.md")
    assert os.path.isfile(skill_md), f"expected SKILL.md at {skill_md}"

    fetched = client.get(f"/api/skills/{skill_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Smoke"

    update = client.put(
        f"/api/skills/{skill_id}",
        json={"description": "smoke v2"},
    )
    assert update.status_code == 200
    assert update.json()["skill"]["description"] == "smoke v2"

    with open(skill_md, encoding="utf-8") as f:
        on_disk = f.read()
    assert "description: smoke v2" in on_disk, (
        "metadata-only update should patch SKILL.md frontmatter so the CLI "
        "listing stays in sync"
    )

    deleted = client.delete(f"/api/skills/{skill_id}")
    assert deleted.status_code == 200
    assert not os.path.exists(os.path.join(patched_skills_dir, skill_id))


def test_create_stamps_frontmatter_when_body_has_none(client, patched_skills_dir):
    """Without frontmatter the CLI silently drops a skill from the listing,
    so the create endpoint MUST emit a YAML block even if the caller sent
    a plain Markdown body."""
    create = client.post(
        "/api/skills/create",
        json={
            "name": "Bare",
            "description": "no fm in body",
            "content": "Just a body, no frontmatter.\n",
        },
    )
    assert create.status_code == 200, create.text
    skill_id = create.json()["skill"]["id"]
    skill_md = os.path.join(patched_skills_dir, skill_id, "SKILL.md")

    with open(skill_md, encoding="utf-8") as f:
        on_disk = f.read()
    assert on_disk.startswith("---\n")
    assert "name: Bare" in on_disk
    assert "description: no fm in body" in on_disk
    assert "Just a body, no frontmatter." in on_disk


def test_inline_frontmatter_edits_in_body_are_honored(client, patched_skills_dir):
    """Editing the `---` block inside the content textarea must stick when
    the caller doesn't separately override via the form fields.

    Previously `update_skill` always stamped the file with `meta`'s
    pre-existing name/description, silently discarding the user's inline
    YAML edits. New precedence: explicit form field > inline frontmatter
    > previous index value. This test exercises the inline-only path.
    """
    create = client.post(
        "/api/skills/create",
        json={"name": "Original", "description": "old desc", "content": "body"},
    )
    assert create.status_code == 200, create.text
    skill_id = create.json()["skill"]["id"]

    new_body = (
        "---\n"
        "name: EditedInline\n"
        "description: edited inline\n"
        "---\n\n"
        "fresh body\n"
    )
    resp = client.put(f"/api/skills/{skill_id}", json={"content": new_body})
    assert resp.status_code == 200, resp.text

    listed = client.get("/api/skills/list").json()["skills"]
    surfaced = next(s for s in listed if s["id"] == skill_id)
    assert surfaced["name"] == "EditedInline", (
        "inline frontmatter `name:` must beat stale index value when the "
        "PUT body doesn't include an explicit `name` field"
    )
    assert surfaced["description"] == "edited inline"


def test_form_name_still_beats_inline_frontmatter(client, patched_skills_dir):
    """The opposite direction of the precedence rule: when the caller
    sends BOTH an explicit `name` form field AND inline frontmatter, the
    form field wins. This is the typical frontend save flow."""
    create = client.post(
        "/api/skills/create",
        json={"name": "Original", "description": "old", "content": "body"},
    )
    skill_id = create.json()["skill"]["id"]

    conflicting_body = (
        "---\n"
        "name: FromInline\n"
        "description: from inline\n"
        "---\n\n"
        "body\n"
    )
    resp = client.put(
        f"/api/skills/{skill_id}",
        json={"name": "FromForm", "content": conflicting_body},
    )
    assert resp.status_code == 200

    listed = client.get("/api/skills/list").json()["skills"]
    surfaced = next(s for s in listed if s["id"] == skill_id)
    assert surfaced["name"] == "FromForm", (
        "explicit form `name` must beat inline frontmatter when both "
        "are supplied"
    )
    # description wasn't on the form, so inline wins
    assert surfaced["description"] == "from inline"


def test_frontmatter_roundtrips_special_characters(client, patched_skills_dir):
    """A description with embedded quotes / colons / hashes must survive
    arbitrary save-load-save cycles unchanged. The previous parser blindly
    stripped one pair of outer quotes without un-escaping `\\"`, so each
    save accumulated more backslashes until the description was a wall of
    `\\\\\\\\\\"`. Regression test for that bug.
    """
    tricky = 'has "quotes": and # hash'
    create = client.post(
        "/api/skills/create",
        json={"name": "Tricky", "description": tricky, "content": "body\n"},
    )
    assert create.status_code == 200, create.text
    skill_id = create.json()["skill"]["id"]

    # Three metadata-only saves: every one re-stamps frontmatter, so a
    # lossy decoder would compound the damage. The list endpoint reads
    # the description back from disk via the frontmatter parser.
    for _ in range(3):
        resp = client.put(f"/api/skills/{skill_id}", json={"description": tricky})
        assert resp.status_code == 200

    listed = client.get("/api/skills/list").json()["skills"]
    surfaced = next(s for s in listed if s["id"] == skill_id)
    assert surfaced["description"] == tricky, (
        "description with quotes/colons/hash must round-trip exactly across "
        "successive saves; lossy parser would accumulate backslashes"
    )


def test_migration_moves_flat_file_into_directory(patched_skills_dir, monkeypatch):
    """Pre-existing `<slug>.md` files (from before the directory-layout
    migration) must be relocated to `<slug>/SKILL.md` exactly once at
    startup so the CLI's discovery picks them up."""
    from backend.apps.skills import skills as skills_mod

    flat = os.path.join(patched_skills_dir, "legacy.md")
    with open(flat, "w") as f:
        f.write("# Legacy\n\nbody.")
    skills_mod._save_index({"legacy": {"name": "Legacy", "description": "old"}})

    skills_mod._migrate_flat_to_dir_layout()

    assert not os.path.exists(flat), "flat file should be removed after migration"
    new_path = os.path.join(patched_skills_dir, "legacy", "SKILL.md")
    assert os.path.isfile(new_path), f"expected migrated SKILL.md at {new_path}"
    with open(new_path, encoding="utf-8") as f:
        migrated = f.read()
    assert migrated.startswith("---\n"), "migration should stamp frontmatter"
    assert "name: Legacy" in migrated
    assert "description: old" in migrated
    assert "body." in migrated

    # Idempotent: a second run must not crash or duplicate work.
    skills_mod._migrate_flat_to_dir_layout()
    assert os.path.isfile(new_path)


def test_migration_preserves_existing_directory(patched_skills_dir):
    """If a directory already exists for a slug, the flat file is removed
    (the dir wins) — never overwritten."""
    from backend.apps.skills import skills as skills_mod

    skill_dir = os.path.join(patched_skills_dir, "shared")
    os.makedirs(skill_dir)
    canonical = os.path.join(skill_dir, "SKILL.md")
    with open(canonical, "w") as f:
        f.write("---\nname: shared\n---\n\ncanonical body")
    flat = os.path.join(patched_skills_dir, "shared.md")
    with open(flat, "w") as f:
        f.write("legacy body that should not win")

    skills_mod._migrate_flat_to_dir_layout()

    assert not os.path.exists(flat)
    with open(canonical, encoding="utf-8") as f:
        assert "canonical body" in f.read()


def test_installed_slugs_cache_avoids_rescanning(patched_skills_dir, monkeypatch):
    """`get_installed_slugs` must hit the filesystem on the first call,
    then serve subsequent calls from cache without re-walking SKILLS_DIR.
    The agent loop calls this on every turn, so a per-turn rescan would
    cost N*T syscalls in the hot path for N skills * T turns."""
    from backend.apps.skills import skills as skills_mod

    skill_dir = os.path.join(patched_skills_dir, "alpha")
    os.makedirs(skill_dir)
    with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
        f.write("---\nname: alpha\n---\n")

    real_listdir = os.listdir
    call_count = {"n": 0}

    def counting_listdir(path):
        if os.path.abspath(path) == os.path.abspath(patched_skills_dir):
            call_count["n"] += 1
        return real_listdir(path)

    monkeypatch.setattr(skills_mod.os, "listdir", counting_listdir)
    skills_mod._invalidate_installed_slugs_cache()

    assert skills_mod.get_installed_slugs() == ["alpha"]
    first = call_count["n"]
    assert first == 1, "first call must rescan"

    for _ in range(5):
        assert skills_mod.get_installed_slugs() == ["alpha"]
    assert call_count["n"] == first, (
        "subsequent calls must be served from cache without re-listing "
        "SKILLS_DIR"
    )


def test_installed_slugs_cache_invalidated_on_create(client, patched_skills_dir):
    """Creating a skill via /api/skills/create must invalidate the cache
    so the next allowlist query reflects the new slug. Without this the
    next agent turn would silently fail to expose the freshly-installed
    skill to the model."""
    from backend.apps.skills import skills as skills_mod

    assert skills_mod.get_installed_slugs() == []

    resp = client.post(
        "/api/skills/create",
        json={
            "name": "FreshSkill",
            "description": "test",
            "content": "body",
        },
    )
    assert resp.status_code == 200
    skill_id = resp.json()["skill"]["id"]

    assert skill_id in skills_mod.get_installed_slugs(), (
        "newly-created slug should appear without an explicit "
        "cache-bust call from the test"
    )


def test_installed_slugs_cache_invalidated_on_delete(client, patched_skills_dir):
    """Deleting a skill must invalidate the cache so the slug drops out
    of the next allowlist query. Otherwise the agent would keep being
    told about a skill the user just removed, and a `Skill(slug)` call
    would fail in the CLI with a confusing 'skill not found' error."""
    from backend.apps.skills import skills as skills_mod

    client.post(
        "/api/skills/create",
        json={"name": "Doomed", "description": "x", "content": "body"},
    )
    assert "doomed" in skills_mod.get_installed_slugs()

    resp = client.delete("/api/skills/doomed")
    assert resp.status_code == 200
    assert "doomed" not in skills_mod.get_installed_slugs(), (
        "deleted slug must drop out of the cached list immediately"
    )


def test_installed_slugs_cache_keyed_by_skills_dir(monkeypatch, tmp_path):
    """The cache is keyed by SKILLS_DIR so a test that monkeypatches
    that dir gets a fresh scan automatically — important because pytest
    re-uses the same module-scoped cache across all tests, and we don't
    want test A's skills bleeding into test B's view."""
    from backend.apps.skills import skills as skills_mod

    dir_a = tmp_path / "a"
    dir_a.mkdir()
    (dir_a / "only-in-a").mkdir()
    (dir_a / "only-in-a" / "SKILL.md").write_text("---\nname: a\n---\n")

    dir_b = tmp_path / "b"
    dir_b.mkdir()
    (dir_b / "only-in-b").mkdir()
    (dir_b / "only-in-b" / "SKILL.md").write_text("---\nname: b\n---\n")

    monkeypatch.setattr(skills_mod, "SKILLS_DIR", str(dir_a))
    skills_mod._invalidate_installed_slugs_cache()
    assert skills_mod.get_installed_slugs() == ["only-in-a"]

    monkeypatch.setattr(skills_mod, "SKILLS_DIR", str(dir_b))
    assert skills_mod.get_installed_slugs() == ["only-in-b"], (
        "switching SKILLS_DIR must implicitly invalidate the cache "
        "without an explicit bust"
    )


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
