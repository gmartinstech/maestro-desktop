"""Unit coverage for the extracted per-turn system-prompt assembly. Pins that the base prompt
is composed, the current-time block is always pinned, and view-builder mode appends the live
App Builder skill. The context builders are mocked to None so the test is deterministic and
doesn't depend on dashboard/tool disk state."""

import pytest
from unittest.mock import patch

from backend.apps.agents.core.models import AgentSession
from backend.apps.agents.manager.prompt import compose_turn_system_prompt as sp


def p_compose(session: AgentSession):
    with patch.object(sp, "build_browser_context", return_value=None), \
         patch.object(sp, "build_mcp_registry_summary", return_value=None), \
         patch.object(sp, "build_selected_app_context", return_value=None), \
         patch.object(sp, "build_selected_settings_context", return_value=None):
        return sp.compose_turn_system_prompt(
            session, mode_sys_prompt=None, default_system_prompt="You are a helpful agent.",
            selected_browser_ids=None, selected_app_output_ids=None, selected_setting_ids=None,
        )


def test_base_composition_includes_default_and_time_pin():
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    out = p_compose(session)
    assert "You are a helpful agent." in out
    assert "<current_time>" in out  # the wall-clock pin is always appended


def test_view_builder_appends_live_skill_block():
    session = AgentSession(name="t", model="sonnet", dashboard_id="d", mode="view-builder")
    with patch("backend.apps.outputs.view_builder_templates.load_app_builder_skill", return_value="SKILL BODY"):
        out = p_compose(session)
    assert "<app_builder_reference>" in out
    assert "SKILL BODY" in out


def test_selected_app_context_is_appended_when_present():
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    with patch.object(sp, "build_browser_context", return_value=None), \
         patch.object(sp, "build_mcp_registry_summary", return_value=None), \
         patch.object(sp, "build_selected_app_context", return_value="<picked_app>/x</picked_app>"), \
         patch.object(sp, "build_selected_settings_context", return_value=None):
        out = sp.compose_turn_system_prompt(
            session, mode_sys_prompt=None, default_system_prompt="base",
            selected_browser_ids=None, selected_app_output_ids=["app-1"], selected_setting_ids=None,
        )
    assert "<picked_app>/x</picked_app>" in out


def p_compose_with_language(language, default_system_prompt="You are a helpful agent."):
    """Compose a turn prompt with the settings language pinned, bypassing the settings file."""
    from backend.apps.settings.models import AppSettings
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    settings = AppSettings(language=language)
    with patch.object(sp, "build_browser_context", return_value=None), \
         patch.object(sp, "build_mcp_registry_summary", return_value=None), \
         patch.object(sp, "build_selected_app_context", return_value=None), \
         patch.object(sp, "build_selected_settings_context", return_value=None), \
         patch("backend.apps.settings.store.load_settings", return_value=settings):
        return sp.compose_turn_system_prompt(
            session, mode_sys_prompt=None, default_system_prompt=default_system_prompt,
            selected_browser_ids=None, selected_app_output_ids=None, selected_setting_ids=None,
        )


@pytest.mark.parametrize("language", ["pt-BR", None])
def test_language_directive_is_portuguese_for_ptbr_and_for_unset(language):
    # None is a fresh install, whose UI is already pt-BR, so the prompt must not fall back to English.
    out = p_compose_with_language(language)
    assert "<language_directive>" in out
    assert "português do Brasil" in out


def test_language_directive_is_english_only_when_explicitly_chosen():
    out = p_compose_with_language("en")
    assert "<language_directive>" in out
    assert "português do Brasil" not in out


def test_ptbr_swaps_the_untouched_default_prompt_for_its_translation():
    from backend.apps.settings.models import DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_PT_BR
    out = p_compose_with_language("pt-BR", default_system_prompt=DEFAULT_SYSTEM_PROMPT)
    assert DEFAULT_SYSTEM_PROMPT_PT_BR in out
    assert DEFAULT_SYSTEM_PROMPT not in out


def test_a_user_written_prompt_survives_verbatim_in_portuguese():
    # The default prompt is user-editable, so translating it would silently discard their text.
    out = p_compose_with_language("pt-BR", default_system_prompt="MY OWN PROMPT")
    assert "MY OWN PROMPT" in out


def test_unreadable_settings_do_not_break_a_turn():
    from backend.apps.settings.models import AppSettings
    session = AgentSession(name="t", model="sonnet", dashboard_id="d")
    with patch.object(sp, "build_browser_context", return_value=None), \
         patch.object(sp, "build_mcp_registry_summary", return_value=None), \
         patch.object(sp, "build_selected_app_context", return_value=None), \
         patch.object(sp, "build_selected_settings_context", return_value=None), \
         patch("backend.apps.settings.store.load_settings", side_effect=OSError("disk gone")):
        out = sp.compose_turn_system_prompt(
            session, mode_sys_prompt=None, default_system_prompt="base",
            selected_browser_ids=None, selected_app_output_ids=None, selected_setting_ids=None,
        )
    assert "base" in out
    assert "português do Brasil" in out
    assert isinstance(AppSettings().language, type(None))
