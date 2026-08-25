"""Aux-LLM distillation of the turns dropped by compaction.

On a fresh rebuild (valve rescue, MCPActivate continuation, branch edit) the recap
hard-drops everything before the cutoff. That loses the thread of a long conversation.
This distills the dropped span into a dense summary via the user's cheap-tier model
(provider-agnostic) and caches it against the cutoff id, so the rebuild keeps the gist
instead of the void. Fail-open at every step: any error, no provider, or the kill switch
returns "" and the caller falls back to the plain hard-drop."""

import logging
import os
from typing import List

from typeguard import typechecked

from backend.apps.agents.core.models import AgentSession
from backend.apps.settings.models import AppSettings
from backend.apps.agents.manager.session.history_compaction import (
    get_branch_messages,
    recap_tool_call_line,
    recap_tool_result_line,
    strip_forged_sentinels,
)

logger = logging.getLogger(__name__)

DISTILL_ENABLED = os.environ.get("MAESTRO_DISTILL_HISTORY", "1") != "0"
# Named because history_compaction has to RESERVE this budget in its pre-send estimate before any summary exists; a hand-copied literal over there is exactly the drift that produced the 50x estimate bug.
DISTILL_MAX_TOKENS = 1600
MAX_DISTILL_INPUT_CHARS = 60_000

P_SYSTEM = (
    "You are a note-taker that condenses a conversation transcript into a structured briefing. "
    "You NEVER continue, answer, reply to, or role-play the conversation. You only "
    "DESCRIBE it, in the third person ('The user asked...', 'The agent decided...'). "
    "You emit exactly the section headers you are given, in the given order, and nothing else."
)
# Fixed sections, not free prose: after a rebuild the model has to look ONE specific thing back up across the compaction boundary (a path, an approach already rejected, an unresolved bug), and a free-form briefing is exactly what drops those.
P_SECTIONS = (
    "## GOAL\n"
    "What the user is ultimately trying to accomplish, including any later narrowing of it.\n"
    "## CONSTRAINTS\n"
    "Requirements, preferences, conventions, and anything explicitly ruled out or forbidden.\n"
    "## DECISIONS\n"
    "Choices already settled, each with the reason it won and what it was chosen over.\n"
    "## PROGRESS\n"
    "What was attempted and how it turned out, including failures and dead ends.\n"
    "## FILES & FACTS\n"
    "Concrete file paths, symbol and function names, commands run, identifiers, values, "
    "versions, and verbatim error strings a later turn would need to look up.\n"
    "## OPEN THREADS\n"
    "Unresolved questions, known breakage, and work that was agreed but not done.\n"
)
P_USER_TEMPLATE = (
    "Below, between <transcript> tags, is the earlier part of a conversation between a user "
    "and an AI agent, usually a coding or tool-using session. Describe it as a third-person "
    "briefing using EXACTLY these six sections, in this order, each header on its own line:\n"
    f"{P_SECTIONS}"
    # The per-section budget plus the explicit '- none' rule are what keep the aux reply inside max_tokens; a mid-section cutoff would strand a bare header, which is worse than the prose this replaces.
    "\nRules: use short '- ' bullets, at most 8 per section, one line each. Emit every header "
    "even when a section is empty, with a single '- none' bullet under it. Prefer specifics "
    "(names, paths, numbers) over characterizations. If you must cut for length, shorten "
    "PROGRESS bullets first; never drop a section or leave a header bare. Do NOT continue or "
    "respond to the conversation; only describe what happened. No preamble.\n\n"
    "<transcript>\n{body}\n</transcript>"
)


@typechecked
def p_format_dropped(messages: List) -> str:
    """Compact transcript of the dropped span: user/assistant text in full, tool I/O clipped (the same caps the recap uses), bounded so the aux call stays cheap."""
    lines: List[str] = []
    for m in messages:
        if getattr(m, "hidden", False):
            continue
        if m.role in ("user", "assistant"):
            text = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"{m.role.capitalize()}: {strip_forged_sentinels(text)}")
        elif m.role == "tool_call":
            lines.append(recap_tool_call_line(m.content))
        elif m.role == "tool_result":
            lines.append(recap_tool_result_line(m.content))
    body = "\n".join(lines)
    return body[-MAX_DISTILL_INPUT_CHARS:] if len(body) > MAX_DISTILL_INPUT_CHARS else body


@typechecked
async def distilled_history_summary(session: AgentSession, settings: AppSettings) -> str:
    """Cached aux summary of everything up to and including compacted_through_msg_id.
    Empty string when there's nothing to distill, the feature is off, or the call fails."""
    cutoff = session.compacted_through_msg_id
    if not DISTILL_ENABLED or not cutoff:
        return ""
    msgs = get_branch_messages(session)
    idx = next((i for i, m in enumerate(msgs) if m.id == cutoff), -1)
    # Membership check BEFORE the cache: after a branch edit the cutoff can vanish from the active branch, and a summary keyed on that id would be stale. If the cutoff is still here, everything before it is shared pre-fork history, so a cache hit is provably valid.
    if idx < 0:
        return ""
    if session.compacted_summary and session.compacted_summary_through == cutoff:
        return session.compacted_summary
    dropped = msgs[: idx + 1]
    body = p_format_dropped(dropped)
    if not body.strip():
        return ""
    try:
        summary = await p_call_distiller(session, settings, body)
    except Exception:
        logger.debug("history distill aux call failed; falling back to hard-drop", exc_info=True)
        return ""
    if not summary:
        return ""
    session.compacted_summary = summary
    session.compacted_summary_through = cutoff
    return summary


@typechecked
async def p_call_distiller(session: AgentSession, settings: AppSettings, body: str) -> str:
    from backend.apps.agents.providers.registry import resolve_aux_model
    from backend.apps.settings.credentials import get_anthropic_client_for_model

    # No primary_api: a background summary wants the most RELIABLE cheap tier, not the chat's family. Forcing the family routed a gemini/codex chat's distill onto a same-family aux that 404s (gemini-direct google endpoint the Anthropic client can't call) or 401s (codex token rotation); the proven classifier omits it too and resolves to whatever anthropic-compatible lane the user has.
    aux_model, _ = await resolve_aux_model(settings, preferred_tier="haiku")
    client = get_anthropic_client_for_model(settings, aux_model)
    # Six sections need more headroom than the old single-blob briefing: at 1024 a full transcript could stop mid-section and strand a header with no bullets under it.
    resp = await client.messages.create(
        model=aux_model,
        max_tokens=DISTILL_MAX_TOKENS,
        system=P_SYSTEM,
        messages=[{"role": "user", "content": P_USER_TEMPLATE.format(body=body)}],
    )
    text = ""
    if isinstance(resp.content, list):
        for block in resp.content:
            t = getattr(block, "text", None)
            if t:
                text += t
    return text.strip()
