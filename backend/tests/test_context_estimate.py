"""estimate_post_compact_input must measure the history that ACTUALLY ships.

The bug: the estimator summed raw len(content) over every surviving message, but
build_history_prefix clamps each tool result to RECAP_TOOL_RESULT_CAP (500 chars) and each
tool input to RECAP_TOOL_INPUT_CAP before the model ever sees it. A handful of large tool
results therefore reported ~50x the real cost. That number lands in session.tokens["input"],
which drives the UI context meter, maybe_compact's trigger ratio, AND pre_send_context_guard's
hard cap, which LRU-evicts the user's active MCP servers. So a normal tool-heavy session could
silently lose its MCPs to a phantom overflow.

Ground truth here is measured from build_history_prefix rather than hardcoded, so the test
cannot rot the same way the estimator did.
"""

from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.session.history_compaction import (
    DISTILLED_SUMMARY_BUDGET_TOKENS,
    HISTORY_TOKEN_SAFETY_MARGIN,
    build_history_prefix,
    estimate_post_compact_input,
    get_branch_messages,
    wrap_platform_note,
)


def p_tool_heavy_session(turns: int, result_chars: int = 40_000) -> AgentSession:
    """A session of `turns` user/tool_call/tool_result/assistant rounds, each carrying a huge tool result."""
    s = AgentSession(id="ctx-est", name="t", model="sonnet", mode="agent")
    msgs = []
    for i in range(turns):
        msgs.append(Message(id=f"u{i}", role="user", content=f"do task {i}"))
        msgs.append(Message(id=f"tc{i}", role="tool_call", content={"tool": "Bash", "input": {"command": "ls " + "x" * 300}}))
        msgs.append(Message(id=f"tr{i}", role="tool_result", content={"text": "R" * result_chars, "tool_name": "Bash", "elapsed_ms": 12}))
        msgs.append(Message(id=f"a{i}", role="assistant", content=f"done {i}"))
    s.messages = msgs
    s.framework_overhead_tokens = 0
    return s


def p_shipped_chars(session: AgentSession) -> int:
    """Ground truth: the exact prefix RunOptions injects into the prompt."""
    return len(build_history_prefix(
        get_branch_messages(session),
        cutoff_msg_id=session.compacted_through_msg_id,
    ))


def p_history_tokens(session: AgentSession) -> int:
    """What the estimator should charge for the recap alone."""
    return int(p_shipped_chars(session) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)


def test_estimate_tracks_real_shipped_history_on_tool_heavy_session() -> None:
    """The regression: pre-fix this ran ~50x over because it measured untrimmed tool results."""
    s = p_tool_heavy_session(turns=8)
    truth = p_shipped_chars(s) // 4
    est = estimate_post_compact_input(s)
    assert truth > 0
    # Never UNDER-count: this feeds a guard, so a low estimate would let a real overflow through.
    assert est >= truth, f"estimate {est} under-counts shipped history {truth}"
    assert est <= truth * 1.5, f"estimate {est} is {est / truth:.1f}x the real shipped history {truth}"


def test_estimate_does_not_phantom_overflow_the_mcp_eviction_guard() -> None:
    """20 tool-heavy turns must stay far under context_soft_cap_pct; pre-fix they blew past it and evicted MCPs."""
    s = p_tool_heavy_session(turns=20)
    hard_cap = int(s.context_window * s.context_soft_cap_pct)
    est = estimate_post_compact_input(s)
    assert est < hard_cap, f"estimate {est} trips the MCP-eviction cap {hard_cap} on a session shipping only {p_shipped_chars(s) // 4} tokens"


def test_estimate_excludes_messages_before_the_compaction_cutoff() -> None:
    messages = [Message(id=f"m{i}", role="user", content=("old" * 1000 if i < 6 else "keep")) for i in range(8)]
    s = AgentSession(id="x", name="t", model="sonnet", mode="agent")
    s.messages = messages
    s.compacted_through_msg_id = "m5"
    s.framework_overhead_tokens = 100
    # framework overhead + the reserved distiller budget + the two surviving "User: keep" lines.
    assert estimate_post_compact_input(s) == 100 + DISTILLED_SUMMARY_BUDGET_TOKENS + p_history_tokens(s)
    assert "old" not in build_history_prefix(get_branch_messages(s), cutoff_msg_id="m5")


def test_estimate_measures_a_cached_distilled_summary_instead_of_reserving_the_budget() -> None:
    s = p_tool_heavy_session(turns=6)
    s.compacted_through_msg_id = "a2"
    s.compacted_summary = "The user asked for X. " * 20
    s.compacted_summary_through = "a2"
    summary_tokens = int(len(wrap_platform_note(s.compacted_summary)) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)
    assert summary_tokens < DISTILLED_SUMMARY_BUDGET_TOKENS
    assert estimate_post_compact_input(s) == summary_tokens + p_history_tokens(s)


def test_estimate_reserves_the_distiller_budget_when_the_cached_summary_is_stale() -> None:
    """maybe_compact moves the cutoff, so a summary keyed to the OLD cutoff will be regenerated."""
    s = p_tool_heavy_session(turns=6)
    s.compacted_through_msg_id = "a3"
    s.compacted_summary = "stale summary"
    s.compacted_summary_through = "a1"
    assert estimate_post_compact_input(s) == DISTILLED_SUMMARY_BUDGET_TOKENS + p_history_tokens(s)
