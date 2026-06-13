"""Knip unused-code runner for the TypeScript frontend."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from . import CheckError, is_lintignored

_TIMEOUT = 120

KIND_LABELS = {
    "dependencies": "Unused dependency",
    "devDependencies": "Unused devDependency",
    "exports": "Unused export",
    "types": "Unused exported type",
    "unlisted": "Unlisted dependency",
    "binaries": "Unused binary",
    "files": "Unused file",
    "duplicates": "Duplicate export",
}


def run_knip(root: Path, ignores: dict[Path, set[str]] | None = None) -> list[str]:
    """Run Knip on the TypeScript frontend and return errors."""
    frontend_dir = root / "frontend"
    knip_bin = frontend_dir / "node_modules" / ".bin" / "knip"
    if not knip_bin.exists():
        raise CheckError("knip binary not found (run npm install in frontend/)")

    cmd = [str(knip_bin), "--reporter", "json"]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=str(frontend_dir), timeout=_TIMEOUT,
        )
    except subprocess.TimeoutExpired as e:
        raise CheckError(f"timed out after {_TIMEOUT}s") from e
    except OSError as e:
        raise CheckError(f"failed to launch knip ({e})") from e

    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError) as e:
        detail = result.stderr.strip()[:300] or "non-JSON output"
        raise CheckError(f"knip produced unparseable output: {detail}") from e

    errors: list[str] = []
    for entry in data.get("issues", []):
        filepath = entry.get("file", "")
        rel = f"frontend/{filepath}"
        abs_path = root / rel
        if ignores and is_lintignored(abs_path, root, "knip", ignores):
            continue
        for kind, label in KIND_LABELS.items():
            for item in entry.get(kind, []):
                if isinstance(item, dict):
                    name = item.get("name", "")
                    line = item.get("line", 1)
                    col = item.get("col", 1)
                elif isinstance(item, str):
                    name = item
                    line, col = 1, 1
                else:
                    continue
                errors.append(
                    f"{rel}:{line}:{col}: error: "
                    f"[knip] {label} '{name}'"
                )
    return errors
