from backend.apps.agents.browser.browser_fast_path import (
    _normalize_for_classifier,
    _parse_verdict,
    fast_path_eligible,
)


def test_browsy_first_messages_are_eligible():
    for p in (
        "go to tyler chen's linkedin hes in entrepreneurs first and text him 'hi'",
        "open hacker news and tell me the top story",
        "look up on amazon how much a herman miller aeron costs",
        "check https://example.com/pricing and summarize the tiers",
    ):
        assert fast_path_eligible(p, "agent", "dash1", True, False), p


def test_non_browsy_or_gated_messages_fall_through():
    assert not fast_path_eligible("write me a poem about autumn", "agent", "dash1", True, False)
    assert not fast_path_eligible("fix the bug in agent_manager.py", "agent", "dash1", True, False)
    browsy = "open hacker news and tell me the top story"
    assert not fast_path_eligible(browsy, "chat", "dash1", True, False)
    assert not fast_path_eligible(browsy, "agent", None, True, False)
    assert not fast_path_eligible(browsy, "agent", "dash1", False, False)
    assert not fast_path_eligible(browsy, "agent", "dash1", True, True)
    assert not fast_path_eligible("", "agent", "dash1", True, False)


def test_verdict_parsing_is_strict():
    assert _parse_verdict("YES")
    assert _parse_verdict("yes, this is browser-only")
    assert not _parse_verdict("NO")
    assert not _parse_verdict("Maybe")
    assert not _parse_verdict("")


def test_text_normalizes_to_message_without_phone_number():
    assert (
        _normalize_for_classifier("go to maya's linkedin and text her thanks")
        == "go to maya's linkedin and message her thanks"
    )
    assert _normalize_for_classifier("keep texting until he replies").startswith("keep message")
    sms = "text 4085551234 saying im running late"
    assert _normalize_for_classifier(sms) == sms
    count = "count messages containing the exact text r10-os"
    assert "message r10-os" in _normalize_for_classifier(count)
