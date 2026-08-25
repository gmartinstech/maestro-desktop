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

from typing import List, Optional, Tuple

import pytest

from backend.apps.agents.core.models import AgentSession, Message
from backend.apps.agents.manager.session.history_compaction import (
    HISTORY_TOKEN_SAFETY_MARGIN,
    build_history_prefix,
    distilled_summary_budget_tokens,
    estimate_post_compact_input,
    get_branch_messages,
    post_compact_estimate_applies,
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
    assert estimate_post_compact_input(s) == 100 + distilled_summary_budget_tokens() + p_history_tokens(s)
    assert "old" not in build_history_prefix(get_branch_messages(s), cutoff_msg_id="m5")


def test_estimate_measures_a_cached_distilled_summary_instead_of_reserving_the_budget() -> None:
    s = p_tool_heavy_session(turns=6)
    s.compacted_through_msg_id = "a2"
    s.compacted_summary = "The user asked for X. " * 20
    s.compacted_summary_through = "a2"
    summary_tokens = int(len(wrap_platform_note(s.compacted_summary)) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)
    assert summary_tokens < distilled_summary_budget_tokens()
    assert estimate_post_compact_input(s) == summary_tokens + p_history_tokens(s)


def test_estimate_reserves_the_distiller_budget_when_the_cached_summary_is_stale() -> None:
    """maybe_compact moves the cutoff, so a summary keyed to the OLD cutoff will be regenerated."""
    s = p_tool_heavy_session(turns=6)
    s.compacted_through_msg_id = "a3"
    s.compacted_summary = "stale summary"
    s.compacted_summary_through = "a1"
    assert estimate_post_compact_input(s) == distilled_summary_budget_tokens() + p_history_tokens(s)


def test_distiller_budget_is_derived_from_the_distillers_own_cap() -> None:
    """The reserve must FOLLOW distill_history's max_tokens, not re-state it.

    A literal copied across files is what produced the 50x estimate this module already had to
    fix, so the coupling is asserted rather than trusted: raising the distiller's cap has to move
    the reserve by the same amount, with only the fixed platform-note fence between them.
    """
    from backend.apps.agents.manager.session import distill_history

    fence_tokens = distilled_summary_budget_tokens() - distill_history.DISTILL_MAX_TOKENS
    assert 0 < fence_tokens < 200, f"reserve is {fence_tokens} tokens off the distiller cap, which is not a fence-sized margin"
    p_original = distill_history.DISTILL_MAX_TOKENS
    try:
        # distill-structured-checkpoint raises this to 1600 for its six-section summary; the reserve must follow with no edit here.
        distill_history.DISTILL_MAX_TOKENS = 1600
        assert distilled_summary_budget_tokens() == 1600 + fence_tokens
    finally:
        distill_history.DISTILL_MAX_TOKENS = p_original


# --- scoping: the estimate only describes a send that actually REBUILDS history ---
# estimate_post_compact_input measures build_history_prefix, but RunOptions injects that recap only
# on the no-resume path (RunOptions.py's `elif len(session.messages) > 1:`). On a resumed session
# maybe_compact merely MARKS a cutoff, nothing is trimmed that turn, and history still ships from
# the CLI's own transcript. Applying the estimate there both lies to the meter and hands the
# MCP-eviction guard a number far under real usage.


def p_over_cap_session(sdk_session_id: Optional[str], real_input: int = 185_000) -> AgentSession:
    """A long tool-heavy session whose last REAL measurement sits over the hard eviction cap.

    context_window 200_000 x context_soft_cap_pct 0.90 = a 180_000 cap, so 185_000 must reach the
    LRU trim. 185_000/200_000 also clears maybe_compact's 0.65 trigger, which is the whole trap:
    the mark fires on the same turn the guard needs the real number.
    """
    s = p_tool_heavy_session(turns=20)
    s.sdk_session_id = sdk_session_id
    s.tokens = {"input": real_input, "output": 2_000}
    s.framework_overhead_tokens = 28_000
    s.active_mcps = ["github", "notion", "slack"]
    return s


async def p_run_guard(session: AgentSession, monkeypatch) -> List[Tuple[str, dict]]:
    """Drive the real pre_send_context_guard against a real AgentManager, capturing WS traffic."""
    from backend.apps.agents.agent_manager import AgentManager
    from backend.apps.agents.manager.run import run_options_helpers

    sent: List[Tuple[str, dict]] = []

    async def p_fake_send(session_id, event, payload):
        sent.append((event, payload))

    # ws_manager is a module-level singleton, so patching the instance covers context_budget too.
    monkeypatch.setattr(run_options_helpers.ws_manager, "send_to_session", p_fake_send)
    await run_options_helpers.pre_send_context_guard(AgentManager(), session, session.id)
    return sent


@pytest.mark.asyncio
async def test_resumed_session_keeps_its_real_measurement_and_still_evicts_mcps(monkeypatch) -> None:
    """The hole: a real 185,000-token resume was overwritten by a ~29,000 estimate of a rebuild
    that is not happening this turn, so the hard guard never fired and the MCPs survived an
    overflow they exist to prevent."""
    s = p_over_cap_session(sdk_session_id="sdk-abc")
    assert not s.needs_fresh_session
    hard_cap = int(s.context_window * s.context_soft_cap_pct)
    assert estimate_post_compact_input(s) < hard_cap, "probe is pointless unless the estimate would disarm the guard"

    sent = await p_run_guard(s, monkeypatch)

    assert s.compacted_through_msg_id, "maybe_compact must still mark the boundary for the next rebuild"
    assert s.tokens["input"] == 185_000, "meter dropped although nothing was trimmed this turn"
    assert s.active_mcps == ["notion", "slack"], "the oldest MCP must be evicted on a real 185,000-token overflow"
    assert s.needs_fork is True
    assert [p for e, p in sent if p.get("reason") == "trimmed"], "no eviction breadcrumb was emitted"


@pytest.mark.asyncio
async def test_resumed_session_rebroadcasts_the_retained_measurement(monkeypatch) -> None:
    """Under the cap the mark is harmless, but the meter still must not drop.

    The frontend's recordCompaction reducer zeroes every context field on the "compacted" status,
    so the guard has to re-send the retained number; silence would leave the UI reading 0 until
    the turn ends.
    """
    s = p_over_cap_session(sdk_session_id="sdk-abc", real_input=140_000)

    sent = await p_run_guard(s, monkeypatch)

    assert s.tokens["input"] == 140_000
    assert s.active_mcps == ["github", "notion", "slack"], "140,000 is under the 180,000 cap; nothing may be evicted"
    updates = [p for e, p in sent if e == "agent:context_update"]
    assert updates and updates[-1]["input_tokens"] == 140_000, "the retained measurement was not re-broadcast"


@pytest.mark.asyncio
async def test_fresh_rebuild_session_still_gets_the_corrected_estimate(monkeypatch) -> None:
    """No sdk_session_id means RunOptions really does inject build_history_prefix, so the estimate
    describes the actual next send and must replace the stale pre-compaction number."""
    s = p_over_cap_session(sdk_session_id=None)

    await p_run_guard(s, monkeypatch)

    assert s.tokens["input"] == estimate_post_compact_input(s)
    assert s.tokens["input"] < 185_000, "a genuine rebuild does shrink the send; the meter must follow it down"
    assert s.active_mcps == ["github", "notion", "slack"], "a genuine rebuild must not evict MCPs"


@pytest.mark.asyncio
async def test_compact_endpoint_still_applies_the_estimate(monkeypatch) -> None:
    """/compact sets needs_fresh_session, so its rebuild IS the next send and the estimate holds.
    Drives the real endpoint so the ordering (mark -> needs_fresh_session -> estimate) is pinned."""
    from backend.apps.agents import agents as p_agents

    s = p_over_cap_session(sdk_session_id="sdk-abc")
    sent: List[Tuple[str, dict]] = []

    async def p_fake_send(session_id, event, payload):
        sent.append((event, payload))

    monkeypatch.setattr(p_agents.ws_manager, "send_to_session", p_fake_send)
    monkeypatch.setitem(p_agents.agent_manager.sessions, s.id, s)

    result = await p_agents.compact_session(s.id)

    assert result["compacted"] is True
    assert s.needs_fresh_session is True, "/compact is the user paying for a real rebuild"
    assert post_compact_estimate_applies(s) is True
    assert s.tokens["input"] == estimate_post_compact_input(s) < 185_000


def test_post_compact_estimate_applies_only_to_a_rebuild() -> None:
    s = AgentSession(id="x", name="t", model="sonnet", mode="agent")
    assert post_compact_estimate_applies(s) is True, "no SDK conversation yet, so history is rebuilt locally"
    s.sdk_session_id = "sdk-abc"
    assert post_compact_estimate_applies(s) is False, "resumed: history ships from the CLI transcript"
    s.needs_fresh_session = True
    assert post_compact_estimate_applies(s) is True, "/compact drops the resume and rebuilds"
