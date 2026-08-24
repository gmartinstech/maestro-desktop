"""Guards against the accidental-disconnect class in the 9Router mirror sync: the orphan sweep
must never mass-reap managed nodes off an EMPTY provider list (a corrupt/defaulted settings load
at boot hands it []), while a NON-empty list still reaps exactly the removed provider and never
touches cp-openai (the Jul-3 'No credentials' regression)."""

import asyncio
import json
from typing import Dict, List, Optional

import backend.apps.nine_router.sync_custom as sc


class FakeResponse:
    def __init__(self, status_code: int, payload: Optional[Dict] = None):
        self.status_code = status_code
        self.text = json.dumps(payload or {})
        self.p_payload = payload or {}

    def json(self) -> Dict:
        return self.p_payload


class FakeAsyncClient:
    """Records every HTTP call; serves the provider-nodes list from the harness."""

    def __init__(self, harness: "Harness", **kwargs):
        self.harness = harness

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def get(self, url: str, **kw) -> FakeResponse:
        self.harness.calls.append(("GET", url))
        if url.endswith("/provider-nodes"):
            return FakeResponse(200, {"nodes": self.harness.nodes})
        if url.endswith("/providers"):
            return FakeResponse(200, {"connections": []})
        return FakeResponse(404)

    async def post(self, url: str, json: Optional[Dict] = None, **kw) -> FakeResponse:
        self.harness.calls.append(("POST", url))
        if url.endswith("/provider-nodes"):
            return FakeResponse(200, {"node": {"id": "new-node-id"}})
        return FakeResponse(200, {})

    async def put(self, url: str, json: Optional[Dict] = None, **kw) -> FakeResponse:
        self.harness.calls.append(("PUT", url))
        return FakeResponse(200, {})

    async def patch(self, url: str, json: Optional[Dict] = None, **kw) -> FakeResponse:
        self.harness.calls.append(("PATCH", url))
        return FakeResponse(200, {})

    async def delete(self, url: str, **kw) -> FakeResponse:
        self.harness.calls.append(("DELETE", url))
        return FakeResponse(200, {})


class Harness:
    def __init__(self, nodes: List[Dict]):
        self.nodes = nodes
        self.calls: List = []

    def deletes(self) -> List[str]:
        return [u for m, u in self.calls if m == "DELETE"]


class FakeNr:
    def __init__(self, harness: Harness):
        self.harness = harness
        h = self

        class P_Httpx:
            def AsyncClient(self, **kwargs) -> FakeAsyncClient:
                return FakeAsyncClient(h.harness)

        self.httpx = P_Httpx()

    async def is_running(self) -> bool:
        return True


def managed(prefix: str) -> Dict:
    return {"id": f"id-{prefix}", "prefix": prefix, "name": f"{prefix}{sc.NINE_ROUTER_CUSTOM_NAME_SUFFIX}"}


def setup(monkeypatch, nodes: List[Dict]) -> Harness:
    harness = Harness(nodes)
    monkeypatch.setattr(sc, "nr", lambda: FakeNr(harness))
    monkeypatch.setattr(sc, "cli_auth_headers", lambda: {})
    monkeypatch.setattr(sc, "find_keyed_connection", p_no_connection)
    return harness


async def p_no_connection(node_id: str, name: str) -> None:
    return None


def test_empty_list_never_sweeps(monkeypatch):
    """Corrupt/defaulted settings at boot pass []; every managed node must survive."""
    harness = setup(monkeypatch, [managed("cp-ollama"), managed("cp-together"), managed(sc.NINE_ROUTER_OPENAI_KEYED_PREFIX)])
    asyncio.run(sc.sync_custom_providers([]))
    assert harness.deletes() == []


def test_nonempty_list_reaps_only_removed(monkeypatch):
    """A real one-provider settings list still reaps the genuinely removed node, keeps the kept one, and never touches cp-openai."""
    harness = setup(monkeypatch, [managed("cp-ollama"), managed("cp-together"), managed(sc.NINE_ROUTER_OPENAI_KEYED_PREFIX)])
    asyncio.run(sc.sync_custom_providers([{"name": "ollama", "base_url": "http://localhost:11434/v1", "api_key": "k"}]))
    deleted_ids = [u.split("/")[-1] for u in harness.deletes()]
    assert deleted_ids == ["id-cp-together"]
    assert f"id-{sc.NINE_ROUTER_OPENAI_KEYED_PREFIX}" not in deleted_ids


def test_a_rotated_key_is_pushed_with_a_method_the_router_accepts(monkeypatch):
    """9Router answers PATCH /providers/<id> with 405. The old code sent PATCH and ignored the
    response, so a refreshed Keycloak token never reached the router: the connection kept the bearer
    it was created with and every call failed "[401]: jwt expired" long after settings looked fine."""
    async def p_existing_connection(node_id: str, name: str):
        return {"id": "conn-1"}

    harness = setup(monkeypatch, [managed("cp-maestro")])
    monkeypatch.setattr(sc, "find_keyed_connection", p_existing_connection)
    asyncio.run(sc.sync_custom_providers([{"name": "Maestro", "base_url": "https://llm.martinstech.net/v1", "api_key": "rotated-key"}]))
    assert not any(m == "PATCH" for m, _ in harness.calls), "PATCH is 405 on this endpoint"
    assert any(m == "PUT" and u.endswith("/providers/conn-1") for m, u in harness.calls), \
        f"the rotated key must be PUT to the existing connection; calls={harness.calls}"


def test_a_prefix_held_by_an_older_builds_node_is_adopted_not_duplicated(monkeypatch):
    """The prefix is 9Router's routing key, so two nodes holding one is a coin flip over which
    baseUrl serves a request. An upgrade left "maestro (OpenSwarm-managed)" on plain http:// under
    cp-maestro; matching only our own name suffix missed it, so we POSTed a rival with the same
    prefix, the stale one kept winning, and every call came back "[404]: unknown route"."""
    stale = {"id": "id-stale", "prefix": "cp-maestro", "name": "maestro (OpenSwarm-managed)"}
    harness = setup(monkeypatch, [stale])
    asyncio.run(sc.sync_custom_providers([{"name": "Maestro", "base_url": "https://llm.martinstech.net/v1", "api_key": "k"}]))
    posts = [u for m, u in harness.calls if m == "POST" and u.endswith("/provider-nodes")]
    assert posts == [], "adopt the node already holding the prefix instead of creating a second one"
    assert any(m == "PUT" and u.endswith("/provider-nodes/id-stale") for m, u in harness.calls), \
        "the stale node must be updated in place (renamed, baseUrl corrected)"


def test_a_duplicate_prefix_left_behind_is_removed(monkeypatch):
    """Both records already exist (the shape a partially-upgraded install is in): keep one and delete
    the rival, or requests keep landing on whichever one 9Router happens to pick."""
    stale = {"id": "id-stale", "prefix": "cp-maestro", "name": "maestro (OpenSwarm-managed)"}
    harness = setup(monkeypatch, [managed("cp-maestro"), stale])
    asyncio.run(sc.sync_custom_providers([{"name": "Maestro", "base_url": "https://llm.martinstech.net/v1", "api_key": "k"}]))
    deleted = [u.split("/")[-1] for u in harness.deletes()]
    assert "id-stale" in deleted, f"the rival on the same prefix must go; deleted={deleted}"
    assert "id-cp-maestro" not in deleted, "our own node must survive"
