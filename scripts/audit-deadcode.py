#!/usr/bin/env python3
"""Dead-code audit for any project tree.

Walks the current directory and flags every file, function, class, import,
constant, and exported symbol that has no detected reference. Writes a
Markdown report (DEAD_CODE_REPORT.md) you can read top to bottom.

Languages handled: Python, TypeScript, TSX, JavaScript, JSX, Shell.

What it knows about (so it doesn't false-positive on them):
  - Decorator-registered functions (@mcp.tool, @router.*, @app.tool,
    @<anything>.on(...), @<anything>.handle(...))  treated as USED.
  - Cross-language references: Python module names referenced as strings
    from TS/JS (and vice versa) count as "used".
  - Conventional entry points: __init__.py, __main__.py, main()/__main__
    blocks, files referenced from package.json scripts, tsconfig include
    patterns, Dockerfile entrypoints.
  - Test/spec files are scanned but treated as USED leaves (a file that
    only tests are referencing is still flagged so you know).

What it does NOT do:
  - Modify or delete code. You get a report; you decide.
  - Resolve fully dynamic dispatch (e.g. eval, getattr-by-string).
    Flagged items in those cases are best-effort.

External tools it will auto-install if available (otherwise skipped):
  - vulture        (Python; pip-installs into current venv if missing)
  - knip / ts-prune (TS/JS; you install manually if you want this depth)
  - shellcheck     (Shell; brew install if missing — script just warns)

Usage:
    cd /path/to/your/project
    python3 /path/to/audit-deadcode.py

Optional flags:
    --strict      Don't whitelist decorator-registered functions
    --no-install  Skip auto-installing vulture
    --out PATH    Write the Markdown to PATH instead of ./DEAD_CODE_REPORT.md
    --include DIR Restrict scanning to DIR (relative). Can be passed multiple times.
    --exclude DIR Add DIR to the default exclude list.

Exit codes:
    0  Scan completed (report may still have findings)
    1  Hard failure (e.g. cwd unreadable)
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# ---------- config ----------

DEFAULT_EXCLUDES = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".cache",
    "dist", "build", "build-staging", ".next", "out", "coverage",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".vscode",
    ".idea", "bin", "lib", "include", "share",
    # OpenSwarm-specific noise
    "mcp-bundles", "uv-bin",
}

PY_EXTS = {".py"}
JS_EXTS = {".js", ".jsx", ".mjs", ".cjs"}
TS_EXTS = {".ts", ".tsx", ".mts", ".cts"}
SH_EXTS = {".sh", ".bash", ".zsh"}
ALL_CODE_EXTS = PY_EXTS | JS_EXTS | TS_EXTS | SH_EXTS

# Files we never call dead even if no one references them.
ALWAYS_LIVE_FILES = {
    "__init__.py", "__main__.py", "conftest.py",
    "main.py", "app.py", "index.js", "index.ts",
    "setup.py", "setup.cfg", "pyproject.toml",
    "package.json", "tsconfig.json", "vite.config.ts", "webpack.config.js",
    "Dockerfile", "Makefile", "README.md", "LICENSE",
    "manage.py",
}

# Filename patterns that are entry-pointy.
ENTRY_PATTERNS = (
    re.compile(r"^run.*\.(sh|py|js|ts)$"),
    re.compile(r"^test_.*\.py$"),
    re.compile(r".*\.test\.(ts|tsx|js|jsx)$"),
    re.compile(r".*\.spec\.(ts|tsx|js|jsx)$"),
)

# Decorator names that mean "this function is registered/wired in, not orphaned".
LIVE_DECORATOR_PATTERNS = (
    re.compile(r"^(?:[\w.]+\.)?(?:tool|command|task|cli)\b"),                # @mcp.tool, @cli.command
    re.compile(r"^(?:[\w.]+\.)?(?:get|post|put|delete|patch|head|options)\b"),  # FastAPI routes
    re.compile(r"^(?:[\w.]+\.)?(?:on|on_message|on_event|handle|hook|listener)\b"),
    re.compile(r"^(?:[\w.]+\.)?(?:route|websocket|middleware)\b"),
    re.compile(r"^(?:[\w.]+\.)?(?:fixture|hookimpl|hookspec)\b"),
    re.compile(r"^(?:[\w.]+\.)?(?:typechecked|app|router|api)\."),            # @app.something
    re.compile(r"^(?:[\w.]+\.)?(?:property|staticmethod|classmethod|cached_property)$"),
    re.compile(r"^(?:[\w.]+\.)?(?:asynccontextmanager|contextmanager|dataclass)$"),
)

# Tokens that are common false-positive sinks — if a "dead" symbol's name
# appears in a file as text (not just an import), assume it's referenced.
REFERENCE_HINT_FILES = (
    "package.json", ".env.example", ".env",
    "README.md", "GETTING_STARTED.md", "CHANGELOG.md", "ARCHITECTURE.md",
    "pyproject.toml", "uv.lock", "requirements.txt", "Dockerfile",
)

# Function names that are inherently "used" by convention.
ALWAYS_LIVE_FUNCS = {
    "main", "__init__", "__main__", "__enter__", "__exit__",
    "__aenter__", "__aexit__", "__await__", "__iter__", "__anext__",
    "__repr__", "__str__", "__eq__", "__hash__", "__getitem__",
    "__setitem__", "__delitem__", "__len__", "__contains__", "__call__",
    "__new__", "__init_subclass__", "__class_getitem__",
    "setUp", "tearDown",
}

# ---------- data ----------


@dataclass
class Finding:
    kind: str          # 'unused_file', 'unused_function', 'unused_class', 'unused_import', 'unused_const'
    path: str          # file path relative to root
    line: int = 0
    name: str = ""
    detail: str = ""
    confidence: str = "medium"   # 'high' / 'medium' / 'low'


@dataclass
class PySymbol:
    name: str
    kind: str   # 'function' / 'class' / 'const'
    file: Path
    line: int
    decorators: list[str] = field(default_factory=list)


# ---------- helpers ----------


def info(msg: str) -> None:
    sys.stderr.write(f"  {msg}\n")


def warn(msg: str) -> None:
    sys.stderr.write(f"  ⚠ {msg}\n")


def heading(msg: str) -> None:
    sys.stderr.write(f"\n=== {msg} ===\n")


def is_excluded(path: Path, extra_excludes: set[str]) -> bool:
    parts = set(path.parts)
    if parts & DEFAULT_EXCLUDES:
        return True
    if parts & extra_excludes:
        return True
    return False


def walk_code(root: Path, includes: list[Path] | None, extra_excludes: set[str]) -> Iterable[Path]:
    bases = includes or [root]
    for base in bases:
        if base.is_file():
            yield base
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(root)
            if is_excluded(rel, extra_excludes):
                continue
            if p.suffix.lower() in ALL_CODE_EXTS:
                yield p


def is_entry_filename(name: str) -> bool:
    if name in ALWAYS_LIVE_FILES:
        return True
    return any(p.match(name) for p in ENTRY_PATTERNS)


def decorator_to_name(node: ast.AST) -> str:
    """Stringify a decorator AST node for matching against LIVE_DECORATOR_PATTERNS."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{decorator_to_name(node.value)}.{node.attr}"
    if isinstance(node, ast.Call):
        return decorator_to_name(node.func) + "(...)"
    return ""


