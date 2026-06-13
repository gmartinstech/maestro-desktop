"""Vulture dead-code detection runner.

Scoped to whole-program reachability only: dead functions, methods, classes,
and attributes. Unused imports and unused local variables are dropped here and
owned by ruff (F401/F841), whose per-file scope analysis is strictly more
accurate than vulture's global name-set matching (which hides an import that is
dead in one file whenever the same name is used in any other file).

Class-body findings (fields, methods inside a class) are filtered out here
and handled separately by checks/classes.py which understands Pydantic.
"""

from __future__ import annotations

import ast
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from . import CheckError, is_excepted, is_lintignored

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

# Generous so the first run after a window reload (editor startup load) does not
# time out and get reported as zero findings.
_TIMEOUT = 120


@lru_cache(maxsize=256)
def _class_line_ranges_cached(filepath: str, _mtime: float) -> list[tuple[int, int]]:
    """Return (start, end) line ranges for all class bodies in *filepath*.

    Keyed on *(filepath, mtime)* so the long-lived watch process re-parses a file
    after it is edited instead of returning stale ranges from an earlier version.
    """
    try:
        tree = ast.parse(Path(filepath).read_text())
    except (OSError, SyntaxError):
        return []
    ranges: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            end = max(getattr(n, "lineno", node.lineno) for n in ast.walk(node))
            ranges.append((node.lineno, end))
    return ranges


def _class_line_ranges(filepath: str) -> list[tuple[int, int]]:
    try:
        mtime = Path(filepath).stat().st_mtime
    except OSError:
        return []
    return _class_line_ranges_cached(filepath, mtime)


def _is_inside_class(filepath: str, lineno: int) -> bool:
    """True when *lineno* is strictly inside a class body.

    The class declaration line itself (``class Foo:``) is *not* considered
    inside, so vulture's "unused class" findings still pass through.
    """
    return any(start < lineno <= end for start, end in _class_line_ranges(filepath))


def run_vulture(
    root: Path, min_confidence: int, error_threshold: int,
    exceptions: dict[str, list[str]],
    ignores: dict[Path, set[str]] | None = None,
) -> list[str]:
    """Run vulture on the Python backend and return errors."""
    vulture_bin = root / "backend" / ".venv" / "bin" / "vulture"
    if not vulture_bin.exists():
        found = shutil.which("vulture")
        if not found:
            raise CheckError("vulture executable not found in backend/.venv/bin or PATH")
        vulture_bin = Path(found)

    whitelist = CONFIG_DIR / "vulture_whitelist.py"
    targets = ["backend"]
    if (root / "debug.py").exists():
        targets.append("debug.py")
    cmd = [str(vulture_bin), *targets]
    if whitelist.exists():
        cmd.append(str(whitelist))
    cmd.extend([
        "--min-confidence", str(min_confidence),
        "--exclude", ".venv,__pycache__,data,uv-bin",
        "--ignore-decorators", "@*.router.*,@*.websocket,@app.*,@pytest.fixture,@pytest.fixture*",
        "--ignore-names", "cls",
    ])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, cwd=str(root), timeout=_TIMEOUT,
        )
    except subprocess.TimeoutExpired as e:
        raise CheckError(f"timed out after {_TIMEOUT}s (machine under load or large tree)") from e
    except OSError as e:
        raise CheckError(f"failed to launch vulture ({e})") from e

    # vulture exits 0 (clean) or 1 (findings) on success; a higher code with no
    # findings on stdout means vulture errored — surface it rather than reporting
    # an empty result as "clean".
    if result.returncode not in (0, 1) and not result.stdout.strip():
        detail = result.stderr.strip()[:300] or "no output"
        raise CheckError(f"vulture exited with code {result.returncode}: {detail}")

    errors: list[str] = []
    for line in result.stdout.strip().splitlines():
        m = re.match(r"^(.+):(\d+): (.+)$", line)
        if not m:
            continue
        filepath, lineno, message = m.groups()
        # Imports and local variables are ruff's domain (F401/F841); skip them
        # here so we don't double-report and so vulture's weaker import logic
        # never gets a vote.
        if re.search(r"unused (import|variable)", message):
            continue
        if is_excepted(filepath, "vulture", exceptions):
            continue
        if ignores and is_lintignored(root / filepath, root, "vulture", ignores):
            continue
        if _is_inside_class(str(root / filepath), int(lineno)):
            continue
        conf = re.search(r"\((\d+)% confidence\)", message)
        confidence = int(conf.group(1)) if conf else 0
        severity = "error" if confidence >= error_threshold else "warning"
        errors.append(f"{filepath}:{lineno}:1: {severity}: [vulture] {message}")
    return errors
