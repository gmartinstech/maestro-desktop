"""Cap the cumulative text of a FastMCP call_tool return so one Gmail/Drive dump can't
blow the model's context. Pure + stdlib-only (no upstream imports) so it's importable
and unit-testable outside the shim's ephemeral uv env.

The bundled Claude CLI hard-rejects any MCP result over ~25K tokens and spills it to a
file, which the model then re-reads back in, refilling the context and tripping the CLI's
autocompact-thrash. Capping under that spill threshold keeps the result inline and the
model out of the re-read loop."""

from typing import Any

MAX_RESULT_CHARS = 48_000
P_TRUNCATION_NOTE = (
    "\n\n[Truncated: this tool returned more than {cap} characters, too much to fit "
    "in context at once. Narrow the request (add a search filter, a date range, or a "
    "smaller max_results / page size) or fetch the next page.]"
)


def cap_tool_result(result: Any, max_chars: int = MAX_RESULT_CHARS) -> Any:
    """Cap the text content blocks of a call_tool return in place. Duck-typed and
    fail-open: any shape we don't recognize passes through unchanged, so an upstream
    contract change degrades to no-cap, never a crash."""
    try:
        blocks = result[0] if isinstance(result, tuple) else result
        if not isinstance(blocks, list):
            return result
        used = 0
        truncated = False
        for b in blocks:
            if getattr(b, "type", None) != "text" or getattr(b, "text", None) is None:
                continue
            if truncated:
                b.text = ""
                continue
            text = b.text
            if used + len(text) <= max_chars:
                used += len(text)
                continue
            b.text = text[: max(0, max_chars - used)] + P_TRUNCATION_NOTE.format(cap=max_chars)
            truncated = True
        return result
    except Exception:
        return result
