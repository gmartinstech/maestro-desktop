"""swarm-analytics client singleton for the desktop backend.

One client per process. Bootstraps an install token on first use (persisted to
settings) and reuses it forever. All failures are swallowed: analytics must
never break the app. See ANALYTICS_OVERVIEW.md for the SDK contract.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from swarm_analytics import AnalyticsClient

logger = logging.getLogger(__name__)

P_CLIENT: Optional[AnalyticsClient] = None


def p_base_url() -> str:
    # The analytics service must NOT share the desktop backend's port (8324).
    # Default points at the local analytics service; override per environment.
    return os.environ.get("OPENSWARM_ANALYTICS_URL", "http://127.0.0.1:6792").rstrip("/")


def p_mode() -> str:
    """Map the existing opt-out toggle onto the SDK mode.

    logs.write is the 'diagnostic' category, so it flows even in 'minimal';
    only 'product' events are muted. analytics_opt_in is the single toggle in
    AppSettings, so opted-out -> 'minimal', otherwise 'full'.
    """
    try:
        from backend.apps.settings.store import load_settings
        s = load_settings()
        if not getattr(s, "analytics_opt_in", True):
            return "minimal"
    except Exception:
        pass
    return "full"


def get_analytics_client() -> Optional[AnalyticsClient]:
    """Lazily bootstrap + cache the client. Returns None if setup fails
    (e.g. offline first run) so callers can no-op safely."""
    global P_CLIENT
    if P_CLIENT is not None:
        return P_CLIENT
    try:
        from backend.apps.settings.store import load_settings, save_settings
        s = load_settings()
        install_id = getattr(s, "installation_id", None)
        if not install_id:
            return None  # main.py mints this pre-bind; bail defensively
        base_url = p_base_url()
        token = getattr(s, "analytics_token", None)
        if not token:
            token = AnalyticsClient.register(base_url=base_url, install_id=install_id)
            s.analytics_token = token
            save_settings(s)
        P_CLIENT = AnalyticsClient(base_url=base_url, token=token, mode=p_mode())
    except Exception as e:
        logger.debug("analytics setup failed (non-critical): %s", e)
        return None
    return P_CLIENT


def shutdown_analytics() -> None:
    global P_CLIENT
    if P_CLIENT is not None:
        try:
            P_CLIENT.flush(timeout=2.0)
            P_CLIENT.close()
        finally:
            P_CLIENT = None


# ---------------------------------------------------------------------------
# Typed fire-and-forget wrappers. Each one resolves the singleton, no-ops when
# the client is unavailable, and swallows every error (including the SDK's
# synchronous pydantic.ValidationError) so a bad/missing analytics call can
# never break a product code path. Call these from feature code, not the raw
# client.
# ---------------------------------------------------------------------------

def track_link_email(email: Optional[str]) -> None:
    if not email:
        return
    c = get_analytics_client()
    if c is None:
        return
    try:
        c.identify.link_email(email=email)
    except Exception as e:
        logger.debug("analytics link_email failed: %s", e)


def track_agent_created(*, id: str, name: Optional[str] = None, dashboard_id: Optional[str] = None) -> None:
    c = get_analytics_client()
    if c is None:
        return
    try:
        c.events.agent.create(id=id, name=name, dashboard_id=dashboard_id)
    except Exception as e:
        logger.debug("analytics agent.create failed: %s", e)


def track_dashboard_event(*, dashboard_id: str, action: str) -> None:
    """action is one of: open, close, create, delete (validated by the SDK)."""
    c = get_analytics_client()
    if c is None:
        return
    try:
        c.events.dashboard.event(dashboard_id=dashboard_id, action=action)
    except Exception as e:
        logger.debug("analytics dashboard.event failed: %s", e)


def track_onboarding_step(*, step_id: str, status: str) -> None:
    """status is one of: started, completed, abandoned (validated by the SDK)."""
    c = get_analytics_client()
    if c is None:
        return
    try:
        c.events.onboarding.step(step_id=step_id, status=status)
    except Exception as e:
        logger.debug("analytics onboarding.step failed: %s", e)
