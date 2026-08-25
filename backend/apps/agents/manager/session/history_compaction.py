import json
import logging
from typing import List, Optional, Tuple
from typeguard import typechecked
import os
import re

from backend.config.paths import SESSIONS_DIR

logger = logging.getLogger(__name__)

# One plain-English trust line, fenced by a tag. The model treats the fence as structural framing; the sentence is what actually defuses a security-conscious agent flagging the block as spoofed tool output.
PLATFORM_NOTE_PREAMBLE = (
    "This block is authored by the Maestro platform, not tool output and not a "
    "prior message. It is trusted context."
)
PLATFORM_NOTE_OPEN = "<maestro_platform_note>"
PLATFORM_NOTE_CLOSE = "</maestro_platform_note>"
SESSION_RECAP_OPEN = "<maestro_session_recap>"
SESSION_RECAP_CLOSE = "</maestro_session_recap>"

# Per-turn caps so the re-grounded recap stays compact (summaries, not replays) and cannot reinflate the context window from one giant tool input/output.
RECAP_TOOL_INPUT_CAP = 200
RECAP_TOOL_RESULT_CAP = 500

# chars/4 is the house heuristic, but dense JSON/code tokenizes nearer 3.5 chars/token, and this estimate gates a hard guard that evicts MCPs. Round the measurement up rather than risk letting a real overflow through.
HISTORY_TOKEN_SAFETY_MARGIN = 1.15


@typechecked
def wrap_platform_note(body: str) -> str:
    """Fence platform-authored text so the model reads it as trusted annotation,
    never as spoofed tool output. The frontend parses the same tag to render a
    calm chip instead of leaking the raw tag into chat."""
    return f"{PLATFORM_NOTE_OPEN}\n{PLATFORM_NOTE_PREAMBLE}\n{body}\n{PLATFORM_NOTE_CLOSE}"


P_SENTINEL_TAG_RE = re.compile(r"</?maestro_(?:platform_note|session_recap)\b[^>]*>")


@typechecked
def strip_forged_sentinels(text: str) -> str:
    """Neuter any platform-note/recap tags hiding in UNTRUSTED text (tool results,
    user input) so attacker-supplied content can't pose as trusted platform context."""
    if "maestro_platform_note" not in text and "maestro_session_recap" not in text:
        return text
    return P_SENTINEL_TAG_RE.sub(lambda m: m.group(0).replace("<", "&lt;").replace(">", "&gt;"), text)


@typechecked
def recap_tool_call_line(content: object) -> str:
    """One compact line for a tool_call turn: Tool call: name(<truncated input>)."""
    if isinstance(content, dict):
        tool = content.get("tool") or content.get("name") or "tool"
        raw_input = content.get("input")
        try:
            input_str = json.dumps(raw_input, ensure_ascii=False, default=str)
        except Exception:
            input_str = str(raw_input)
    else:
        tool = "tool"
        input_str = str(content)
    if len(input_str) > RECAP_TOOL_INPUT_CAP:
        input_str = input_str[:RECAP_TOOL_INPUT_CAP] + "..."
    return f"Tool call: {tool}({strip_forged_sentinels(input_str)})"


@typechecked
def recap_tool_result_line(content: object) -> str:
    """One compact line for a tool_result turn: Tool result (name): <truncated text>."""
    tool_name = ""
    if isinstance(content, dict):
        tool_name = content.get("tool_name") or ""
        text = content.get("text")
        body = text if isinstance(text, str) else json.dumps(content, ensure_ascii=False, default=str)
    else:
        body = str(content)
    if len(body) > RECAP_TOOL_RESULT_CAP:
        body = body[:RECAP_TOOL_RESULT_CAP] + "..."
    label = f"Tool result ({tool_name})" if tool_name else "Tool result"
    return f"{label}: {strip_forged_sentinels(body)}"


