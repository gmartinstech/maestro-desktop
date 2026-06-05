"""
Browser fast path: skip the orchestrator for plainly browser-only requests.

The orchestrator LLM is ~2/3 of the token bill on a single-browser task and
adds two model turns of latency, all to decide "delegate this to a browser
agent" and then restate the agent's own outcome. When the request is clearly
just browsing, dispatch the browser sub-agent directly and let its OUTCOME
line be the reply.

Three gates, all conservative; any miss falls through to the orchestrator:
1. eligibility: first message of an agent session on a dashboard, no
   attachments/images/skills/forced tools (those need the orchestrator).
2. a zero-cost wordlist prefilter, so non-browsy chats never pay the
   classifier's latency.
3. a cheap-tier aux YES/NO classifier (provider-agnostic, timeboxed); only
   an unambiguous YES takes the fast path.
"""

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# Zero-cost smell test: only prompts that mention the web at all are worth a
# classifier call. False negatives just take the normal path.
_BROWSY_RE = re.compile(
    r"https?://|www\.|\b[a-z0-9-]+\.(com|org|net|io|co|ai|dev|app)\b"
    r"|\b(browse|browser|website|web ?page|webpage|site|url|tab)\b"
    r"|\b(go to|open|visit|navigate|log ?in|sign ?in|search on|look up on|check on)\b"
    r"|\b(linkedin|twitter|x\.com|facebook|instagram|reddit|youtube|amazon|gmail|github"
    r"|google|wikipedia|hacker ?news|tiktok|tinder|slack|notion|ebay|etsy|zillow|airbnb)\b",
    re.I,
)

_CLASSIFIER_SYSTEM = (
    "You route requests to a web-browsing agent. It drives a real signed-in browser: "
    "navigating sites, reading or extracting or counting what is on pages, clicking, "
    "typing, and acting inside web apps (sending messages on LinkedIn or any site, "
    "posting, ordering, booking, filling forms).\n"
    "When a website or web app is the context, 'text/message/DM someone' means "
    "sending the message inside that site, which is browsing. Treat 'text' as SMS "
    "only when a phone number is given or no site is involved.\n"
    "Answer YES if browsing alone fully completes the request.\n"
    "Answer NO if any part clearly needs something a browser cannot do: local files "
    "or folders, writing or running code, a terminal, creating documents or "
    "spreadsheets, SMS to a phone number, or other desktop apps.\n"
    "Plain conversation or questions answerable without visiting any site: NO.\n"
    "Examples:\n"
    "'go to maya's linkedin and text her thanks' -> YES\n"
    "'open hacker news and tell me the top story' -> YES\n"
    "'find the report on stripe.com and save it to my desktop' -> NO\n"
    "'text 555-0102 that I'm late' -> NO\n"
    "Output exactly one word: YES or NO."
)


def fast_path_eligible(
    prompt: str,
    mode: str,
    dashboard_id: str | None,
    is_first_message: bool,
    has_attachments: bool,
) -> bool:
    """Pure gate: cheap, no I/O. Follow-ups are excluded because the sub-agent
    only receives the prompt text; the orchestrator carries the history a
    follow-up usually leans on."""
    if mode != "agent" or not dashboard_id or not is_first_message or has_attachments:
        return False
    if not prompt or not prompt.strip():
        return False
    return bool(_BROWSY_RE.search(prompt))


def _parse_verdict(text: str) -> bool:
    return text.strip().upper().startswith("YES")


def _normalize_for_classifier(prompt: str) -> str:
    """Haiku reads bare 'text him' as SMS even with a site as context. In the
    browsy-prefiltered pool, text-with-no-phone-number is in-site messaging,
    so spell it out for the small model. Only the classifier sees this."""
    if re.search(r"\d{7,}", prompt):
        return prompt
    return re.sub(r"\btext(ing|ed|s)?\b", "message", prompt, flags=re.I)


async def classify_browser_only(prompt: str, settings, primary_api: str | None) -> bool:
    """One cheap aux call, timeboxed; any failure means NO (normal path)."""
    try:
        from backend.apps.settings.credentials import get_anthropic_client_for_model
        from backend.apps.agents.providers.registry import resolve_aux_model

        aux_model, _ = await resolve_aux_model(
            settings, preferred_tier="haiku", primary_api=primary_api,
        )
        client = get_anthropic_client_for_model(settings, aux_model)
        resp = await asyncio.wait_for(
            client.messages.create(
                model=aux_model,
                max_tokens=4,
                temperature=0,
                system=_CLASSIFIER_SYSTEM,
                messages=[{"role": "user", "content": _normalize_for_classifier(prompt[:2000])}],
            ),
            timeout=5.0,
        )
        from backend.apps.agents.core.aux_llm import _safe_resp_text
        verdict = _parse_verdict(_safe_resp_text(resp))
        logger.info(f"[browser-fast-path] classifier: {'YES' if verdict else 'NO'}")
        return verdict
    except Exception as e:
        logger.warning(f"[browser-fast-path] classifier unavailable, normal path: {e}")
        return False
