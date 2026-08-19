"""antigravity_connected() negative/positive result caching: the underlying
probe is a sync httpx.get that can block up to 2s, so repeated callers within
the TTL window must share one probe instead of each re-paying it."""

import time

from unittest.mock import patch, MagicMock

from backend.apps.agents.providers import registry


def test_antigravity_connected_caches_result_briefly():
    registry.antigravity_last_checked = 0.0
    registry.antigravity_last_result = False
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"connections": [{"provider": "antigravity", "isActive": True}]}
    with patch("httpx.get", return_value=mock_response) as mock_get:
        first = registry.antigravity_connected()
        second = registry.antigravity_connected()
    assert first is True
    assert second is True
    assert mock_get.call_count == 1


def test_antigravity_connected_cache_expires():
    registry.antigravity_last_checked = time.monotonic() - registry.ANTIGRAVITY_CHECK_TTL - 0.1
    registry.antigravity_last_result = True
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"connections": []}
    with patch("httpx.get", return_value=mock_response) as mock_get:
        result = registry.antigravity_connected()
    assert result is False
    assert mock_get.call_count == 1


def test_resolve_model_id_for_sdk_shares_one_antigravity_probe_within_ttl():
    """Two calls to resolve_model_id_for_sdk() for the same AG-mapped Gemini
    short name within the TTL window must trigger only one underlying HTTP
    call, not one per turn."""
    from backend.apps.agents.providers.registry import resolve_model_id_for_sdk
    from backend.apps.settings.models import AppSettings
    registry.antigravity_last_checked = 0.0
    registry.antigravity_last_result = False
    settings = AppSettings()
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"connections": [{"provider": "antigravity", "isActive": True}]}
    with patch("httpx.get", return_value=mock_response) as mock_get:
        first = resolve_model_id_for_sdk("gemini-3.1-flash-lite", settings)
        second = resolve_model_id_for_sdk("gemini-3.1-flash-lite", settings)
    assert first == "ag/gemini-3-flash"
    assert second == "ag/gemini-3-flash"
    assert mock_get.call_count == 1