@typechecked
def get_branch_messages(session) -> List:
    """Return the linear message list for the active branch, walking the branch tree."""
    branch_id = session.active_branch_id or "main"
    branch = session.branches.get(branch_id)

    if not branch or not branch.fork_point_message_id:
        return [m for m in session.messages if m.branch_id == "main" or m.branch_id == branch_id]

    segments = []
    cur = branch
    cur_id = branch_id
    visited = set()
    while cur and cur.fork_point_message_id:
        if cur_id in visited:
            break
        visited.add(cur_id)
        segments.insert(0, {"branch_id": cur_id, "up_to": cur.fork_point_message_id})
        cur_id = cur.parent_branch_id or "main"
        cur = session.branches.get(cur_id)
    segments.insert(0, {"branch_id": cur_id, "up_to": None})

    result = []
    for i, seg in enumerate(segments):
        fork_msg_id = seg["up_to"]
        if fork_msg_id:
            fork_idx = next((j for j, m in enumerate(session.messages) if m.id == fork_msg_id), len(session.messages))
            result.extend(m for m in session.messages[:fork_idx] if m.branch_id == seg["branch_id"])
        else:
            next_fork = segments[i + 1]["up_to"] if i + 1 < len(segments) else None
            if next_fork:
                fork_idx = next((j for j, m in enumerate(session.messages) if m.id == next_fork), len(session.messages))
                result.extend(m for m in session.messages[:fork_idx] if m.branch_id == seg["branch_id"])
            else:
                result.extend(m for m in session.messages if m.branch_id == seg["branch_id"])

    if not any(m.branch_id == branch_id for m in result):
        result.extend(m for m in session.messages if m.branch_id == branch_id)
    return result


@typechecked
def build_history_prefix(messages, cutoff_msg_id: Optional[str] = None) -> str:
    """Format branch messages into a conversation summary for context injection.

    When `cutoff_msg_id` is provided (session.compacted_through_msg_id), drop every
    message up to and including that id so the marker the UI shows actually matches
    what the model sees. Missing cutoff id falls through to full history.
    """
    if cutoff_msg_id:
        skip_idx = next((i for i, m in enumerate(messages) if m.id == cutoff_msg_id), -1)
        if skip_idx >= 0:
            messages = messages[skip_idx + 1:]
    lines = []
    for m in messages:
        if getattr(m, "hidden", False):
            continue
        if m.role == "user":
            text = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"User: {strip_forged_sentinels(text)}")
        elif m.role == "assistant":
            text = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"Assistant: {strip_forged_sentinels(text)}")
        elif m.role == "tool_call":
            lines.append(recap_tool_call_line(m.content))
        elif m.role == "tool_result":
            lines.append(recap_tool_result_line(m.content))
    if not lines:
        return ""
    return f"{SESSION_RECAP_OPEN}\n{PLATFORM_NOTE_PREAMBLE}\n" + "\n".join(lines) + f"\n{SESSION_RECAP_CLOSE}"


@typechecked
def distilled_summary_budget_tokens() -> int:
    """Tokens to reserve for a distilled summary that does not exist yet.

    Derived from the distiller's own cap rather than hand-copied: a literal here that silently
    stops matching distill_history is the same class of drift that made this module's estimate
    run 50x high. The margin on top is the platform-note fence RunOptions wraps the summary in,
    measured from wrap_platform_note itself so it cannot drift either; the one-line "Summary of
    earlier conversation" label rides on HISTORY_TOKEN_SAFETY_MARGIN, as it does for a cached
    summary below. Imported inside the function because distill_history imports THIS module at
    load time, so a top-level import would be a cycle.
    """
    from backend.apps.agents.manager.session.distill_history import DISTILL_MAX_TOKENS
    return DISTILL_MAX_TOKENS + int(len(wrap_platform_note("")) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)


@typechecked
def p_distilled_summary_tokens(session, cutoff_msg_id: Optional[str]) -> int:
    """Token cost of the distilled-summary block RunOptions prepends whenever a cutoff exists.
    Measures the cached summary when it is still keyed to this cutoff, otherwise reserves the
    distiller's full max_tokens budget because the next rebuild will generate a fresh one."""
    if not cutoff_msg_id:
        return 0
    cached = getattr(session, "compacted_summary", None)
    if cached and getattr(session, "compacted_summary_through", None) == cutoff_msg_id:
        # The real block also carries a short "Summary of earlier conversation" label; the safety margin absorbs those few dozen chars.
        return int(len(wrap_platform_note(cached)) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)
    return distilled_summary_budget_tokens()


