"""Onboarding v3 sub-app: identity summary, consented local scan, starter prep.

Mounted at /api/onboarding. All three endpoints are read-only with respect to
the user's machine and providers; nothing here mutates state or leaves the box
except the prep call, which goes to the user's own configured model.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from typeguard import typechecked

from backend.apps.onboarding.identity import build_identity
from backend.apps.onboarding.local_scan import run_local_scan
from backend.apps.onboarding.models import PrepRequest
from backend.apps.onboarding.prep import build_prep
from backend.config.Apps import SubApp


@asynccontextmanager
async def onboarding_lifespan():
    yield


onboarding = SubApp("onboarding", onboarding_lifespan)


@onboarding.router.get("/identity")
@typechecked
async def get_identity() -> dict:
    # Disk rows, not the router's HTTP /providers: only db.json carries idToken/email, and it stays readable while the router is down.
    from backend.apps.nine_router.process import read_persisted_connections

    return build_identity(read_persisted_connections()).model_dump()


@onboarding.router.post("/scan")
@typechecked
def post_scan() -> dict:
    return run_local_scan(Path.home()).model_dump()


@onboarding.router.post("/prep")
@typechecked
async def post_prep(body: PrepRequest) -> dict:
    from backend.apps.onboarding.usage.chatgpt_usage import harvest_chatgpt_usage
    from backend.apps.onboarding.usage.claude_usage import harvest_claude_usage
    from backend.apps.settings.store import load_settings

    # The frontend read needs a logged-in provider CARD, which a fresh install lacks. Fill the gap from what we already have: ChatGPT via the codex connect token, Claude via the user's own browser session cookies. Each fails open to "", so a missing one just drops out.
    if not body.usage_summary.strip():
        parts: list[str] = []
        chatgpt = await harvest_chatgpt_usage()
        if chatgpt:
            parts.append("ChatGPT usage:\n" + chatgpt)
        claude = await harvest_claude_usage()
        if claude:
            parts.append("Claude usage:\n" + claude)
        if parts:
            body.usage_summary = "\n\n".join(parts)

    return (await build_prep(load_settings(), body)).model_dump()
