"""Unit tests for the API-first write registry: routing, receipt extraction, and the fail-safe
(any adapter failure becomes a typed ok=False so the agent can fall back to the UI path, never a
crash). Network is mocked; the live end-to-end proof is in PROTOCOL_apifirst.md."""
import pytest

from backend.apps.agents.browser import site_write_registry as reg


def test_has_api_write_knows_reddit_and_rejects_unknown():
    assert reg.has_api_write("reddit.com", "comment") is True
    assert reg.has_api_write("REDDIT.COM", "delete") is True          # case + normalization
    assert reg.has_api_write("reddit.com", "wire_money") is False     # unknown action
    assert reg.has_api_write("example.com", "comment") is False       # no adapter


def test_receipt_prefers_permalink_then_url_then_id():
    assert reg.receipt_str({"permalink": "/r/x/c/1", "id": "t1_9"}) == "/r/x/c/1"
    assert reg.receipt_str({"url": "https://x/p", "id": "t3_9"}) == "https://x/p"
    assert reg.receipt_str({"id": "t1_9"}) == "t1_9"
    assert reg.receipt_str({}) == "ok"


@pytest.mark.asyncio
async def test_api_write_routes_and_returns_typed_receipt(monkeypatch):
    monkeypatch.setattr(reg, "p_ensure_session_env", lambda: None)
    monkeypatch.setattr(reg.reddit_writes, "comment",
                        lambda parent_id, text: {"id": "t1_abc", "permalink": "/r/test/comments/x/_/t1_abc"})
    r = await reg.api_write("reddit.com", "comment", {"parent_id": "t3_x", "text": "hi"})
    assert r.ok is True
    assert r.receipt == "/r/test/comments/x/_/t1_abc"
    assert r.action == "comment" and r.domain == "reddit.com"


@pytest.mark.asyncio
async def test_api_write_unknown_domain_is_typed_miss_not_crash(monkeypatch):
    r = await reg.api_write("nosuchsite.com", "comment", {"text": "hi"})
    assert r.ok is False
    assert "no API-first adapter" in r.error


@pytest.mark.asyncio
async def test_api_write_adapter_failure_is_caught_as_typed_error(monkeypatch):
    monkeypatch.setattr(reg, "p_ensure_session_env", lambda: None)
    def boom(parent_id, text):
        raise reg.reddit_writes.RedditError("RATELIMIT: try later")
    monkeypatch.setattr(reg.reddit_writes, "comment", boom)
    r = await reg.api_write("reddit.com", "comment", {"parent_id": "t3_x", "text": "hi"})
    assert r.ok is False
    assert "RATELIMIT" in r.error          # site's own error surfaced, no crash


@pytest.mark.asyncio
async def test_api_write_missing_required_param_is_typed_error(monkeypatch):
    monkeypatch.setattr(reg, "p_ensure_session_env", lambda: None)
    monkeypatch.setattr(reg.reddit_writes, "comment", lambda parent_id, text: {"id": "t1_x"})
    r = await reg.api_write("reddit.com", "comment", {"text": "no parent id"})  # missing parent_id
    assert r.ok is False and r.error            # KeyError -> typed miss, not a crash
