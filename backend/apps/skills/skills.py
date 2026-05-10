import os
import shutil
import json
import logging
import re
from contextlib import asynccontextmanager
from fastapi import HTTPException
from backend.config.Apps import SubApp
from backend.apps.skills.models import Skill, SkillCreate, SkillUpdate, SkillWorkspaceSeedRequest

logger = logging.getLogger(__name__)

SKILLS_DIR = os.path.expanduser("~/.claude/skills")
INDEX_PATH = os.path.join(SKILLS_DIR, ".skills_index.json")

from backend.config.paths import SKILLS_WORKSPACE_DIR


@asynccontextmanager
async def skills_lifespan():
    os.makedirs(SKILLS_DIR, exist_ok=True)
    os.makedirs(SKILLS_WORKSPACE_DIR, exist_ok=True)
    _migrate_flat_to_dir_layout()
    yield


skills = SubApp("skills", skills_lifespan)


# ---------------------------------------------------------------------------
# Installed-slugs cache
# ---------------------------------------------------------------------------
# `_run_agent_loop` asks for the list of installed skill slugs on *every*
# turn so it can hand the SDK an auto-discovery allowlist. The disk layout
# rarely changes mid-session, so re-walking SKILLS_DIR + statting each
# subdir's SKILL.md on every turn is wasted work — for N skills and T
# turns that's N*T syscalls in the agent hot path, all returning the same
# answer.
#
# Cache the slug list at module scope, key it by the current SKILLS_DIR
# (so test monkeypatching automatically forces a refetch when the dir
# moves), and invalidate explicitly from the create / delete endpoints
# and from the startup migration. Update doesn't invalidate because
# updates can only change a skill's content or metadata, never the set
# of slugs (`update_skill` 404s if the slug dir doesn't already exist).
#
# Concurrency: FastAPI runs handlers on the asyncio event loop in a
# single thread; none of the cache-touching code paths await between
# reading and writing `_INSTALLED_SLUGS_CACHE`, so no lock is needed.
# Multi-worker deployments each get their own cache, but they also have
# disjoint disk layouts being scanned, so that's fine.
_INSTALLED_SLUGS_CACHE: tuple[str, list[str]] | None = None


def _invalidate_installed_slugs_cache() -> None:
    """Drop the cached slug list; next `get_installed_slugs` rescans."""
    global _INSTALLED_SLUGS_CACHE
    _INSTALLED_SLUGS_CACHE = None


def get_installed_slugs() -> list[str]:
    """Return sorted slugs of installed skills (`<slug>/SKILL.md`).

    Cached at module level and keyed by SKILLS_DIR so a test that
    monkeypatches the dir gets a fresh scan automatically. The returned
    list is shared — callers must not mutate it.
    """
    global _INSTALLED_SLUGS_CACHE
    cached = _INSTALLED_SLUGS_CACHE
    if cached is not None and cached[0] == SKILLS_DIR:
        return cached[1]
    if not os.path.isdir(SKILLS_DIR):
        result: list[str] = []
    else:
        result = sorted(
            entry
            for entry in os.listdir(SKILLS_DIR)
            if not entry.startswith(".")
            and os.path.isfile(os.path.join(SKILLS_DIR, entry, "SKILL.md"))
        )
    _INSTALLED_SLUGS_CACHE = (SKILLS_DIR, result)
    return result


# Skills used to live as flat files (`~/.claude/skills/<slug>.md`) because
# OpenSwarm injected their full body into the user prompt itself and never
# leaned on Claude Code's own discovery. Now that we want the agent to
# auto-discover skills via the SDK's Skill tool, we have to match the CLI's
# convention, which is one directory per skill with a SKILL.md inside —
# confirmed by the bundled CLI's discovery code (`<dir>/SKILL.md`) and its
# user-facing docs ("`~/.claude/skills/<name>/SKILL.md`"). Anything else is
# silently ignored by the CLI.
def _migrate_flat_to_dir_layout() -> None:
    """One-shot migration: move `<slug>.md` -> `<slug>/SKILL.md`.

    Idempotent: re-running after the move is a no-op. Crash-safe: the new
    file is written before the old one is removed. If a directory already
    exists for a slug it wins; we log and leave the flat file untouched so
    the operator can resolve it manually.
    """
    if not os.path.isdir(SKILLS_DIR):
        return
    for entry in os.listdir(SKILLS_DIR):
        if not entry.endswith(".md") or entry.startswith("."):
            continue
        flat_path = os.path.join(SKILLS_DIR, entry)
        if not os.path.isfile(flat_path):
            continue
        slug = entry[:-3]
        target_dir = os.path.join(SKILLS_DIR, slug)
        target_skill = os.path.join(target_dir, "SKILL.md")
        if os.path.isdir(target_dir):
            if not os.path.isfile(target_skill):
                # Pre-existing dir without a SKILL.md is unusable; bail
                # rather than overwrite whatever else is in there.
                logger.warning(
                    f"Skill migration: {target_dir} exists but has no SKILL.md; "
                    f"leaving flat file {flat_path} in place."
                )
                continue
            logger.info(
                f"Skill migration: directory {target_dir} already present, "
                f"removing redundant flat file {flat_path}"
            )
            try:
                os.remove(flat_path)
            except OSError as exc:
                logger.warning(f"Skill migration: could not remove {flat_path}: {exc}")
            continue
        try:
            with open(flat_path, encoding="utf-8") as f:
                body = f.read()
        except OSError as exc:
            logger.warning(f"Skill migration: could not read {flat_path}: {exc}")
            continue
        index = _load_index()
        meta = index.get(slug, {})
        body = _ensure_frontmatter(
            body,
            name=meta.get("name", slug.replace("-", " ").replace("_", " ").title()),
            description=meta.get("description", ""),
        )
        os.makedirs(target_dir, exist_ok=True)
        with open(target_skill, "w", encoding="utf-8") as f:
            f.write(body)
        try:
            os.remove(flat_path)
        except OSError as exc:
            logger.warning(
                f"Skill migration: wrote {target_skill} but could not remove "
                f"{flat_path}: {exc}"
            )
        logger.info(f"Skill migration: {flat_path} -> {target_skill}")
    # Migration may have changed the slug set; drop the cache so the
    # first post-startup call (typically from `_run_agent_loop`) rescans.
    _invalidate_installed_slugs_cache()


