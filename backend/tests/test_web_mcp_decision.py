"""Unit coverage for should_register_web_mcp: the decision of whether to register the
DDG-backed maestro-web MCP. Security/cost-relevant (it governs whether WebSearch cascades
through our own /api/web/search vs the native Anthropic path), so pin each provider case."""

import pytest
from unittest.mock import patch

from backend.apps.agents.tools.web import should_register_web_mcp


def p_call(**kw):
    base = dict(model="m", router_model_id="cc/opus", api_type="anthropic",
                anthropic_api_key=None)
    base.update(kw)
    with patch("backend.apps.agents.providers.registry.find_builtin_model", return_value=None):
        return should_register_web_mcp(**base)


def test_custom_session_always_registers():
    # ANTHROPIC_BASE_URL points at 9Router with no Claude connection -> native WebSearch 401s.
    assert p_call(api_type="custom") is True


def test_non_claude_primary_registers():
    # A Gemini/GPT primary has no native Anthropic web path.
    assert p_call(router_model_id="gemini/flash", api_type="google") is True


def test_subscription_route_claude_registers():
    # opus-4-8 on an own-key account: the aux haiku call 401s through 9Router, so a bare key isn't enough -> fall back to maestro-web.
    assert p_call(router_model_id="cc/opus", api_type="anthropic",
                 anthropic_api_key="sk-ant-xxx") is True


def test_direct_anthropic_api_route_uses_native_path():
    entry = {"route": "api", "api": "anthropic"}
    with patch("backend.apps.agents.providers.registry.find_builtin_model", return_value=entry):
        out = should_register_web_mcp(
            model="claude-x", router_model_id="claude-3-5-api", api_type="anthropic",
            anthropic_api_key="sk-ant-xxx",
        )
    assert out is False