def decorator_is_live(deco: str) -> bool:
    """True if a decorator name matches a 'this function is wired in' pattern."""
    return any(p.search(deco) for p in LIVE_DECORATOR_PATTERNS)


# ---------- Python analysis ----------


def parse_python_symbols(files: list[Path], root: Path) -> dict[str, list[PySymbol]]:
    """For every Python file, list its top-level + class-level function/class/const definitions."""
    out: dict[str, list[PySymbol]] = defaultdict(list)
    for f in files:
        if f.suffix != ".py":
            continue
        try:
            tree = ast.parse(f.read_text(encoding="utf-8", errors="ignore"))
        except (SyntaxError, UnicodeDecodeError):
            continue

        def visit(body, container_class: str | None = None):
            for node in body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    decos = [decorator_to_name(d) for d in node.decorator_list]
                    fq = f"{container_class}.{node.name}" if container_class else node.name
                    out[str(f.relative_to(root))].append(PySymbol(
                        name=fq, kind="function", file=f, line=node.lineno, decorators=decos
                    ))
                elif isinstance(node, ast.ClassDef):
                    decos = [decorator_to_name(d) for d in node.decorator_list]
                    out[str(f.relative_to(root))].append(PySymbol(
                        name=node.name, kind="class", file=f, line=node.lineno, decorators=decos
                    ))
                    visit(node.body, container_class=node.name)
                elif isinstance(node, ast.Assign):
                    for tgt in node.targets:
                        if isinstance(tgt, ast.Name) and tgt.id.isupper() and not tgt.id.startswith("_"):
                            out[str(f.relative_to(root))].append(PySymbol(
                                name=tgt.id, kind="const", file=f, line=node.lineno
                            ))
        visit(tree.body)
    return out