def _skill_path(slug: str) -> str:
    """Canonical on-disk path for a skill's SKILL.md."""
    return os.path.join(SKILLS_DIR, slug, "SKILL.md")


def _load_index() -> dict[str, dict]:
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH) as f:
            return json.load(f)
    return {}


def _save_index(index: dict[str, dict]):
    os.makedirs(SKILLS_DIR, exist_ok=True)
    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2)


def _decode_yaml_scalar(raw: str) -> str:
    """Inverse of `_yaml_scalar` — decodes the values it can emit.
    """
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw[1:-1]
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        # YAML single-quote rule: interior `''` is a literal `'`. We
        # don't emit single-quoted scalars ourselves, but hand-edited
        # frontmatter sometimes does.
        return raw[1:-1].replace("''", "'")
    return raw


def _parse_skill_frontmatter(raw: str) -> dict:
    """Extract YAML frontmatter fields from a SKILL.md file."""
    if not raw.startswith("---"):
        return {}
    end = raw.find("---", 3)
    if end == -1:
        return {}
    fm_block = raw[3:end].strip()
    meta: dict = {}
    for line in fm_block.splitlines():
        m = re.match(r"^(\w[\w_-]*)\s*:\s*(.+)$", line)
        if m:
            meta[m.group(1).strip()] = _decode_yaml_scalar(m.group(2))
    return meta


def _ensure_frontmatter(content: str, *, name: str, description: str) -> str:
    """Make sure SKILL.md starts with a YAML block carrying name+description.

    The CLI only surfaces a skill in the auto-discovery listing if its
    frontmatter parses, so on every write we either patch the existing
    block (preserving the user's other keys) or prepend a fresh one.
    """
    existing = _parse_skill_frontmatter(content)
    if existing:
        end = content.find("---", 3)
        body = content[end + 3 :].lstrip("\n")
    else:
        body = content
    merged = {**existing, "name": name}
    if description or "description" not in merged:
        merged["description"] = description
    fm_lines = [f"{k}: {_yaml_scalar(v)}" for k, v in merged.items() if v != "" or k in ("name", "description")]
    return "---\n" + "\n".join(fm_lines) + "\n---\n\n" + body


def _yaml_scalar(value: object) -> str:
    """Quote a YAML scalar only when needed (matches CLI parser tolerance)."""
    s = str(value)
    if s == "" or any(c in s for c in (":", "#", "\n")) or s.strip() != s:
        return json.dumps(s)
    return s


def _sync_skills() -> list[Skill]:
    """Sync skills from the filesystem, updating the index.

    Walks `SKILLS_DIR/<slug>/SKILL.md` (the layout the CLI discovers) and
    pulls metadata from the file's YAML frontmatter, falling back to the
    sidecar index for fields the user only set via the API.
    """
    index = _load_index()
    result = []

    if not os.path.isdir(SKILLS_DIR):
        return result

    for slug in os.listdir(SKILLS_DIR):
        if slug.startswith("."):
            continue
        skill_dir = os.path.join(SKILLS_DIR, slug)
        if not os.path.isdir(skill_dir):
            continue
        skill_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_path):
            continue
        with open(skill_path, encoding="utf-8") as f:
            content = f.read()
        frontmatter = _parse_skill_frontmatter(content)
        meta = index.get(slug, {})
        name = (
            frontmatter.get("name")
            or meta.get("name")
            or slug.replace("-", " ").replace("_", " ").title()
        )
        description = frontmatter.get("description") or meta.get("description", "")
        result.append(
            Skill(
                id=slug,
                name=name,
                description=description,
                content=content,
                file_path=skill_path,
                command=meta.get("command", slug),
            )
        )

    return result


