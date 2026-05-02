"""Smoke tests for /api/tools.

Tools are MCP server definitions (stdio/HTTP/SSE) plus their connection
state. Built-ins (Read/Edit/Write/etc.) are defined statically in
`BUILTIN_TOOLS`; user-installed MCPs are persisted as JSON under
TOOLS_DIR.

OAuth flows + MCP discovery require external services and are out of
scope for this pass — see plan.

Tests:
  - GET /api/tools/builtin returns the static built-in list
  - GET /api/tools/list returns user-installed defs (empty by default)
  - GET/PUT /api/tools/builtin/permissions round-trips
  - create / get / update / delete CRUD
"""

from __future__ import annotations


def test_list_builtin_tools(client):
    """The static BUILTIN_TOOLS list — must include the always-loaded core."""
    resp = client.get("/api/tools/builtin")
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()["tools"]}
    # Sanity check on the core tools every agent gets by default.
    assert {"Read", "Edit", "Write", "Bash", "Grep", "Glob"}.issubset(names)


def test_list_user_tools_empty_by_default(client):
    resp = client.get("/api/tools/list")
    assert resp.status_code == 200
    assert resp.json() == {"tools": []}


def test_create_get_update_delete_tool(client):
    create = client.post(
        "/api/tools/create",
        json={
            "name": "TestMCP",
            "description": "smoke MCP server",
            "command": "echo hello",
            "mcp_config": {
                "type": "stdio",
                "command": "echo",
                "args": ["hello"],
            },
            "auth_type": "none",
            "auth_status": "none",
        },
    )
    assert create.status_code == 200, create.text
    tool_id = create.json()["tool"]["id"]
    assert tool_id

    fetched = client.get(f"/api/tools/{tool_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "TestMCP"

    update = client.put(
        f"/api/tools/{tool_id}",
        json={"description": "updated"},
    )
    assert update.status_code == 200
    assert update.json()["tool"]["description"] == "updated"
    assert update.json()["tool"]["name"] == "TestMCP"  # unchanged

    listed = client.get("/api/tools/list").json()["tools"]
    assert any(t["id"] == tool_id for t in listed)

    deleted = client.delete(f"/api/tools/{tool_id}")
    assert deleted.status_code == 200
    assert all(t["id"] != tool_id for t in client.get("/api/tools/list").json()["tools"])


def test_builtin_permissions_round_trip(client):
    """The user can override per-tool default permissions for built-ins.

    The PUT handler is allowlist-gated: only known tool names + valid
    policies (`always_allow`/`ask`/`deny`) survive the round-trip. The
    body shape is `{"permissions": {...}}` per `update_builtin_permissions`.
    """
    update = client.put(
        "/api/tools/builtin/permissions",
        json={"permissions": {"Bash": "ask"}},
    )
    assert update.status_code == 200

    refetched = client.get("/api/tools/builtin/permissions").json()["permissions"]
    assert refetched["Bash"] == "ask"


def test_builtin_permissions_rejects_unknown_tool_or_policy(client):
    """Garbage input is silently dropped, not 4xx'd. Verify it doesn't
    poison the persisted map."""
    resp = client.put(
        "/api/tools/builtin/permissions",
        json={"permissions": {
            "BogusTool": "ask",       # unknown tool name
            "Bash": "shrug",           # unknown policy
        }},
    )
    assert resp.status_code == 200
    perms = resp.json()["permissions"]
    assert "BogusTool" not in perms
    assert perms.get("Bash") != "shrug"
