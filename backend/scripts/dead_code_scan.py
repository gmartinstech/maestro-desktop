#!/usr/bin/env python3
"""One-shot dead-code scanner for the backend.

Liveness model (no runtime / no dogfooding):
  A backend file/symbol is ALIVE iff at least one of these is true:
    1. The module sits on the static import graph rooted at one of the
       real production entry points (FastAPI app + each *_mcp_server.py
       + discord_mcp_shim/__main__).
    2. The handler is registered as an HTTP route or WebSocket event
       AND at least one caller (frontend, electron, or another backend
       module that issues HTTP requests internally) references the
       endpoint by string.
  Everything else is dead.

  Tests are NOT a liveness signal. A test exercising a function only
  proves the test exercises it; nothing about production. Tests that
  reference dead modules / dead endpoints are themselves dead and the
  report flags them.

Subcommands:
  reach      Static reachability walk from production roots.
  vulture    Run vulture with allowlist tuned for this repo.
  ruff       Run ruff F401/F811/F841 (auto-installs ruff if missing).
  endpoints  Enumerate every backend HTTP route and WebSocket event.
  callers    Index every frontend/electron file + their text content.
  match      Cross-reference endpoints against callers; emit
             dead_endpoints.json.
  rank       Read all artifacts; emit dead-code-report.md.
  all        Run reach + vulture + ruff + endpoints + callers + match
             + rank.

Typical workflow:
    python backend/scripts/dead_code_scan.py all
    open .dead-code-scan/dead-code-report.md
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
APPS_DIR = BACKEND_DIR / "apps"
TESTS_DIR = BACKEND_DIR / "tests"
SCRATCH_DIR = REPO_ROOT / ".dead-code-scan"

PRODUCTION_ROOTS: list[str] = [
    "backend.main",
    "backend.apps.agents.browser_agent_mcp_server",
    "backend.apps.agents.invoke_agent_mcp_server",
    "backend.apps.agents.mcp_meta_server",
    "backend.apps.agents.outputs_meta_server",
    "backend.apps.agents.web_mcp_server",
    "backend.apps.discord_mcp_shim.__main__",
]

EXTRA_LIVE_HINTS: list[str] = [
    "backend.apps.agents.ws_manager",
    "backend.apps.agents.agent_manager",
    "backend.apps.agents.seq_log",
    "backend.apps.agents.anthropic_proxy",
]

# Where we look for "callers" - things that can invoke a backend endpoint
# by name. Frontend and Electron renderer code talk to the backend over
# HTTP/WS. Other backend modules also call internal HTTP endpoints (the
# spawned MCP servers POST back to /api/mcp-meta/*, /api/outputs-meta/*,
# etc.), so we scan backend/ too - but only as caller-text, not for AST.
CALLER_SEARCH_ROOTS: list[Path] = [
    REPO_ROOT / "frontend" / "src",
    REPO_ROOT / "electron",
    BACKEND_DIR,  # backend modules that POST to other backend endpoints
]
CALLER_SKIP_SUBSTRINGS = (
    "/node_modules/", "/.venv/", "/__pycache__/", "/dist/", "/build-staging/",
    "/python-env/", "/.dead-code-scan/", "/coverage_html/", "/mcp-bundles/",
    "/backend/scripts/",  # Don't count this scanner's own text as a "caller".
    "/backend/tests/",     # Tests are not a liveness signal.
)
CALLER_FILE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".ps1"}


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

def _print(msg: str) -> None:
    print(f"[dead-code-scan] {msg}", flush=True)


_SITECUSTOMIZE_SHIM = ""  # No longer used; kept for backwards-compat.


def _ensure_scratch() -> None:
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)


def _module_to_path(mod: str) -> Path | None:
    parts = mod.split(".")
    candidate = REPO_ROOT.joinpath(*parts).with_suffix(".py")
    if candidate.is_file():
        return candidate
    pkg_init = REPO_ROOT.joinpath(*parts, "__init__.py")
    if pkg_init.is_file():
        return pkg_init
    return None


def _path_to_module(path: Path) -> str | None:
    try:
        rel = path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return None
    parts = list(rel.parts)
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    elif parts[-1].endswith(".py"):
        parts[-1] = parts[-1][:-3]
    else:
        return None
    return ".".join(parts)


def _iter_backend_py_files() -> Iterable[Path]:
    for p in BACKEND_DIR.rglob("*.py"):
        s = str(p)
        if "/.venv/" in s or "/__pycache__/" in s:
            continue
        if "/tests/" in s:
            continue
        if "/scripts/" in s:
            continue
        if "/mcp-bundles/" in s:
            continue
        yield p


def _iter_test_py_files() -> Iterable[Path]:
    for p in TESTS_DIR.rglob("test_*.py"):
        if "/__pycache__/" in str(p):
            continue
        yield p


def _safe_load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return default


def _line_count(path: Path) -> int:
    try:
        return sum(1 for _ in path.open("rb"))
    except OSError:
        return 0


# ---------------------------------------------------------------------------
# Phase 1: static reachability
# ---------------------------------------------------------------------------

def _collect_imports_from_ast(tree: ast.AST, current_pkg: str) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level:
                base_parts = current_pkg.split(".")
                if node.level > len(base_parts):
                    continue
                base = ".".join(base_parts[: len(base_parts) - node.level + 1])
                full = f"{base}.{mod}" if mod else base
            else:
                full = mod
            if full:
                out.add(full)
                for alias in node.names:
                    if alias.name and alias.name != "*":
                        out.add(f"{full}.{alias.name}")
        elif isinstance(node, ast.Call):
            func = node.func
            name = None
            if isinstance(func, ast.Attribute) and func.attr == "import_module":
                name = "importlib.import_module"
            elif isinstance(func, ast.Name) and func.id == "__import__":
                name = "__import__"
            if name and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    out.add(first.value)
    return out


def _collect_python_dash_m_strings() -> set[str]:
    out: set[str] = set()
    pattern = re.compile(r"python(?:3)?\s+-m\s+([a-zA-Z_][\w\.]*)")
    search_roots = [BACKEND_DIR, REPO_ROOT / "electron", REPO_ROOT / "scripts"]
    for root in search_roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            s = str(p)
            if any(k in s for k in CALLER_SKIP_SUBSTRINGS):
                continue
            if p.suffix not in {".py", ".js", ".ts", ".sh", ".ps1", ".json", ".md"}:
                continue
            try:
                text = p.read_text(errors="ignore")
            except Exception:
                continue
            for m in pattern.finditer(text):
                mod = m.group(1)
                if mod.startswith("backend."):
                    out.add(mod)
    return out


def _ancestor_packages(mod: str) -> list[str]:
    parts = mod.split(".")
    out: list[str] = []
    for i in range(len(parts) - 1, 0, -1):
        if (REPO_ROOT.joinpath(*parts[:i]) / "__init__.py").is_file():
            out.append(".".join(parts[:i]))
    return out


def _walk_reachability(roots: list[str]) -> tuple[set[str], dict[str, set[str]]]:
    reachable: set[str] = set()
    imported_symbols: dict[str, set[str]] = defaultdict(set)
    queue: list[str] = list(roots)

    while queue:
        mod = queue.pop()
        if mod in reachable:
            continue
        reachable.add(mod)
        for anc in _ancestor_packages(mod):
            if anc not in reachable:
                queue.append(anc)
        path = _module_to_path(mod)
        if path is None:
            continue
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        deps = _collect_imports_from_ast(tree, mod)
        for dep in deps:
            base_path = _module_to_path(dep)
            if base_path is None:
                parent, _, leaf = dep.rpartition(".")
                if parent:
                    parent_path = _module_to_path(parent)
                    if parent_path is not None:
                        imported_symbols[parent].add(leaf)
                        if parent.startswith("backend.") and parent not in reachable:
                            queue.append(parent)
                        continue
                continue
            if dep.startswith("backend.") and dep not in reachable:
                queue.append(dep)

    return reachable, dict(imported_symbols)


def cmd_reach(_args) -> None:
    _ensure_scratch()
    extras = _collect_python_dash_m_strings()
    roots = sorted(set(PRODUCTION_ROOTS) | set(EXTRA_LIVE_HINTS) | extras)
    _print(f"reachability roots ({len(roots)}):")
    for r in roots:
        _print(f"  - {r}")

    reachable, imported_symbols = _walk_reachability(roots)
    backend_reachable = {m for m in reachable if m == "backend" or m.startswith("backend.")}
    _print(f"reachable backend modules: {len(backend_reachable)}")

    all_files = list(_iter_backend_py_files())
    all_modules = {_path_to_module(p) for p in all_files}
    all_modules.discard(None)
    unreachable = sorted(m for m in all_modules if m and m not in backend_reachable)
    _print(f"unreachable backend modules: {len(unreachable)}")

    (SCRATCH_DIR / "reachable_modules.json").write_text(json.dumps({
        "roots": roots,
        "reachable": sorted(backend_reachable),
        "unreachable": unreachable,
    }, indent=2))
    (SCRATCH_DIR / "reachable_symbols.json").write_text(json.dumps(
        {k: sorted(v) for k, v in imported_symbols.items() if k == "backend" or k.startswith("backend.")},
        indent=2,
    ))
    _print("wrote reachable_modules.json + reachable_symbols.json")


# ---------------------------------------------------------------------------
# Phase 2: vulture
# ---------------------------------------------------------------------------

VULTURE_WHITELIST = """\
# Auto-generated allowlist for vulture. Suppresses known dynamic patterns
# in this codebase that look unused but are actually invoked at runtime.