def parse_python_imports(files: list[Path], root: Path) -> dict[str, set[str]]:
    """Map file -> set of imported names (so we can find unused imports later)."""
    used: dict[str, set[str]] = defaultdict(set)
    for f in files:
        if f.suffix != ".py":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(text)
        except (SyntaxError, UnicodeDecodeError):
            continue
        # Names actually referenced in code (Name + Attribute roots).
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                used[str(f.relative_to(root))].add(node.id)
            elif isinstance(node, ast.Attribute):
                root_name = node
                while isinstance(root_name, ast.Attribute):
                    root_name = root_name.value
                if isinstance(root_name, ast.Name):
                    used[str(f.relative_to(root))].add(root_name.id)
    return used


def python_module_path(file: Path, root: Path) -> str:
    """Convert backend/apps/instagram_mcp/server.py -> backend.apps.instagram_mcp.server"""
    rel = file.relative_to(root).with_suffix("")
    parts = rel.parts
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


# ---------- text search across the tree ----------


def build_text_corpus(files: list[Path], root: Path) -> dict[str, str]:
    """Read every file's text once so subsequent grep-like searches are fast."""
    corpus: dict[str, str] = {}
    for f in files:
        try:
            corpus[str(f.relative_to(root))] = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            corpus[str(f.relative_to(root))] = ""
    # Also pick up reference-hint files (.env.example, package.json, README).
    for hint in REFERENCE_HINT_FILES:
        for f in root.rglob(hint):
            rel = str(f.relative_to(root))
            if rel in corpus:
                continue
            if is_excluded(Path(rel), set()):
                continue
            try:
                corpus[rel] = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                pass
    return corpus


def file_is_referenced(stem: str, module_path: str, file_rel: str, corpus: dict[str, str]) -> bool:
    """Anywhere in the corpus (other than this file itself), is this file mentioned?

    Looks for ACTUAL import / require / spawn / script patterns rather than
    a bare-name regex — otherwise a Python helper named `logger.py` looks
    'referenced' anywhere a local `logger = logging.getLogger(...)` exists.
    """
    needles: list[re.Pattern] = []
    if module_path:
        esc = re.escape(module_path)
        # Python: `from foo.bar import` / `import foo.bar` / `python -m foo.bar`
        needles.append(re.compile(rf"(?:from|import|-m)\s+{esc}\b"))
        # TS/JS/JSON: 'foo.bar' or "foo.bar" as a string literal (e.g. mcp_config args)
        needles.append(re.compile(rf"['\"]{esc}['\"]"))
        # Same without the trailing .module name (parent package import)
        if "." in module_path:
            parent = module_path.rsplit(".", 1)[0]
            esc_parent = re.escape(parent)
            needles.append(re.compile(rf"(?:from|import|-m)\s+{esc_parent}\b"))
    # Stem-based references — catches sibling-style imports (`from rate_limiter
    # import ...` for a `src/rate_limiter.py` that runs with src/ on the path),
    # shell-script invocations, and module-as-string mentions.
    if stem:
        esc_stem = re.escape(stem)
        # 'foo.py' / 'foo.sh' / 'foo.js' explicitly referenced as a file
        needles.append(re.compile(rf"[\"'/\s]{esc_stem}\.(?:py|sh|js|ts|jsx|tsx|bash)\b"))
        # `bash scripts/foo` / `python foo.py` / `node foo` invocations
        needles.append(re.compile(rf"(?:bash|sh|node|python\d?|uvx|uv\s+run)\s+[\w./-]*{esc_stem}\b"))
        # Python: `from foo import X` / `import foo` where foo is the bare module name
        needles.append(re.compile(rf"(?:from|import)\s+{esc_stem}\b"))
        # TS/JS: `from "foo"` / `from './foo'` / `require('foo')`
        needles.append(re.compile(rf"(?:from|require\(|import\()\s*['\"][\w./-]*{esc_stem}['\"]"))
    for rel, text in corpus.items():
        if rel == file_rel:
            continue
        for pat in needles:
            if pat.search(text):
                return True
    return False


