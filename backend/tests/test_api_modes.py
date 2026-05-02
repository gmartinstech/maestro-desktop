"""CRUD smoke for /api/modes.

Modes are the per-agent system-prompt + tool-allowlist presets. The
five built-ins (`agent`, `ask`, `plan`, `view-builder`, `skill-builder`)
are seeded from `BUILTIN_MODES` on lifespan start; user-defined modes
live alongside them on disk under `MODES_DIR`.

Tests:
  - list returns the seeded built-ins
  - create/get/update/delete round-trip a custom mode
  - reset on a built-in restores defaults
  - delete on a built-in returns 403 (per the explicit guard in modes.py)
"""

from __future__ import annotations


BUILTIN_IDS = {"agent", "ask", "plan", "view-builder", "skill-builder"}


def test_list_returns_builtin_modes(client):
    resp = client.get("/api/modes/list")
    assert resp.status_code == 200
    payload = resp.json()
    assert "modes" in payload and "builtin_defaults" in payload

    seen_ids = {m["id"] for m in payload["modes"]}
    assert BUILTIN_IDS.issubset(seen_ids), (
        f"expected built-ins {BUILTIN_IDS}, saw {seen_ids}"
    )

    # builtin_defaults is the source of truth the frontend uses to
    # render "Reset to defaults" — must match exactly.
    assert set(payload["builtin_defaults"].keys()) == BUILTIN_IDS


def test_get_specific_builtin_mode(client):
    resp = client.get("/api/modes/agent")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "agent"
    assert body["is_builtin"] is True


def test_create_update_delete_custom_mode(client):
    create = client.post(
        "/api/modes/create",
        json={
            "name": "Test Mode",
            "description": "smoke",
            "system_prompt": "You are a test.",
            "tools": ["Read", "Grep"],
        },
    )
    assert create.status_code == 200, create.text
    mode_id = create.json()["mode"]["id"]
    assert mode_id not in BUILTIN_IDS

    fetched = client.get(f"/api/modes/{mode_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Test Mode"
    assert fetched.json()["is_builtin"] is False

    update = client.put(
        f"/api/modes/{mode_id}",
        json={"description": "smoke v2"},
    )
    assert update.status_code == 200
    assert update.json()["mode"]["description"] == "smoke v2"
    assert update.json()["mode"]["name"] == "Test Mode"  # unchanged

    deleted = client.delete(f"/api/modes/{mode_id}")
    assert deleted.status_code == 200

    gone = client.get(f"/api/modes/{mode_id}")
    assert gone.status_code == 404


def test_cannot_delete_builtin_mode(client):
    """Built-ins are sticky — a stray UI delete must not nuke them."""
    resp = client.delete("/api/modes/agent")
    assert resp.status_code == 403


def test_reset_builtin_mode_restores_defaults(client):
    """Mutate `agent` then reset; system_prompt should snap back."""
    update = client.put(
        "/api/modes/agent",
        json={"system_prompt": "MUTATED FOR TEST"},
    )
    assert update.status_code == 200
    assert update.json()["mode"]["system_prompt"] == "MUTATED FOR TEST"

    reset = client.post("/api/modes/agent/reset")
    assert reset.status_code == 200
    assert reset.json()["mode"]["system_prompt"] != "MUTATED FOR TEST"


def test_reset_only_works_on_builtins(client):
    """Custom (non-builtin) modes can't be reset — there's no default."""
    create = client.post("/api/modes/create", json={"name": "X"})
    mode_id = create.json()["mode"]["id"]

    resp = client.post(f"/api/modes/{mode_id}/reset")
    assert resp.status_code == 400
