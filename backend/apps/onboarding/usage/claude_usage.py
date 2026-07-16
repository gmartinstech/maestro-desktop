"""Read the user's real Claude conversation topics from claude.ai using their own
logged-in browser cookies (see browser_cookies), no in-app login. Claude's website
session is the only way in (its API token is a different realm), and a plain request
carries it fine (unlike ChatGPT, claude.ai does not fingerprint-block). Capped,
read-only, fails open to "" on anything so prep falls back to the local scan.
"""

from typing import List

import httpx
from typeguard import typechecked

from backend.apps.onboarding.usage.browser_cookies import cookie_header, read_provider_cookies

BASE = "https://claude.ai"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGE = 100
CAP_PAGES = 40
CAP_TITLES = 1000


@typechecked
def summarize_claude_usage(total: int, titles: List[str]) -> str:
    parts: List[str] = []
    if total > 0:
        parts.append(f"They have {total} past Claude conversations.")
    if titles:
        parts.append("Topics they keep coming back to (recent first): " + "; ".join(titles[:150]))
    return "\n".join(parts)[:4000]


@typechecked
async def harvest_claude_usage() -> str:
    jar = read_provider_cookies("claude.ai")
    if not jar:
        return ""
    headers = {"Cookie": cookie_header(jar), "User-Agent": UA, "Accept": "application/json"}
    titles: List[str] = []
    seen: set = set()
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            org_res = await client.get(f"{BASE}/api/organizations")
            if org_res.status_code != 200:
                return ""
            orgs = org_res.json()
            if not isinstance(orgs, list) or not orgs:
                return ""
            org = orgs[0].get("uuid")
            offset = 0
            for _ in range(CAP_PAGES):
                if len(titles) >= CAP_TITLES:
                    break
                cr = await client.get(
                    f"{BASE}/api/organizations/{org}/chat_conversations",
                    params={"limit": PAGE, "offset": offset},
                )
                if cr.status_code != 200:
                    break
                items = cr.json()
                if not isinstance(items, list) or not items:
                    break
                fresh = 0
                for it in items:
                    cid = it.get("uuid")
                    if cid and cid not in seen:
                        seen.add(cid)
                        name = it.get("name")
                        if name:
                            titles.append(str(name))
                        fresh += 1
                if fresh == 0 or len(items) < PAGE:
                    break
                offset += PAGE
    except Exception:
        return ""
    return summarize_claude_usage(len(seen), titles)