# FastAPI route handlers and module-level routers (registered by string
# in backend.config.Apps.MainApp).
agents
health
skills
tools_lib
modes
settings
mcp_registry
skill_registry
outputs
dashboards
service
subscription
web
anthropic_proxy

# WebSocket handlers (registered via @app.websocket decorator).
websocket_session
websocket_dashboard

# HTTP handlers registered via @app.* decorator.
browser_agent_run
mcp_meta
session_compact
session_clear
outputs_meta
invoke_agent_run
subscriptions_pending
subscriptions_callback
"""


def _find_vulture() -> str | None:
    venv_vulture = BACKEND_DIR / ".venv" / "bin" / "vulture"
    if venv_vulture.exists():
        return str(venv_vulture)
    out = subprocess.run(["which", "vulture"], capture_output=True, text=True)
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip()
    return None


def cmd_vulture(_args) -> None:
    _ensure_scratch()
    vulture_bin = _find_vulture()
    if vulture_bin is None:
        _print("vulture not found in venv or PATH; skipping vulture phase")
        (SCRATCH_DIR / "vulture.json").write_text("[]")
        return
    whitelist_path = SCRATCH_DIR / "whitelist.py"
    whitelist_path.write_text(VULTURE_WHITELIST)
    targets = [
        str(BACKEND_DIR / "main.py"),
        str(BACKEND_DIR / "auth.py"),
        str(BACKEND_DIR / "config"),
        str(APPS_DIR),
    ]
    cmd = [vulture_bin, *targets, str(whitelist_path), "--min-confidence", "60"]
    _print(f"running: {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    findings: list[dict] = []
    line_re = re.compile(r"^(?P<path>[^:]+):(?P<line>\d+): (?P<msg>.+) \((?P<conf>\d+)% confidence\)$")
    for line in proc.stdout.splitlines():
        m = line_re.match(line.strip())
        if not m:
            continue
        d = m.groupdict()
        findings.append({
            "path": str(Path(d["path"]).resolve().relative_to(REPO_ROOT)),
            "line": int(d["line"]),
            "message": d["msg"],
            "confidence": int(d["conf"]),
        })
    (SCRATCH_DIR / "vulture.json").write_text(json.dumps(findings, indent=2))
    _print(f"vulture: {len(findings)} findings -> vulture.json")


# ---------------------------------------------------------------------------
# Phase 3: ruff
# ---------------------------------------------------------------------------

def _ensure_ruff() -> str | None:
    venv_pip = BACKEND_DIR / ".venv" / "bin" / "pip"
    venv_ruff = BACKEND_DIR / ".venv" / "bin" / "ruff"
    if venv_ruff.exists():
        return str(venv_ruff)
    if venv_pip.exists():
        _print("installing ruff into venv (one-shot)")
        proc = subprocess.run([str(venv_pip), "install", "--quiet", "ruff"], capture_output=True, text=True)
        if proc.returncode == 0 and venv_ruff.exists():
            return str(venv_ruff)
        _print(f"ruff install failed: {proc.stderr.strip()}")
    out = subprocess.run(["which", "ruff"], capture_output=True, text=True)
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip()
    return None


def cmd_ruff(_args) -> None:
    _ensure_scratch()
    ruff_bin = _ensure_ruff()
    if ruff_bin is None:
        _print("ruff not available; skipping ruff phase")
        (SCRATCH_DIR / "ruff.json").write_text("[]")
        return
    cmd = [
        ruff_bin, "check",
        "--select", "F401,F811,F841",
        "--output-format", "json",
        str(BACKEND_DIR),
    ]
    _print(f"running: {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout) if proc.stdout.strip() else []
    except json.JSONDecodeError:
        _print(f"ruff produced non-JSON output: {proc.stdout[:200]}")
        data = []
    findings = []
    for item in data:
        try:
            findings.append({
                "path": str(Path(item["filename"]).resolve().relative_to(REPO_ROOT)),
                "line": item["location"]["row"],
                "code": item["code"],
                "message": item["message"],
            })
        except (KeyError, ValueError):
            continue
    (SCRATCH_DIR / "ruff.json").write_text(json.dumps(findings, indent=2))
    _print(f"ruff: {len(findings)} findings -> ruff.json")


# ---------------------------------------------------------------------------
# Phase 4: endpoint extractor
# ---------------------------------------------------------------------------

# HTTP verbs FastAPI cares about. Used to detect router decorators.
HTTP_VERBS = {"get", "post", "put", "patch", "delete", "head", "options"}
# Verbs we treat as "endpoints worth tracking" - includes WebSocket and
# middleware (middleware doesn't have a path but is always live).
ALL_VERBS = HTTP_VERBS | {"websocket", "middleware"}


def _decorator_call(dec: ast.expr) -> ast.Call | None:
    """Return the ast.Call node for `@x(...)`, or None for `@x`."""
    return dec if isinstance(dec, ast.Call) else None


def _decorator_kind(dec_call: ast.Call) -> tuple[str, str] | None:
    """Classify a decorator call. Returns (kind, verb) or None.

    kinds:
      "router" - @<var>.router.<verb>(...)        ; verb in HTTP_VERBS
      "subapp" - @<var>.<verb>(...)               ; @subapp.get(...) sometimes used directly
      "app"    - @app.<verb>(...) / @app.middleware(...) / @app.websocket(...)
    """
    f = dec_call.func
    if not isinstance(f, ast.Attribute):
        return None
    verb = f.attr
    inner = f.value
    if isinstance(inner, ast.Attribute) and inner.attr == "router":
        if isinstance(inner.value, ast.Name) and verb in HTTP_VERBS:
            return ("router", verb, inner.value.id)
    if isinstance(inner, ast.Name):
        if inner.id == "app" and verb in ALL_VERBS:
            return ("app", verb, "app")
        if verb in HTTP_VERBS or verb == "websocket":
            # @<somevar>.<verb> - covers things like @subscription.get
            return ("subapp", verb, inner.id)
    return None


def _extract_subapp_prefixes(tree: ast.Module, file_module: str) -> dict[str, str]:
    """Find SubApp instantiations: `<var> = SubApp("<name>", lifespan)`.

    Returns dict mapping local var name -> /api/<name> prefix. We also
    track `var = APIRouter(prefix="/api/foo")` if used directly.
    """
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        call = node.value
        callee = call.func
        # SubApp("name", ...)
        if isinstance(callee, ast.Name) and callee.id == "SubApp":
            if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
                name = call.args[0].value
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        out[tgt.id] = f"/api/{name}"
        # APIRouter(prefix="/api/foo")
        elif isinstance(callee, ast.Name) and callee.id == "APIRouter":
            prefix = ""
            for kw in call.keywords:
                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    prefix = kw.value.value
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    out[tgt.id] = prefix
    return out


def _extract_ws_event_branches(tree: ast.Module) -> list[tuple[str, str]]:
    """Find WS event-handling branches: `if event == "<name>":`.

    Returns list of (event_name, enclosing_function_name). Restricted to
    functions decorated with `@<x>.websocket(...)` because we want events
    the FRONTEND sends to the server, not events the server broadcasts.
    Server broadcasts also write `event == "..."` (e.g. ws_manager checking
    its own outbound payload), and those would otherwise look like
    listenable events.
    """
    out: list[tuple[str, str]] = []

    def _has_ws_decorator(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
        for dec in fn.decorator_list:
            d = dec.func if isinstance(dec, ast.Call) else dec
            if isinstance(d, ast.Attribute) and d.attr == "websocket":
                return True
        return False

    # First pass: collect line ranges of WS-decorated functions.
    fn_ranges: list[tuple[ast.FunctionDef | ast.AsyncFunctionDef, int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _has_ws_decorator(node):
            start = node.lineno
            end = getattr(node, "end_lineno", None) or max(
                (getattr(c, "lineno", start) for c in ast.walk(node) if hasattr(c, "lineno")),
                default=start,
            )
            fn_ranges.append((node, start, end))

    if not fn_ranges:
        return out

    def _enclosing_ws(line: int) -> str | None:
        for fn, s, e in fn_ranges:
            if s <= line <= e:
                return fn.name
        return None

    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) and node.left.id == "event":
            if len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq) and len(node.comparators) == 1:
                c = node.comparators[0]
                if isinstance(c, ast.Constant) and isinstance(c.value, str):
                    enclosing = _enclosing_ws(node.lineno)
                    if enclosing is not None:
                        out.append((c.value, enclosing))
    return out


def cmd_endpoints(_args) -> None:
    """AST-walk the backend to find every HTTP route and WS event handler."""
    _ensure_scratch()
    endpoints: list[dict] = []
    ws_events: list[dict] = []

    for py_file in _iter_backend_py_files():
        try:
            text = py_file.read_text()
            tree = ast.parse(text)
        except (OSError, SyntaxError):
            continue
        rel = str(py_file.relative_to(REPO_ROOT))
        prefixes = _extract_subapp_prefixes(tree, rel)

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                dec_call = _decorator_call(dec)
                if dec_call is None:
                    continue
                kind = _decorator_kind(dec_call)
                if kind is None:
                    continue
                kind_str, verb, var_name = kind
                # Get path arg (always first positional, or empty for middleware)
                path = ""
                if dec_call.args and isinstance(dec_call.args[0], ast.Constant) and isinstance(dec_call.args[0].value, str):
                    path = dec_call.args[0].value
                if kind_str == "router":
                    full_path = (prefixes.get(var_name, "") + path) or "/"
                elif kind_str == "subapp":
                    full_path = (prefixes.get(var_name, "") + path) or "/"
                else:  # "app"
                    if verb == "middleware":
                        # Middleware always runs; treat as live.
                        endpoints.append({
                            "path": "(middleware)",
                            "method": "MIDDLEWARE",
                            "handler": node.name,
                            "file": rel,
                            "line": node.lineno,
                            "always_live": True,
                        })
                        continue
                    full_path = path or "/"
                endpoints.append({
                    "path": full_path,
                    "method": verb.upper(),
                    "handler": node.name,
                    "file": rel,
                    "line": node.lineno,
                    "always_live": verb == "websocket",  # WS connection is generic
                })

        # WS event handlers (extracted from `if event == "..."` branches).
        for event_name, enclosing in _extract_ws_event_branches(tree):
            ws_events.append({
                "event": event_name,
                "handler_function": enclosing,
                "file": rel,
            })

    (SCRATCH_DIR / "endpoints.json").write_text(json.dumps(endpoints, indent=2))
    (SCRATCH_DIR / "ws_events.json").write_text(json.dumps(ws_events, indent=2))
    _print(f"endpoints: {len(endpoints)} HTTP routes, {len(ws_events)} WS events -> endpoints.json + ws_events.json")


# ---------------------------------------------------------------------------
# Phase 5: caller index
# ---------------------------------------------------------------------------

_CONST_RE = re.compile(
    r"""
    \b(?:const|let|var)\s+
    (?P<name>[A-Z][A-Z_0-9]+)\s*
    (?::\s*[^=]+?)?\s*
    =\s*
    (?:
        `(?P<tpl>[^`\n]*)`
      | "(?P<dbl>[^"\n]*)"
      | '(?P<sgl>[^'\n]*)'
    )
    """,
    re.VERBOSE,
)


def _resolve_template_constants(text: str) -> str:
    """Inline `${UPPER_CASE_NAME}` references using locally-defined string consts.

    Frontend code aliases path roots like:
        const API_BASE = `http://${host}:${port}/api`;
        const DASHBOARDS_API = `${API_BASE}/dashboards`;
        await fetch(`${DASHBOARDS_API}/${id}/generate-name`, ...);

    Without resolution, the literal text never contains `/api/dashboards/.../generate-name`
    contiguously, so the endpoint matcher misses it. We inline UPPER_CASE
    consts to a fixed point so the resolved text contains the full URL.

    Limited to file-local consts. Names imported from other files are
    not resolved (fine for this codebase's convention). Plain `${var}`
    occurrences whose name doesn't match a const stay as-is — the
    endpoint matcher's path-param regex tolerates them.
    """
    constants = {}
    for m in _CONST_RE.finditer(text):
        constants[m.group("name")] = m.group("tpl") or m.group("dbl") or m.group("sgl") or ""
    if not constants:
        return text
    # Resolve constants transitively so chains like FOO -> BAR -> BAZ flatten.
    for _ in range(8):
        changed = False
        for name, val in list(constants.items()):
            new_val = val
            for k, v in constants.items():
                if k == name:
                    continue
                placeholder = "${" + k + "}"
                if placeholder in new_val:
                    new_val = new_val.replace(placeholder, v)
            if new_val != val:
                constants[name] = new_val
                changed = True
        if not changed:
            break
    out = text
    for name, val in constants.items():
        out = out.replace("${" + name + "}", val)
    return out


def cmd_callers(_args) -> None:
    """Read every frontend/electron/backend file once into a flat blob.

    The match phase will scan this blob for endpoint paths. Re-reading
    every file per endpoint would be O(endpoints * files); this is O(files)
    once, then O(endpoints) regex searches over a single big string.
    """
    _ensure_scratch()
    files: list[dict] = []
    for root in CALLER_SEARCH_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            s = str(p)
            if any(k in s for k in CALLER_SKIP_SUBSTRINGS):
                continue
            if p.suffix not in CALLER_FILE_EXTS:
                continue
            try:
                text = p.read_text(errors="ignore")
            except OSError:
                continue
            # For .ts/.tsx/.js/.jsx files, also store a constant-resolved
            # variant so the endpoint matcher catches paths assembled via
            # `${API_BASE}/...` templates.
            resolved = text if p.suffix == ".py" else _resolve_template_constants(text)
            files.append({
                "path": str(p.relative_to(REPO_ROOT)),
                "text": text,
                "resolved": resolved,
            })
    (SCRATCH_DIR / "callers.json").write_text(json.dumps(files))
    total_chars = sum(len(f["text"]) for f in files)
    _print(f"callers: indexed {len(files)} files ({total_chars / 1024:.0f} KB) -> callers.json")


# ---------------------------------------------------------------------------
# Phase 6: match endpoints to callers
# ---------------------------------------------------------------------------

_TRAILING_PARAM_RE = re.compile(r"(?:/\{[^}]+\})+$")


def _endpoint_to_path_regexes(path: str) -> list[re.Pattern]:
    """Build regex patterns matching this path in caller text.

    Backend path uses `{name}` for params; frontend uses `${name}` template
    literals or substituted strings, so we replace `{name}` with a
    pattern matching any non-slash, non-quote chunk. We emit several forms:
      - Full `/api/...` path (some callers use literal /api/...)
      - Path with leading `/api/` stripped (most callers prepend
        ${API_BASE} which already contains `/api`, so the URL substring
        is just `/<rest>...`)
      - For paths ending in `/{param}`: a prefix-only variant that drops
        trailing path params. Catches Python callers that store the
        prefix as `BACKEND_URL = ".../api/foo"` then build the final URL
        with `f"{BACKEND_URL}/{action}"` at call time - the literal
        `/api/foo/<segment>` never appears contiguously, but `/api/foo`
        does.
    """
    if not path or path == "/":
        return []

    def _to_regex(p: str) -> re.Pattern:
        parts = re.split(r"\{[^}]+\}", p)
        param_pat = r"[^/'\"`\s]+?"
        body = param_pat.join(re.escape(part) for part in parts)
        return re.compile(body)

    out = [_to_regex(path)]

    pruned = _TRAILING_PARAM_RE.sub("", path)
    if pruned and pruned != path:
        out.append(_to_regex(pruned))

    if path.startswith("/api/"):
        stripped = path[len("/api"):]
        if stripped:
            out.append(_to_regex(stripped))
        if pruned and pruned != path and pruned.startswith("/api/"):
            stripped_pruned = pruned[len("/api"):]
            if stripped_pruned:
                out.append(_to_regex(stripped_pruned))
    return out


def cmd_match(_args) -> None:
    _ensure_scratch()
    endpoints = _safe_load_json(SCRATCH_DIR / "endpoints.json", [])
    ws_events = _safe_load_json(SCRATCH_DIR / "ws_events.json", [])
    callers_blob = _safe_load_json(SCRATCH_DIR / "callers.json", [])
    if not callers_blob:
        _print("callers.json missing or empty - run `callers` first")
        sys.exit(1)

    # Build a per-file dict for caller lookups, then a combined haystack
    # for cheap "any caller?" checks. Use the const-resolved variant for
    # endpoint matching so that `${DASHBOARDS_API}/${id}/generate-name`
    # correctly resolves to a literal `/api/dashboards/<id>/generate-name`
    # before we regex-search.
    caller_paths = [c["path"] for c in callers_blob]
    caller_texts = [c.get("resolved") or c["text"] for c in callers_blob]
    caller_raw_texts = [c["text"] for c in callers_blob]
    # For attribution in the report, we want to know WHICH file matched.
    # Rather than join everything, we iterate the caller list with a
    # short-circuit for first match.

    matched: list[dict] = []
    unmatched: list[dict] = []

    for ep in endpoints:
        if ep.get("always_live"):
            matched.append({**ep, "callers": ["<always-live: middleware/ws-handler>"]})
            continue
        path = ep["path"]
        regexes = _endpoint_to_path_regexes(path)
        if not regexes:
            matched.append({**ep, "callers": ["<root path: skipped>"]})
            continue
        callers: list[str] = []
        for caller_path, caller_text in zip(caller_paths, caller_texts):
            # Don't count the route's own definition file as a caller.
            if caller_path == ep["file"]:
                continue
            for rx in regexes:
                if rx.search(caller_text):
                    callers.append(caller_path)
                    break
            if len(callers) >= 5:
                break  # 5 is enough for the report
        if callers:
            matched.append({**ep, "callers": callers})
        else:
            unmatched.append(ep)

    # WS events: just look for the literal event string in the RAW text
    # (we don't want the constant resolver to munge event-name string
    # literals).
    ws_matched: list[dict] = []
    ws_unmatched: list[dict] = []
    for ev in ws_events:
        # Skip server->client patterns ("server:hello", "agent:status",
        # etc.) — those aren't callable BY the frontend, the backend
        # broadcasts them. We only want events the frontend SENDS to the
        # backend, which is what a WS event handler matches against.
        callers: list[str] = []
        for caller_path, caller_raw in zip(caller_paths, caller_raw_texts):
            if caller_path == ev["file"]:
                continue
            for quoted in (f'"{ev["event"]}"', f"'{ev['event']}'", f"`{ev['event']}`"):
                if quoted in caller_raw:
                    callers.append(caller_path)
                    break
            if len(callers) >= 5:
                break
        if callers:
            ws_matched.append({**ev, "callers": callers})
        else:
            ws_unmatched.append(ev)

    (SCRATCH_DIR / "endpoints_matched.json").write_text(json.dumps(matched, indent=2))
    (SCRATCH_DIR / "endpoints_unmatched.json").write_text(json.dumps(unmatched, indent=2))
    (SCRATCH_DIR / "ws_events_matched.json").write_text(json.dumps(ws_matched, indent=2))
    (SCRATCH_DIR / "ws_events_unmatched.json").write_text(json.dumps(ws_unmatched, indent=2))
    _print(f"match: {len(matched)} matched / {len(unmatched)} dead HTTP endpoints")
    _print(f"match: {len(ws_matched)} matched / {len(ws_unmatched)} dead WS events")


# ---------------------------------------------------------------------------
# Phase 7: rank
# ---------------------------------------------------------------------------

def _collect_decorated_function_names(file_path: Path) -> set[str]:
    out: set[str] = set()
    try:
        tree = ast.parse(file_path.read_text())
    except (OSError, SyntaxError):
        return out
    fastapi_verbs = {"get", "post", "put", "patch", "delete", "head", "options",
                     "websocket", "middleware", "route", "include_router"}

    def _decorator_attr(dec: ast.expr) -> str | None:
        if isinstance(dec, ast.Call):
            dec = dec.func
        if isinstance(dec, ast.Attribute):
            return dec.attr
        return None

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                attr = _decorator_attr(dec)
                if attr in fastapi_verbs:
                    out.add(node.name)
                    break
    return out


def _build_test_to_imports() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for p in _iter_test_py_files():
        try:
            tree = ast.parse(p.read_text())
        except SyntaxError:
            continue
        cur_pkg = _path_to_module(p) or "backend.tests"
        deps = _collect_imports_from_ast(tree, cur_pkg)
        backend_deps = {d for d in deps if d.startswith("backend.")}
        out[str(p.relative_to(REPO_ROOT))] = backend_deps
    return out


def _grep_repo_for_module_string(mod: str) -> list[str]:
    matches: list[str] = []
    pattern = re.compile(re.escape(mod))
    search_roots = [
        REPO_ROOT / "electron",
        REPO_ROOT / "frontend",
        REPO_ROOT / "scripts",
        REPO_ROOT / ".github",
    ]
    for root in search_roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            s = str(p)
            if any(k in s for k in CALLER_SKIP_SUBSTRINGS):
                continue
            if p.suffix not in {".py", ".js", ".ts", ".tsx", ".sh", ".ps1", ".json", ".yml", ".yaml", ".md", ".toml"}:
                continue
            try:
                if pattern.search(p.read_text(errors="ignore")):
                    matches.append(str(p.relative_to(REPO_ROOT)))
            except Exception:
                continue
    return matches


def cmd_rank(_args) -> None:
    _ensure_scratch()
    reach = _safe_load_json(SCRATCH_DIR / "reachable_modules.json", {"reachable": [], "unreachable": [], "roots": []})
    vulture = _safe_load_json(SCRATCH_DIR / "vulture.json", [])
    ruff = _safe_load_json(SCRATCH_DIR / "ruff.json", [])
    endpoints_dead = _safe_load_json(SCRATCH_DIR / "endpoints_unmatched.json", [])
    endpoints_alive = _safe_load_json(SCRATCH_DIR / "endpoints_matched.json", [])
    ws_dead = _safe_load_json(SCRATCH_DIR / "ws_events_unmatched.json", [])
    ws_alive = _safe_load_json(SCRATCH_DIR / "ws_events_matched.json", [])

    reachable: set[str] = set(reach.get("reachable") or [])
    unreachable: list[str] = list(reach.get("unreachable") or [])
    roots: list[str] = list(reach.get("roots") or [])

    # ------------------------------------------------------------------
    # Tier 0 - unreachable files
    # ------------------------------------------------------------------
    tier0: list[dict] = []
    for mod in unreachable:
        path = _module_to_path(mod)
        if path is None:
            continue
        rel = str(path.relative_to(REPO_ROOT))
        tier0.append({
            "module": mod,
            "path": rel,
            "lines": _line_count(path),
        })
    tier0.sort(key=lambda d: -d["lines"])

    # ------------------------------------------------------------------
    # Tier 1 - dead endpoints (no caller anywhere)
    # ------------------------------------------------------------------
    # Group dead endpoints by file for readability.
    dead_by_file: dict[str, list[dict]] = defaultdict(list)
    for ep in endpoints_dead:
        dead_by_file[ep["file"]].append(ep)
    tier1_files = sorted(dead_by_file.keys())
    tier1_count = len(endpoints_dead)
    # ws dead events — aggregate too.
    dead_ws_by_file: dict[str, list[dict]] = defaultdict(list)
    for ev in ws_dead:
        dead_ws_by_file[ev["file"]].append(ev)

    # ------------------------------------------------------------------
    # Tier 2 - vulture inside reachable modules. Demote FastAPI-decorated
    # functions because vulture can't see decorator-driven registration.
    # Also demote functions that are dead-endpoint handlers (those will
    # already appear in Tier 1, no point listing twice).
    # ------------------------------------------------------------------
    reachable_paths = {str(_module_to_path(m).relative_to(REPO_ROOT)) for m in reachable if _module_to_path(m)}
    decorated_by_path: dict[str, set[str]] = {}
    for path_str in reachable_paths:
        decorated_by_path[path_str] = _collect_decorated_function_names(REPO_ROOT / path_str)

    dead_handler_keys = {(ep["file"], ep["handler"]) for ep in endpoints_dead}

    fn_msg_re = re.compile(r"unused (?:function|method|class) '([^']+)'")

    def _vulture_fn_name(finding: dict) -> str | None:
        m = fn_msg_re.search(finding["message"])
        return m.group(1) if m else None

    tier2_high: list[dict] = []
    tier2_mid: list[dict] = []
    tier2_demoted_handler = 0
    tier2_demoted_dead_endpoint = 0
    for v in vulture:
        if v["path"] not in reachable_paths:
            continue
        if v["confidence"] < 60:
            continue
        fn_name = _vulture_fn_name(v)
        if fn_name and fn_name in decorated_by_path.get(v["path"], set()):
            tier2_demoted_handler += 1
            continue
        if fn_name and (v["path"], fn_name) in dead_handler_keys:
            tier2_demoted_dead_endpoint += 1
            continue
        if v["confidence"] >= 90:
            tier2_high.append(v)
        else:
            tier2_mid.append(v)

    # ------------------------------------------------------------------
    # Tier 3 - ruff F401/F811/F841
    # ------------------------------------------------------------------
    by_path: dict[str, list[dict]] = defaultdict(list)
    for f in ruff:
        by_path[f["path"]].append(f)

    # ------------------------------------------------------------------
    # Tier 4 - dead tests (import-based + string-based)
    # ------------------------------------------------------------------
    test_imports = _build_test_to_imports()
    dead_module_set = {e["module"] for e in tier0}
    tier4_dead_full: list[dict] = []
    tier4_partial: list[dict] = []
    for test_path, deps in test_imports.items():
        if not deps:
            continue
        resolved = set()
        for d in deps:
            if _module_to_path(d):
                resolved.add(d)
            else:
                parent, _, _ = d.rpartition(".")
                if parent and _module_to_path(parent):
                    resolved.add(parent)
        if not resolved:
            continue
        bad = resolved & dead_module_set
        if not bad:
            continue
        if bad == resolved:
            tier4_dead_full.append({"path": test_path, "imports": sorted(resolved)})
        else:
            tier4_partial.append({
                "path": test_path,
                "dead_imports": sorted(bad),
                "live_imports": sorted(resolved - bad),
            })

    # String-based: tests mentioning a Tier-0 module name in their text.
    tier4_string: list[dict] = []
    dead_leaf_names = {m.split(".")[-1] for m in dead_module_set if "." in m}
    dead_leaf_names -= {"models", "__init__", "__main__"}
    if dead_leaf_names:
        for test_path in sorted(test_imports):
            try:
                text = (REPO_ROOT / test_path).read_text(errors="ignore")
            except OSError:
                continue
            hits = sorted({leaf for leaf in dead_leaf_names if leaf in text})
            if hits:
                tier4_string.append({"path": test_path, "dead_module_leaves": hits})

    # ------------------------------------------------------------------
    # Validation: cross-repo grep on Tier 0 to catch string-form imports
    # ------------------------------------------------------------------
    demoted: list[dict] = []
    for entry in tier0[:20]:
        hits = _grep_repo_for_module_string(entry["module"])
        if hits:
            demoted.append({**entry, "external_refs": hits})
    demoted_paths = {d["path"] for d in demoted}
    tier0 = [e for e in tier0 if e["path"] not in demoted_paths]

    # ------------------------------------------------------------------
    # Render the report
    # ------------------------------------------------------------------
    lines: list[str] = []
    lines.append("# Dead code report\n")
    lines.append(
        "Generated by `backend/scripts/dead_code_scan.py`. "
        "**Test coverage was deliberately ignored** - a test exercising a "
        "function does not prove anything in production calls it. Liveness "
        "is determined by (1) static reachability from production import "
        "roots and (2) whether at least one frontend/electron/internal "
        "caller references the endpoint by string.\n"
    )

    lines.append("## Summary\n")
    lines.append(f"- Production roots scanned: **{len(roots)}**")
    lines.append(f"- Reachable backend modules: **{len(reachable)}**")
    lines.append(f"- HTTP endpoints found: **{len(endpoints_alive) + len(endpoints_dead)}** ({len(endpoints_alive)} live, **{len(endpoints_dead)} dead**)")
    lines.append(f"- WS events found: **{len(ws_alive) + len(ws_dead)}** ({len(ws_alive)} live, **{len(ws_dead)} dead**)")
    lines.append("")
    lines.append(f"- Tier 0 (unreachable files): **{len(tier0)}**")
    lines.append(f"- Tier 1 (dead endpoints): **{tier1_count}** HTTP + **{len(ws_dead)}** WS")
    lines.append(f"- Tier 2 (vulture, reachable modules): **{len(tier2_high) + len(tier2_mid)}** "
                 f"(handlers auto-demoted: **{tier2_demoted_handler}**, dead-endpoint handlers: **{tier2_demoted_dead_endpoint}**)")
    lines.append(f"- Tier 3 (ruff F401/F811/F841): **{len(ruff)}**")
    lines.append(f"- Tier 4 (dead tests): fully **{len(tier4_dead_full)}**, partial **{len(tier4_partial)}**, string-ref **{len(tier4_string)}**")
    lines.append(f"- Demoted by validation: **{len(demoted)}**\n")

    lines.append("## Roots used for reachability\n")
    for r in roots:
        lines.append(f"- `{r}`")
    lines.append("")

    # Tier 0
    lines.append("## Tier 0 - Unreachable files\n")
    lines.append("Modules under `backend/` not reachable from any production root. Strongest dead-code signal.\n")
    if not tier0:
        lines.append("_None._\n")
    else:
        lines.append("| Lines | Path | Module |")
        lines.append("|---:|---|---|")
        for e in tier0:
            lines.append(f"| {e['lines']} | `{e['path']}` | `{e['module']}` |")
        lines.append("")

    # Tier 1
    lines.append("## Tier 1 - Dead endpoints (no caller in frontend/electron/internal)\n")
    lines.append(
        "HTTP routes and WS events the backend exposes but no frontend, "
        "Electron main process, or internal HTTP-issuing module references "
        "by string. Match algorithm: regex-search `frontend/src/`, "
        "`electron/`, and `backend/` for the endpoint path with `{params}` "
        "replaced by `[^/'\\\"`\\\\s]+?`. False positives: endpoints whose path is "
        "constructed dynamically (e.g. via a path builder constant) - check "
        "the per-file lists below before deleting.\n"
    )

    if not endpoints_dead and not ws_dead:
        lines.append("_None._\n")
    else:
        if tier1_files:
            lines.append("### Dead HTTP endpoints\n")
            lines.append("| File | Method | Path | Handler |")
            lines.append("|---|---|---|---|")
            for f in tier1_files:
                for ep in dead_by_file[f]:
                    lines.append(f"| `{ep['file']}:{ep['line']}` | {ep['method']} | `{ep['path']}` | `{ep['handler']}` |")
            lines.append("")
        if dead_ws_by_file:
            lines.append("### Dead WebSocket events\n")
            lines.append("These are `if event == \"...\"` branches the backend handles but no frontend code sends.\n")
            lines.append("| File | Event | Enclosing handler |")
            lines.append("|---|---|---|")
            for f in sorted(dead_ws_by_file):
                for ev in dead_ws_by_file[f]:
                    lines.append(f"| `{ev['file']}` | `{ev['event']}` | `{ev['handler_function']}` |")
            lines.append("")

    # Tier 2
    lines.append("## Tier 2 - Vulture flags inside reachable modules\n")
    if not (tier2_high or tier2_mid):
        lines.append("_None._\n")
    else:
        if tier2_high:
            lines.append("### High confidence (>=90%)\n")
            lines.append("| Path:Line | Confidence | Message |")
            lines.append("|---|---:|---|")
            for v in tier2_high:
                lines.append(f"| `{v['path']}:{v['line']}` | {v['confidence']}% | {v['message']} |")
            lines.append("")
        if tier2_mid:
            lines.append("### Manual review (60-89%)\n")
            lines.append("Pydantic field defs cluster here. FastAPI route handlers and dead-endpoint handlers are auto-demoted.\n")
            lines.append("| Path:Line | Confidence | Message |")
            lines.append("|---|---:|---|")
            for v in tier2_mid:
                lines.append(f"| `{v['path']}:{v['line']}` | {v['confidence']}% | {v['message']} |")
            lines.append("")

    # Tier 3
    lines.append("## Tier 3 - Unused imports & locals (ruff F401/F811/F841)\n")
    if not ruff:
        lines.append("_None._\n")
    else:
        lines.append(f"Auto-fixable by `ruff check --fix --select F401,F811,F841 backend/`. {len(ruff)} findings across {len(by_path)} files.\n")
        lines.append("<details><summary>Per-file breakdown</summary>\n")
        for path in sorted(by_path):
            items = by_path[path]
            lines.append(f"\n**`{path}`** ({len(items)} findings)\n")
            for it in items:
                lines.append(f"- L{it['line']} `{it['code']}`: {it['message']}")
        lines.append("\n</details>\n")

    # Tier 4
    lines.append("## Tier 4 - Dead tests\n")
    lines.append(
        "A test is dead if every backend module it imports is in Tier 0, "
        "or if it references a Tier-0 module by string (e.g. tests an HTTP "
        "endpoint of a SubApp that's been removed from `MainApp([...])`). "
        "Delete these alongside the production code.\n"
    )
    if not tier4_dead_full and not tier4_partial and not tier4_string:
        lines.append("_None._\n")
    else:
        if tier4_dead_full:
            lines.append("### Fully dead (every imported backend module is dead)\n")
            lines.append("| Test file | Imports |")
            lines.append("|---|---|")
            for e in tier4_dead_full:
                imps = ", ".join(f"`{i}`" for i in e["imports"][:5])
                if len(e["imports"]) > 5:
                    imps += f", _+{len(e['imports']) - 5} more_"
                lines.append(f"| `{e['path']}` | {imps} |")
            lines.append("")
        if tier4_partial:
            lines.append("### Partially dead (some imports dead, some live)\n")
            lines.append("| Test file | Dead imports | Live imports |")
            lines.append("|---|---|---|")
            for e in tier4_partial[:50]:
                dead = ", ".join(f"`{i}`" for i in e["dead_imports"][:3])
                if len(e["dead_imports"]) > 3:
                    dead += f", _+{len(e['dead_imports']) - 3}_"
                live = ", ".join(f"`{i}`" for i in e["live_imports"][:3])
                if len(e["live_imports"]) > 3:
                    live += f", _+{len(e['live_imports']) - 3}_"
                lines.append(f"| `{e['path']}` | {dead} | {live} |")
            lines.append("")
        if tier4_string:
            lines.append("### References dead module by string (likely tests an endpoint that no longer registers)\n")
            lines.append("| Test file | Dead module references |")
            lines.append("|---|---|")
            for e in tier4_string:
                refs = ", ".join(f"`{n}`" for n in e["dead_module_leaves"])
                lines.append(f"| `{e['path']}` | {refs} |")
            lines.append("")

    if demoted:
        lines.append("## Demoted candidates (referenced from outside backend/)\n")
        lines.append("These look unreachable from Python imports but a string reference exists in `electron/`, `frontend/`, `scripts/`, or `.github/`. Investigate before deleting.\n")
        lines.append("| Path | Module | External refs |")
        lines.append("|---|---|---|")
        for e in demoted:
            refs = ", ".join(f"`{r}`" for r in e["external_refs"][:3])
            if len(e["external_refs"]) > 3:
                refs += f", _+{len(e['external_refs']) - 3}_"
            lines.append(f"| `{e['path']}` | `{e['module']}` | {refs} |")
        lines.append("")

    lines.append("## Caveats\n")
    lines.append(
        "- **Tests are not consulted.** A function exercised only by tests is still flagged.\n"
        "- **Endpoint matcher is pattern-based.** It looks for the path "
        "(both with and without the `/api/` prefix) as a substring in "
        "frontend/electron/backend caller files, with path params replaced "
        "by `[^/'\\\"`\\\\s]+?`. False positives can happen if a frontend "
        "constructs URLs piecewise (e.g. `${API_BASE}/${kind}/${id}`); "
        "double-check the dead list before deleting.\n"
        "- **Reachability is static.** `getattr(mod, name)` and other "
        "fully-dynamic dispatch is invisible to it. The walker does follow "
        "literal-string `importlib.import_module(...)` and `__import__(...)` "
        "args plus `python -m <module>` strings across the repo.\n"
    )

    out_path = SCRATCH_DIR / "dead-code-report.md"
    out_path.write_text("\n".join(lines))
    _print(f"wrote {out_path.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------------------
# `all` subcommand
# ---------------------------------------------------------------------------

def cmd_all(args) -> None:
    cmd_reach(args)
    cmd_vulture(args)
    cmd_ruff(args)
    cmd_endpoints(args)
    cmd_callers(args)
    cmd_match(args)
    cmd_rank(args)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, fn in [
        ("reach", cmd_reach),
        ("vulture", cmd_vulture),
        ("ruff", cmd_ruff),
        ("endpoints", cmd_endpoints),
        ("callers", cmd_callers),
        ("match", cmd_match),
        ("rank", cmd_rank),
        ("all", cmd_all),
    ]:
        p = sub.add_parser(name, help=(fn.__doc__ or name).splitlines()[0])
        p.set_defaults(func=fn)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