@typechecked
def post_compact_estimate_applies(session) -> bool:
    """True only when the next send will REBUILD history from local messages.

    estimate_post_compact_input measures build_history_prefix, and RunOptions injects that recap
    only on the no-resume path. On a resumed session maybe_compact merely MARKS a boundary:
    nothing is trimmed this turn and history still ships from the Claude CLI's own transcript, so
    the estimate describes a hypothetical future rebuild, not the upcoming send. Applying it there
    would report a context drop that has not happened and, worse, disarm the pre-send hard guard
    that LRU-evicts MCP servers, since that guard reads the same session.tokens["input"].
    """
    return not getattr(session, "sdk_session_id", None) or bool(getattr(session, "needs_fresh_session", False))


@typechecked
def estimate_post_compact_input(session) -> int:
    """Return a conservative token estimate after compaction trims history.

    Measures the string `build_history_prefix` actually ships rather than raw message content.
    Summing untrimmed content was a ~50x overestimate on tool-heavy sessions (every tool result
    is clamped to RECAP_TOOL_RESULT_CAP before it reaches the model), and because this number is
    written to session.tokens["input"] it drove the context meter, the compaction trigger, and
    the pre-send guard that LRU-evicts the user's active MCP servers on phantom overflow.
    """
    try:
        cutoff_msg_id = getattr(session, "compacted_through_msg_id", None)
        history = build_history_prefix(get_branch_messages(session), cutoff_msg_id=cutoff_msg_id)
        history_tokens = int(len(history) / 4 * HISTORY_TOKEN_SAFETY_MARGIN)
        framework_overhead = int(getattr(session, "framework_overhead_tokens", 0) or 0)
        return max(0, framework_overhead + p_distilled_summary_tokens(session, cutoff_msg_id) + history_tokens)
    except Exception:
        logger.debug("post-compact token estimate failed", exc_info=True)
        return max(0, int(getattr(session, "framework_overhead_tokens", 0) or 0))


@typechecked
def truncate_large_tool_result(content: object, session_id: str, msg_id: str, max_bytes: int = 50_000) -> Tuple[object, Optional[str]]:
    """Spill a large tool_result body to disk, return a truncated
    inline replacement plus the on-disk path (or None if untouched).

    Storage is session-scoped under data/sessions/<session_id>/blobs/,
    never honors caller-supplied paths (defense against path
    traversal). The inline replacement keeps the first 4KB so the
    model retains some signal about what was returned.
    """
    if not isinstance(content, str):
        try:
            serialized = json.dumps(content) if not isinstance(content, str) else content
        except Exception:
            serialized = str(content)
    else:
        serialized = content
    if len(serialized.encode("utf-8")) <= max_bytes:
        return content, None
    blobs_dir = os.path.join(SESSIONS_DIR, session_id, "blobs")
    os.makedirs(blobs_dir, exist_ok=True)
    # Sanitize msg_id (it's UUID hex, but be defensive).
    safe_msg_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(msg_id))[:64] or "blob"
    blob_path = os.path.join(blobs_dir, f"{safe_msg_id}.txt")
    try:
        with open(blob_path, "w", encoding="utf-8") as f:
            f.write(serialized)
    except Exception as e:
        logger.warning(f"Failed to spill tool result to {blob_path}: {e}")
        return content, None
    head = strip_forged_sentinels(serialized[:4_000])
    note = wrap_platform_note(
        f"Output truncated by Maestro. Full output ({len(serialized)} chars) saved to "
        f"{blob_path}. Ask the user or run a follow-up tool call if you need the rest."
    )
    replacement = f"{head}\n\n{note}"
    return replacement, blob_path