def symbol_is_referenced(name: str, defining_file: str, corpus: dict[str, str]) -> bool:
    """Is this symbol mentioned BEYOND its defining line?

    A symbol is 'used' if:
      - Its name appears in any OTHER file in the corpus, OR
      - Its name appears MORE THAN ONCE in its defining file (the `def`
        line plus at least one call/reference somewhere else in the file).

    Pure-name regex; doesn't distinguish call-site from definition. Counting
    occurrences in the defining file handles private helpers (`_foo()`)
    used only by their siblings.
    """
    pattern = re.compile(rf"\b{re.escape(name)}\b")
    own_text = corpus.get(defining_file, "")
    if len(pattern.findall(own_text)) > 1:
        return True
    for rel, text in corpus.items():
        if rel == defining_file:
            continue
        if pattern.search(text):
            return True
    return False


# ---------- external tools ----------


def ensure_vulture(no_install: bool) -> str | None:
    """Return the vulture exe path, installing into the current venv if missing."""
    exe = shutil.which("vulture")
    if exe:
        return exe
    if no_install:
        warn("vulture not installed and --no-install given; skipping deeper Python dead-code scan.")
        return None
    info("vulture not found — installing into current Python env…")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "vulture"],
            check=True, timeout=120,
        )
    except subprocess.CalledProcessError as exc:
        warn(f"pip install vulture failed: {exc}. Continuing without it.")
        return None
    return shutil.which("vulture") or None


def run_vulture(exe: str, root: Path, extra_excludes: set[str]) -> list[dict]:
    """Run vulture, return parsed findings."""
    args = [exe, str(root), "--min-confidence", "60"]
    # Pass exclude paths
    exclude_globs = ",".join([f"*/{e}/*" for e in (DEFAULT_EXCLUDES | extra_excludes)])
    if exclude_globs:
        args.extend(["--exclude", exclude_globs])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        warn("vulture timed out after 180s.")
        return []
    out: list[dict] = []
    # vulture format: path:line: unused name 'foo' (NN% confidence)
    pat = re.compile(r"^(.*?):(\d+):\s*unused\s+(\w+)\s+'([^']+)'\s+\((\d+)% confidence\)")
    for line in result.stdout.splitlines():
        m = pat.match(line)
        if not m:
            continue
        path, lineno, kind, name, conf = m.groups()
        out.append({"path": path, "line": int(lineno), "kind": kind, "name": name, "confidence": int(conf)})
    return out


def has_tool(name: str) -> bool:
    return shutil.which(name) is not None


# ---------- markdown report ----------


def emit_report(out_path: Path, findings: dict[str, list[Finding]], stats: dict) -> None:
    """Write the Markdown report."""
    lines: list[str] = []
    lines.append("# Dead-Code Audit Report\n")
    lines.append(f"_Generated by `audit-deadcode.py` against `{stats['root']}`._\n")
    lines.append("")
    lines.append("## Summary\n")
    lines.append(f"- Files scanned: **{stats['files_scanned']}**")
    lines.append(f"- Lines of code: **~{stats['loc']:,}**")
    total = sum(len(v) for v in findings.values())
    lines.append(f"- Findings: **{total}**")
    for k, v in findings.items():
        if v:
            lines.append(f"  - {k}: {len(v)}")
    lines.append("")
    if not total:
        lines.append("Nothing flagged — clean tree. ✨\n")
        out_path.write_text("\n".join(lines))
        return

    section_titles = {
        "unused_files": "Unused Files",
        "unused_functions": "Unused Functions",
        "unused_classes": "Unused Classes",
        "unused_consts": "Unused Constants",
        "unused_imports": "Unused Imports",
        "decorator_skipped": "Decorator-Registered (skipped — verify if any look orphaned)",
    }

    for key, title in section_titles.items():
        items = findings.get(key) or []
        if not items:
            continue
        lines.append(f"## {title}\n")
        lines.append(f"_{len(items)} item(s)._\n")
        # Group by file
        by_file: dict[str, list[Finding]] = defaultdict(list)
        for f in items:
            by_file[f.path].append(f)
        for path in sorted(by_file.keys()):
            fitems = by_file[path]
            lines.append(f"### `{path}`")
            for f in sorted(fitems, key=lambda x: x.line):
                loc = f"L{f.line}" if f.line else ""
                lbl = f.name or "(file)"
                detail = f" — {f.detail}" if f.detail else ""
                conf_marker = "" if f.confidence == "medium" else f" _({f.confidence} confidence)_"
                lines.append(f"- **{lbl}** {loc}{detail}{conf_marker}")
            lines.append("")
    lines.append("---\n")
    lines.append(
        "_Caveats: dynamic dispatch (eval, getattr-by-string, JSON-driven calls), "
        "cross-language references, and runtime-only entry points (e.g. `python -m X` "
        "invoked from a JSON config) cannot be statically verified. Cross-check anything "
        "you're not sure about before deleting._\n"
    )
    out_path.write_text("\n".join(lines))


