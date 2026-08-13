"""The browser sub-agent numbers interactive elements and acts on them by index. Those handles are
internal: text a human reads must describe elements by label and role, while the model's own copy of
the rows, and the action log used for replay, keep the numbers."""

from backend.apps.agents.browser import browser_human_text as HT
from backend.apps.agents.browser.browser_agent import summ_step
from backend.apps.agents.browser_agent_mcp_server import action_brief

# The exact shape handleListInteractives emits, header clause and all.
P_LIST_TEXT = (
    '4 interactive elements (* = new since your last look; same number = same element as before):\n'
    '[1]<link "Home">\n'
    '[2]*<textbox "Search" ctx="Header">\n'
    '[3]<button "Like" value="off">\n'
    '[44]<button "Send">\n'
    '(+12 more rows; call BrowserListInteractives for the full list)'
)


def p_bare_index_tokens(text: str) -> list:
    """Every leftover internal handle: a bracketed row number or a worded index reference."""
    return HT.BARE_REF_RE.findall(text) + HT.PROSE_REF_RE.findall(text)


def test_human_facing_list_has_no_bare_index_but_keeps_the_elements():
    human = HT.humanize(P_LIST_TEXT)
    assert p_bare_index_tokens(human) == [], f"an internal handle survived into: {human!r}"
    for label in ('link "Home"', 'textbox "Search" (in Header)', 'button "Like" = "off"', 'button "Send"'):
        assert label in human, f"{label} must still be described to the user"
    assert "same number = same element as before" not in human
    assert "call BrowserListInteractives" not in human, "tool-plumbing footers are not for humans"


def test_the_internal_action_path_still_resolves_an_index():
    """The whole point of the handles: the raw text must keep resolving to a clickable index."""
    from backend.apps.agents.browser.browser_agent import send_index_in_state
    assert send_index_in_state(P_LIST_TEXT) == (44, "Send")
    assert HT.element_labels(P_LIST_TEXT)[44] == 'button "Send"'
    assert send_index_in_state(HT.humanize(P_LIST_TEXT)) is None, "the humanized copy is display-only"


def test_narration_index_reference_becomes_the_element_it_names():
    labels = HT.element_labels(P_LIST_TEXT)
    assert HT.humanize("Clicked index 44 to deliver the message.", labels) == (
        'Clicked button "Send" to deliver the message.'
    )
    assert HT.humanize("Now clicking element 3.", labels) == 'Now clicking button "Like" = "off".'
    assert HT.humanize("Focused index 2 and typed the text in.", labels).startswith(
        'Focused textbox "Search" (in Header) and typed'
    )


def test_a_stale_reference_degrades_to_a_phrase_not_a_number():
    out = HT.humanize("I will retry element 99 next.", HT.element_labels(P_LIST_TEXT))
    assert out == "I will retry an element next."
    assert p_bare_index_tokens(out) == []


def test_page_text_is_not_mangled_by_the_humanizer():
    """Reads flow through the same boundary, so the rewrite must only touch our own row syntax."""
    page = "The #1 bestseller of 2026\nSee [citation] and rows 3-5 of the table."
    assert HT.humanize(page) == page


def test_action_log_entry_is_described_by_label_not_handle():
    labels = HT.element_labels(P_LIST_TEXT)
    assert HT.describe_action_entry({"tool": "BrowserClickIndex", "input": {"index": 44}}, labels) == 'button "Send"'
    assert HT.describe_action_entry({"tool": "BrowserClickIndex", "input": {"index": 44}}) == HT.UNKNOWN_ELEMENT
    assert HT.describe_action_entry(
        {"tool": "BrowserClickIndex", "input": {"index": 7}, "clicked_name": "Follow"}) == "Follow"
    assert HT.describe_action_entry(
        {"tool": "BrowserNavigate", "input": {"url": "https://example.com"}}) == "https://example.com"


def test_backend_action_log_line_names_the_element():
    labels = HT.element_labels(P_LIST_TEXT)
    assert summ_step("click_index", {"index": 44}, labels) == 'click(button "Send")'
    assert summ_step("click_index", {"index": 44}) == f"click({HT.UNKNOWN_ELEMENT})"
    assert summ_step("press_key", {"key": "Enter"}) == "key:Enter", "other steps are unchanged"


def test_parent_facing_report_never_prints_a_raw_index():
    """format_result's per-action rendering is what the parent agent relays to the user."""
    assert action_brief({"tool": "BrowserClickIndex", "input": {"index": 44}, "element": 'button "Send"'}) == 'button "Send"'
    brief = action_brief({"tool": "BrowserClickIndex", "input": {"index": 44, "text": "hi"}})
    assert "44" not in brief and "index" not in brief
    assert "hi" in brief, "the rest of the arguments still show"
    assert action_brief({"tool": "BrowserNavigate", "input": {"url": "https://example.com"}}) == (
        '{"url": "https://example.com"}'
    )
