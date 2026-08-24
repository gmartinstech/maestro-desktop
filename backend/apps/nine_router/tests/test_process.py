"""is_running() negative-result caching: a genuinely down router must still be re-probed
quickly (short TTL), but repeated callers within that window share one probe instead of
each paying the full TCP+HTTP check."""

import time

import pytest
from unittest.mock import patch

from backend.apps.nine_router import process


@pytest.mark.asyncio
async def test_is_running_caches_negative_result_briefly():
    process.p_is_running_last_ok = 0.0
    process.p_is_running_last_checked = 0.0
    process.p_is_running_last_result = False
    with patch.object(process, "p_tcp_port_open", return_value=False) as mock_probe:
        first = await process.is_running()
        second = await process.is_running()
    assert first is False
    assert second is False
    assert mock_probe.call_count == 1


@pytest.mark.asyncio
async def test_is_running_negative_cache_expires():
    process.p_is_running_last_ok = 0.0
    process.p_is_running_last_checked = time.monotonic() - process.P_IS_RUNNING_NEGATIVE_TTL - 0.1
    process.p_is_running_last_result = False
    with patch.object(process, "p_tcp_port_open", return_value=False) as mock_probe:
        result = await process.is_running()
    assert result is False
    assert mock_probe.call_count == 1
