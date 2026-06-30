"""Low-level authed Reddit transport.

Borrow the user's session, harvest the bearer token their own logged-in web
client already uses (no API key, no app registration), and call the documented
oauth.reddit.com surface. Rate-limited and self-refreshing on token expiry.
stdlib-only to match the sibling shims and start fast.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.apps.reddit_mcp_shim import rate_limit
from backend.apps.reddit_mcp_shim.session_source import get_session, invalidate

DOMAIN = "reddit.com"
WWW = "https://www.reddit.com"
OAUTH = "https://oauth.reddit.com"
TOKEN_RE = re.compile(r'"accessToken":\s*"([^"]+)"')
EXPIRES_RE = re.compile(r'"(?:expiresIn|expires)":\s*"?(\d+)')

p_token = ""
p_token_exp = 0.0


class RedditError(Exception):
    """A Reddit request failed in a way worth surfacing to the agent."""


def bearer(force: bool = False) -> str:
    """Return a valid bearer token, harvesting a fresh one from authed HTML when stale."""
    global p_token, p_token_exp
    now = time.time()
    if not force and p_token and now < p_token_exp - 60:
        return p_token

    cookie, ua = get_session(DOMAIN)
    req = urllib.request.Request(
        f"{WWW}/",
        headers={"Cookie": cookie, "User-Agent": ua, "Accept": "text/html"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20.0) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        raise RedditError(f"Reddit unreachable: {getattr(e, 'reason', e)}")

    m = TOKEN_RE.search(text)
    if not m:
        invalidate(DOMAIN)
        raise RedditError(
            "Could not read a Reddit session token. Open reddit.com in the OpenSwarm browser, sign in, then retry."
        )
    p_token = m.group(1)
    exp = EXPIRES_RE.search(text)
    ttl = float(exp.group(1)) if exp else 3600.0
    # The web client reports expiry in ms; fold that down and clamp to a sane window.
    if ttl > 86400:
        ttl = ttl / 1000.0
    p_token_exp = now + min(max(ttl, 300.0), 86400.0)
    return p_token


def api(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    form: dict | None = None,
    action: str = "read",
) -> dict:
    """Authenticated oauth.reddit.com call with rate-limiting + one auto token refresh."""
    return p_api(method, path, params=params, form=form, action=action, retried=False)


def p_api(method, path, *, params, form, action, retried) -> dict:
    rate_limit.acquire(action)
    _, ua = get_session(DOMAIN)
    token = bearer()
    qs = dict(params or {})
    qs.setdefault("raw_json", 1)
    url = f"{OAUTH}{path}?" + urllib.parse.urlencode({k: v for k, v in qs.items() if v is not None})
    data = urllib.parse.urlencode({k: v for k, v in form.items() if v is not None}).encode() if form is not None else None
    headers = {"Authorization": f"Bearer {token}", "User-Agent": ua, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            status, raw, rhdr = resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        status, raw, rhdr = e.code, (e.read() if e.fp else b""), dict(e.headers or {})
    except urllib.error.URLError as e:
        raise RedditError(f"Reddit unreachable: {getattr(e, 'reason', e)}")

    rate_limit.note_response(status, {k.lower(): v for k, v in rhdr.items()})

    if status == 401 and not retried:
        bearer(force=True)
        return p_api(method, path, params=params, form=form, action=action, retried=True)
    if status == 429:
        raise RedditError("Reddit is rate-limiting this account; slow down and retry shortly.")
    if status >= 400:
        raise RedditError(f"Reddit HTTP {status}: {raw[:300].decode('utf-8', 'replace')}")
    try:
        return json.loads(raw.decode("utf-8", errors="replace") or "{}")
    except json.JSONDecodeError:
        return {"raw": raw.decode("utf-8", errors="replace")}
