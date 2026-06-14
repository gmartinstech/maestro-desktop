import asyncio
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import Query
from backend.config.Apps import SubApp

logger = logging.getLogger(__name__)

P_REPO = "anthropics/skills"
P_BRANCH = "main"
P_RAW_BASE = f"https://raw.githubusercontent.com/{P_REPO}/{P_BRANCH}"
P_MANIFEST_URL = f"{P_RAW_BASE}/.claude-plugin/marketplace.json"
P_REFRESH_INTERVAL_S = 3600
P_CONCURRENT_FETCHES = 15

P_CACHE: dict[str, dict] = {}
P_CACHE_UPDATED_AT: float = 0
P_REFRESH_TASK: Optional[asyncio.Task] = None


def p_parse_frontmatter(raw: str) -> tuple[dict, str]:
    """Split YAML frontmatter from markdown body."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("---", 3)
    if end == -1:
        return {}, raw
    fm_block = raw[3:end].strip()
    body = raw[end + 3:].strip()
    meta: dict = {}
    for line in fm_block.splitlines():
        m = re.match(r"^(\w[\w_-]*)\s*:\s*(.+)$", line)
        if m:
            meta[m.group(1).strip()] = m.group(2).strip().strip('"').strip("'")
    return meta, body


async def p_fetch_skill_paths(client: httpx.AsyncClient) -> list[tuple[str, str]]:
    """Fetch the marketplace.json manifest and return (skill_folder, plugin_name) pairs.

    Uses raw.githubusercontent.com; no GitHub API needed, no rate limiting.
    """
    resp = await client.get(P_MANIFEST_URL)
    resp.raise_for_status()
    manifest = resp.json()

    paths: list[tuple[str, str]] = []
    for plugin in manifest.get("plugins", []):
        plugin_name = plugin.get("name", "")
        for skill_ref in plugin.get("skills", []):
            folder = skill_ref.lstrip("./")
            paths.append((folder, plugin_name))
    return paths


async def p_fetch_one_skill(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    folder: str,
    plugin_name: str,
) -> Optional[dict]:
    async with sem:
        try:
            resp = await client.get(f"{P_RAW_BASE}/{folder}/SKILL.md")
            if resp.status_code != 200:
                return None
            raw = resp.text
        except Exception as exc:
            logger.debug(f"Failed to fetch {folder}/SKILL.md: {exc}")
            return None

    meta, body = p_parse_frontmatter(raw)
    name = meta.get("name", "")
    if not name:
        folder_name = folder.rsplit("/", 1)[-1]
        name = folder_name.replace("-", " ").replace("_", " ").title()

    return {
        "name": name,
        "description": meta.get("description", ""),
        "content": body,
        "folder": folder,
        "category": plugin_name.replace("-", " ").replace("_", " ").title(),
        "repositoryUrl": f"https://github.com/{P_REPO}/tree/{P_BRANCH}/{folder}",
    }


async def p_fetch_all_skills() -> dict[str, dict]:
    skills: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            paths = await p_fetch_skill_paths(client)
        except Exception as e:
            logger.warning(f"Skill registry manifest fetch failed: {e}")
            return skills

        logger.info(f"Skill registry: found {len(paths)} skills in manifest, fetching content...")
        sem = asyncio.Semaphore(P_CONCURRENT_FETCHES)
        results = await asyncio.gather(
            *[p_fetch_one_skill(client, sem, folder, plugin) for folder, plugin in paths]
        )
        for rec in results:
            if rec:
                skills[rec["name"]] = rec

    logger.info(f"Skill registry cache refreshed: {len(skills)} skills")
    return skills


async def p_refresh_loop():
    global P_CACHE, P_CACHE_UPDATED_AT
    while True:
        try:
            P_CACHE = await p_fetch_all_skills()
            P_CACHE_UPDATED_AT = time.time()
        except Exception as e:
            logger.exception(f"Skill registry refresh error: {e}")
        await asyncio.sleep(P_REFRESH_INTERVAL_S)


@asynccontextmanager
async def skill_registry_lifespan():
    global P_REFRESH_TASK
    P_REFRESH_TASK = asyncio.create_task(p_refresh_loop())
    yield
    if P_REFRESH_TASK:
        P_REFRESH_TASK.cancel()
        try:
            await P_REFRESH_TASK
        except asyncio.CancelledError:
            pass


skill_registry = SubApp("skill-registry", skill_registry_lifespan)


@skill_registry.router.get("/stats")
async def registry_stats():
    categories: dict[str, int] = {}
    for s in P_CACHE.values():
        cat = s.get("category", "General")
        categories[cat] = categories.get(cat, 0) + 1
    return {
        "total": len(P_CACHE),
        "categories": categories,
        "lastUpdated": P_CACHE_UPDATED_AT,
    }


@skill_registry.router.get("/search")
async def registry_search(
    q: str = Query("", description="Search query"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    category: str = Query("", description="Filter by category"),
):
    pool = list(P_CACHE.values())
    if category:
        cat_lower = category.lower()
        pool = [s for s in pool if s.get("category", "").lower() == cat_lower]

    query_lower = q.lower().strip()
    if query_lower:
        filtered = []
        for sk in pool:
            searchable = f"{sk['name']} {sk['description']} {sk.get('category', '')}".lower()
            if query_lower in searchable:
                filtered.append(sk)
        pool = filtered

    pool.sort(key=lambda s: s["name"].lower())
    total = len(pool)
    page = pool[offset : offset + limit]

    summary = [
        {
            "name": s["name"],
            "description": s["description"],
            "folder": s["folder"],
            "category": s.get("category", "General"),
            "repositoryUrl": s.get("repositoryUrl", ""),
        }
        for s in page
    ]
    return {"skills": summary, "total": total, "offset": offset, "limit": limit}


@skill_registry.router.get("/detail/{skill_name:path}")
async def registry_detail(skill_name: str):
    sk = P_CACHE.get(skill_name)
    if not sk:
        return {"error": "Skill not found"}, 404
    return {"skill": sk}
