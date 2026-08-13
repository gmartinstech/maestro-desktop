"""The presentation boundary between the browser sub-agent's internal element handles and text a
human reads.

The agent enumerates interactive elements as numbered rows (`[7]<button "Like">`) and acts on them
by index, so the indices MUST survive everywhere the model or the replay/skills machinery looks:
the tool_result blocks, the attached page state, and `action_log[].input`. They are meaningless to
a person, though, so every string that reaches a human, agent narration, the tool-result text the
dashboard renders, the summary handed back to the parent, passes through here first and comes out
describing elements by label and role instead.

Nothing in this module parses for behaviour; it only rewrites text for display.
"""

import re
from typing import Dict, Optional

from typeguard import typechecked

# `[7]*<button "Like" ctx="Header" value="on">`, the row shape handleListInteractives emits; the `*` marks "new since the last look", which is index bookkeeping and so is dropped for humans too.
P_ROW_RE = re.compile(r'^(?P<lead>\s*)\[(?P<index>\d+)\]\*?<(?P<body>[^>]*)>\s*$')
P_BODY_RE = re.compile(r'^\s*(?P<role>[^\s"]+)\s*(?:"(?P<name>[^"]*)")?(?P<rest>.*)$')
P_CTX_RE = re.compile(r'ctx="([^"]*)"')
P_VALUE_RE = re.compile(r'value="([^"]*)"')
# Prose the model (or our own nudges) writes about a handle: "element 7", "index 7", "[7]". `#7` is
# deliberately NOT matched: page text a read returns is humanized too, and "#1 bestseller" is not a handle.
PROSE_REF_RE = re.compile(r'\b(?:element|elemento|index|indice|índice)\s*#?\s*(\d+)\b', re.I)
BARE_REF_RE = re.compile(r'(?<![\w.])\[(\d+)\](?![\w.])')
# The exact index-bookkeeping clauses our own row formatters append; they only make sense next to the numbers we just removed. Kept literal rather than generic so arbitrary page text is never rewritten.
P_NUMBER_TALK = (
    (re.compile(r'\s*\(\* = new since your last look; same number = same element as before\)'), ''),
    (re.compile(r'\(all (\d+) element rows unchanged since your last look; same numbers still valid\)'),
     r'(all \1 elements unchanged since the last look)'),
    (re.compile(r'\(\+(\d+) rows unchanged since your last look; their numbers are still valid\)'),
     r'(+\1 elements unchanged since the last look)'),
    (re.compile(r'\(\+(\d+) more rows; call BrowserListInteractives for the full list\)'),
     r'(+\1 more elements not shown)'),
    (re.compile(r'\(same number = same element as before\)'), ''),
)
UNKNOWN_ELEMENT = "an element"


@typechecked
def p_row_label(body: str) -> str:
    """`button "Like" ctx="Header"` -> `button "Like" (in Header)`, the human half of a row."""
    m = P_BODY_RE.match(body)
    if not m:
        return body.strip()
    role = (m.group("role") or "").strip()
    name = (m.group("name") or "").strip()
    rest = m.group("rest") or ""
    label = f'{role} "{name}"' if name else role
    ctx = P_CTX_RE.search(rest)
    if ctx and ctx.group(1).strip():
        label += f" (in {ctx.group(1).strip()})"
    value = P_VALUE_RE.search(rest)
    if value and value.group(1).strip():
        label += f' = "{value.group(1).strip()}"'
    return label


@typechecked
def element_labels(text: str) -> Dict[int, str]:
    """Harvest index -> human label from any text carrying element rows, so a later prose reference
    to that handle can be translated instead of merely blanked. Dynamic keys, hence a plain dict."""
    labels: Dict[int, str] = {}
    for line in str(text or "").splitlines():
        m = P_ROW_RE.match(line)
        if m:
            labels[int(m.group("index"))] = p_row_label(m.group("body"))
    return labels


@typechecked
def strip_row_indices(text: str) -> str:
    """Rewrite element rows as bulleted descriptions and drop the index bookkeeping around them."""
    out: list = []
    for line in str(text or "").splitlines():
        m = P_ROW_RE.match(line)
        if not m:
            for pattern, repl in P_NUMBER_TALK:
                line = pattern.sub(repl, line)
            out.append(line)
            continue
        out.append(f"{m.group('lead')}- {p_row_label(m.group('body'))}")
    return "\n".join(out)


@typechecked
def humanize_index_refs(text: str, labels: Optional[Dict[int, str]] = None) -> str:
    """Translate a prose handle reference into the element it names, or into a neutral phrase when
    that index is no longer in the label map (a stale reference is still not worth showing raw)."""
    known = labels or {}

    def p_sub(m: "re.Match[str]") -> str:
        return known.get(int(m.group(1)), UNKNOWN_ELEMENT)

    return BARE_REF_RE.sub(p_sub, PROSE_REF_RE.sub(p_sub, str(text or "")))


@typechecked
def humanize(text: str, labels: Optional[Dict[int, str]] = None) -> str:
    """The one call every human-facing browser string goes through: rows become descriptions, and any
    leftover prose reference to a numbered handle becomes the element it points at."""
    if not text:
        return str(text or "")
    merged: Dict[int, str] = dict(element_labels(text))
    if labels:
        for idx, label in labels.items():
            merged.setdefault(idx, label)
    return humanize_index_refs(strip_row_indices(text), merged)


@typechecked
def describe_action_entry(entry: Dict[str, object], labels: Optional[Dict[int, str]] = None) -> str:
    """Human phrase for one action_log entry, for the places the log is rendered for a reader rather
    than replayed. The entry's `input` keeps its raw index for replay and skill distillation; only
    this rendering hides it, preferring the label resolved at action time, then what the page
    reported was actually clicked, then whatever human-meaningful argument the tool carried."""
    known = labels or {}
    action_input = entry.get("input")
    action_input = action_input if isinstance(action_input, dict) else {}
    for key in ("element", "clicked_name"):
        val = entry.get(key)
        if val:
            return str(val)[:120]
    idx = action_input.get("index")
    if isinstance(idx, int):
        return known.get(idx, UNKNOWN_ELEMENT)
    for key in ("name", "selector", "url", "key", "text", "instruction", "filename", "direction"):
        val = action_input.get(key)
        if val:
            return str(val)[:120]
    return str(entry.get("tool") or "?")