@skills.router.get("/list")
async def list_skills():
    return {"skills": [s.model_dump() for s in _sync_skills()]}


@skills.router.post("/workspace/seed")
async def seed_skill_workspace(body: SkillWorkspaceSeedRequest):
    folder = os.path.join(SKILLS_WORKSPACE_DIR, body.workspace_id)
    os.makedirs(folder, exist_ok=True)

    if body.skill_content:
        with open(os.path.join(folder, "SKILL.md"), "w") as f:
            f.write(body.skill_content)
    if body.meta:
        with open(os.path.join(folder, "meta.json"), "w") as f:
            json.dump(body.meta, f, indent=2)

    return {"path": os.path.abspath(folder)}


@skills.router.get("/workspace/{workspace_id}")
async def read_skill_workspace(workspace_id: str):
    folder = os.path.join(SKILLS_WORKSPACE_DIR, workspace_id)
    if not os.path.isdir(folder):
        raise HTTPException(status_code=404, detail="Workspace not found")

    skill_content = None
    skill_path = os.path.join(folder, "SKILL.md")
    if os.path.isfile(skill_path):
        with open(skill_path) as f:
            skill_content = f.read()

    meta = None
    meta_path = os.path.join(folder, "meta.json")
    if os.path.isfile(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except json.JSONDecodeError:
            pass

    frontmatter = _parse_skill_frontmatter(skill_content) if skill_content else {}

    return {
        "skill_content": skill_content,
        "meta": meta,
        "frontmatter": frontmatter,
    }


@skills.router.get("/{skill_id}")
async def get_skill(skill_id: str):
    for s in _sync_skills():
        if s.id == skill_id:
            return s.model_dump()
    raise HTTPException(status_code=404, detail="Skill not found")


@skills.router.post("/create")
async def create_skill(body: SkillCreate):
    slug = body.name.lower().replace(" ", "-")
    skill_dir = os.path.join(SKILLS_DIR, slug)
    os.makedirs(skill_dir, exist_ok=True)
    fpath = os.path.join(skill_dir, "SKILL.md")

    final_content = _ensure_frontmatter(
        body.content, name=body.name, description=body.description
    )
    with open(fpath, "w") as f:
        f.write(final_content)

    index = _load_index()
    index[slug] = {
        "name": body.name,
        "description": body.description,
        "command": body.command or slug,
    }
    _save_index(index)

    skill = Skill(
        id=slug,
        name=body.name,
        description=body.description,
        content=final_content,
        file_path=fpath,
        command=body.command or slug,
    )
    _invalidate_installed_slugs_cache()
    return {"ok": True, "skill": skill.model_dump()}


@skills.router.put("/{skill_id}")
async def update_skill(skill_id: str, body: SkillUpdate):
    fpath = _skill_path(skill_id)
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="Skill not found")

    index = _load_index()
    meta = index.get(skill_id, {})
    if body.command is not None:
        meta["command"] = body.command

    # Precedence for name/description, highest first:
    #   1. explicit form field (`body.name` / `body.description`)
    #   2. inline frontmatter inside `body.content` (so editing the YAML
    #      block in the editor textarea actually sticks instead of being
    #      silently clobbered by the stale index value)
    #   3. previous index value
    #   4. slug-derived fallback
    #
    inline = _parse_skill_frontmatter(body.content) if body.content else {}
    if body.name is not None:
        meta["name"] = body.name
    elif inline.get("name"):
        meta["name"] = inline["name"]
    if body.description is not None:
        meta["description"] = body.description
    elif "description" in inline:
        meta["description"] = inline["description"]
    index[skill_id] = meta

    if body.content is not None:
        new_content = _ensure_frontmatter(
            body.content,
            name=meta.get("name", skill_id),
            description=meta.get("description", ""),
        )
        with open(fpath, "w") as f:
            f.write(new_content)
    elif body.name is not None or body.description is not None:
        # Metadata changed but body wasn't supplied — patch the
        # frontmatter on disk so the CLI listing stays in sync.
        with open(fpath, encoding="utf-8") as f:
            existing = f.read()
        new_content = _ensure_frontmatter(
            existing,
            name=meta.get("name", skill_id),
            description=meta.get("description", ""),
        )
        with open(fpath, "w") as f:
            f.write(new_content)

    _save_index(index)

    with open(fpath) as f:
        content = f.read()

    skill = Skill(
        id=skill_id,
        name=meta.get("name", skill_id),
        description=meta.get("description", ""),
        content=content,
        file_path=fpath,
        command=meta.get("command", skill_id),
    )
    return {"ok": True, "skill": skill.model_dump()}


@skills.router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    skill_dir = os.path.join(SKILLS_DIR, skill_id)
    if os.path.isdir(skill_dir):
        shutil.rmtree(skill_dir)
    index = _load_index()
    index.pop(skill_id, None)
    _save_index(index)
    _invalidate_installed_slugs_cache()
    return {"ok": True}