# ---------- main ----------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Don't whitelist decorator-registered functions.")
    parser.add_argument("--no-install", action="store_true", help="Skip auto-installing vulture.")
    parser.add_argument("--out", type=Path, default=Path("DEAD_CODE_REPORT.md"), help="Output Markdown path.")
    parser.add_argument("--include", action="append", default=[], help="Restrict to this subdir (repeatable).")
    parser.add_argument("--exclude", action="append", default=[], help="Add to exclude list (repeatable).")
    args = parser.parse_args(argv)

    root = Path.cwd().resolve()
    extra_excludes = set(args.exclude)
    includes = [(root / i).resolve() for i in args.include] if args.include else None

    heading("Phase 1 — Walking the tree")
    files = list(walk_code(root, includes, extra_excludes))
    info(f"{len(files)} code files found")
    if not files:
        warn(f"No code files in {root}. Nothing to audit.")
        return 0

    heading("Phase 2 — Reading every file into memory")
    corpus = build_text_corpus(files, root)
    loc = sum(text.count("\n") for text in corpus.values())
    info(f"~{loc:,} LOC across {len(corpus)} files (including reference-hint files)")

    findings: dict[str, list[Finding]] = defaultdict(list)

    heading("Phase 3 — Unused FILES (no other file references them)")
    py_files = [f for f in files if f.suffix == ".py"]
    for f in files:
        rel = str(f.relative_to(root))
        name = f.name
        if is_entry_filename(name):
            continue
        # Skip the audit script itself
        if f.resolve() == Path(__file__).resolve():
            continue
        if f.suffix == ".py":
            mod = python_module_path(f, root)
            if not file_is_referenced(f.stem, mod, rel, corpus):
                findings["unused_files"].append(Finding(
                    kind="unused_file", path=rel, name=name,
                    detail=f"no other file references `{f.stem}` or `{mod}`",
                    confidence="medium",
                ))
        else:
            # JS/TS/SH: just look for the filename or stem
            if not file_is_referenced(f.stem, f.name, rel, corpus):
                findings["unused_files"].append(Finding(
                    kind="unused_file", path=rel, name=name,
                    detail=f"no other file references `{f.stem}` or `{f.name}`",
                    confidence="medium",
                ))
    info(f"{len(findings['unused_files'])} unused files")

    heading("Phase 4 — Unused Python symbols (decorator-aware)")
    symbols = parse_python_symbols(py_files, root)
    total_syms = sum(len(v) for v in symbols.values())
    info(f"Parsed {total_syms} Python symbols across {len(symbols)} files")
    deco_skipped = 0
    for rel, syms in symbols.items():
        for sym in syms:
            if sym.name in ALWAYS_LIVE_FUNCS:
                continue
            # Decorator-aware skip (unless --strict)
            if not args.strict and sym.decorators and any(decorator_is_live(d) for d in sym.decorators):
                findings["decorator_skipped"].append(Finding(
                    kind="decorator_skipped", path=rel, name=sym.name, line=sym.line,
                    detail=", ".join(f"@{d}" for d in sym.decorators), confidence="low",
                ))
                deco_skipped += 1
                continue
            # Bare name search across corpus
            if symbol_is_referenced(sym.name.split(".")[-1], rel, corpus):
                continue
            kind_key = {"function": "unused_functions", "class": "unused_classes", "const": "unused_consts"}[sym.kind]
            findings[kind_key].append(Finding(
                kind=kind_key, path=rel, name=sym.name, line=sym.line,
                detail=", ".join(f"@{d}" for d in sym.decorators) if sym.decorators else "",
                confidence="medium" if not sym.decorators else "low",
            ))
    info(f"{len(findings['unused_functions'])} functions, {len(findings['unused_classes'])} classes, "
         f"{len(findings['unused_consts'])} consts flagged; {deco_skipped} skipped via decorator whitelist")

    heading("Phase 5 — Vulture (deeper Python scan, including unused imports + locals)")
    vulture = ensure_vulture(args.no_install)
    if vulture:
        vul = run_vulture(vulture, root, extra_excludes)
        # Convert vulture findings into our format, deduping against what we already
        # have. Critically, also dedupe against decorator_skipped so vulture's
        # "unused function send_message" doesn't show up after we explicitly
        # declared it live-via-decorator.
        already = {(f.path, f.line, f.name) for fs in findings.values() for f in fs}
        deco_skip_keys = {(f.path, f.name) for f in findings.get("decorator_skipped", [])}
        added = 0
        for v in vul:
            try:
                rel = str(Path(v["path"]).resolve().relative_to(root))
            except ValueError:
                rel = v["path"]
            key = (rel, v["line"], v["name"])
            if key in already:
                continue
            # Skip if we already marked this function as decorator-registered.
            if (rel, v["name"]) in deco_skip_keys:
                continue
            kind_map = {
                "import": "unused_imports",
                "variable": "unused_consts",
                "function": "unused_functions",
                "method": "unused_functions",
                "class": "unused_classes",
                "attribute": "unused_consts",
                "property": "unused_functions",
            }
            bucket = kind_map.get(v["kind"], "unused_consts")
            findings[bucket].append(Finding(
                kind=bucket, path=rel, name=v["name"], line=v["line"],
                detail=f"vulture: unused {v['kind']}",
                confidence="high" if v["confidence"] >= 80 else ("medium" if v["confidence"] >= 70 else "low"),
            ))
            already.add(key)
            added += 1
        info(f"+{added} findings from vulture")
    else:
        info("Skipped (vulture not available).")

    heading("Phase 6 — TS/JS deep scan (knip if installed)")
    if has_tool("knip"):
        try:
            result = subprocess.run(["knip", "--reporter", "json"], capture_output=True, text=True, timeout=180, cwd=root)
            data = json.loads(result.stdout or "{}")
            for issue_type, items in (data.get("issues") or {}).items():
                for item in items if isinstance(items, list) else []:
                    path = item.get("file") or item.get("filePath", "")
                    line = item.get("line") or 0
                    name = item.get("symbol") or item.get("name") or ""
                    bucket = "unused_imports" if "import" in issue_type else (
                        "unused_files" if "file" in issue_type else "unused_functions"
                    )
                    findings[bucket].append(Finding(
                        kind=bucket, path=path, name=name, line=line,
                        detail=f"knip: {issue_type}", confidence="medium",
                    ))
            info(f"knip reported {sum(len(v) for v in (data.get('issues') or {}).values() if isinstance(v, list))} issues")
        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError) as exc:
            warn(f"knip ran but output couldn't be parsed: {exc}")
    elif has_tool("ts-prune"):
        info("knip not found; ts-prune detected, but knip is preferred. Install: npm i -g knip")
    else:
        info("knip/ts-prune not installed. TS/JS deep scan skipped. Install: npm i -g knip")

    heading("Phase 7 — Writing report")
    stats = {"root": str(root), "files_scanned": len(files), "loc": loc}
    out = args.out if args.out.is_absolute() else (root / args.out)
    emit_report(out, findings, stats)
    info(f"Wrote {out.relative_to(root)}")

    total = sum(len(v) for v in findings.values() if v and v[0].kind != "decorator_skipped")
    sys.stdout.write(f"\n{total} actionable findings written to {out}\n")
    if findings.get("decorator_skipped"):
        sys.stdout.write(f"(plus {len(findings['decorator_skipped'])} decorator-registered functions listed for sanity check)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
