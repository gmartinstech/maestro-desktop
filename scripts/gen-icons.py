#!/usr/bin/env python3
"""Regenerate every Maestro Studio icon surface from the vendored brand PNGs.

Source of truth is `assets/brand/maestro/maestro-*.png`, vendored from the
MartinsTech design-system skill (its SKILL.md designates the Maestro robot as
the product app icon; `mt-logo-*` is the company mark and is NOT used here).

Usage:
  backend/.venv/Scripts/python.exe scripts/gen-icons.py     # Windows
  backend/.venv/bin/python scripts/gen-icons.py             # macOS/Linux

Needs only Pillow, which the backend venv already provides. Rerun this after
replacing the files in assets/brand/maestro/ to propagate a brand refresh.
"""
import struct
import sys
from pathlib import Path
from typing import Dict, List

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
BRAND = REPO / "assets" / "brand" / "maestro"

# Hand-tuned small sizes ship with the brand kit; anything else is resampled from 512.
SOURCE_SIZES = [16, 32, 48, 96, 180, 512]

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
FAVICON_SIZES = [16, 32, 48]

# ICNS OSType -> pixel size. ic13/ic14 are the @2x retina slots, hence the doubled data.
ICNS_TYPES = {
    "ic11": 32,
    "ic12": 64,
    "ic07": 128,
    "ic08": 256,
    "ic13": 512,
    "ic09": 512,
}


def load_sources() -> Dict[int, Image.Image]:
    """Load every vendored brand PNG as RGBA, keyed by pixel size."""
    sources = {}
    for size in SOURCE_SIZES:
        path = BRAND / f"maestro-{size}.png"
        if not path.exists():
            sys.exit(f"missing brand source: {path}")
        sources[size] = Image.open(path).convert("RGBA")
    return sources


def render(sources: Dict[int, Image.Image], size: int) -> Image.Image:
    """Return the icon at `size`, preferring an exact hand-tuned source over resampling."""
    if size in sources:
        return sources[size].copy()
    # Downscale from the largest source rather than up from a small one, to keep edges clean.
    return sources[512].resize((size, size), Image.LANCZOS)


def write_png(sources: Dict[int, Image.Image], target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    render(sources, size).save(target, format="PNG")
    print(f"  {target.relative_to(REPO)}  ({size}px)")


def write_ico(sources: Dict[int, Image.Image], target: Path, sizes: List[int]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    base = render(sources, max(sizes))
    base.save(target, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  {target.relative_to(REPO)}  ({'/'.join(str(s) for s in sizes)})")


def write_icns(sources: Dict[int, Image.Image], target: Path) -> None:
    """Write an ICNS container by hand.

    Pillow can only SAVE icns on macOS (it shells out to iconutil), so the
    container is assembled directly: 'icns' magic + total length, then one
    entry per slot of 4-byte OSType + 4-byte length (header inclusive) + PNG
    payload. Modern macOS accepts PNG data in the ic07..ic14 slots.
    """
    entries = b""
    for ostype, size in ICNS_TYPES.items():
        from io import BytesIO

        buf = BytesIO()
        render(sources, size).save(buf, format="PNG")
        payload = buf.getvalue()
        entries += ostype.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload
    blob = b"icns" + struct.pack(">I", len(entries) + 8) + entries
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)
    print(f"  {target.relative_to(REPO)}  ({'/'.join(ICNS_TYPES)})")


def main() -> None:
    sources = load_sources()
    print(f"Maestro robot icons from {BRAND.relative_to(REPO)}")

    # Electron packaging + runtime window/taskbar/dock icon.
    write_png(sources, REPO / "electron" / "build" / "icon.png", 512)
    write_ico(sources, REPO / "electron" / "build" / "icon.ico", ICO_SIZES)
    write_icns(sources, REPO / "electron" / "build" / "icon.icns")

    # Splash ships its own copy: build/ is outside the asar in packaged builds.
    write_png(sources, REPO / "electron" / "splash" / "icon.png", 512)

    # Repo-level asset.
    write_png(sources, REPO / "assets" / "icon.png", 512)

    # Web surfaces.
    write_ico(sources, REPO / "frontend" / "public" / "favicon.ico", FAVICON_SIZES)
    write_png(sources, REPO / "frontend" / "public" / "apple-touch-icon.png", 180)
    write_png(sources, REPO / "frontend" / "public" / "logo.png", 512)

    # In-app brand mark; rendered ~20px, so 96 covers 2x/3x displays.
    write_png(sources, REPO / "frontend" / "public" / "maestro-mark.png", 96)

    print("done")


if __name__ == "__main__":
    main()
