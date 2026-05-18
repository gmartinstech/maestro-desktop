#!/usr/bin/env python3
"""Generate macOS/Windows tray PNG assets at base + @2x resolution.

The tray icons are template images on macOS, so we draw in solid black
with full alpha and let the OS invert for dark/light menubars. Three
states:
  idle    - small filled circle (a pinpoint)
  running - radial "fire" with two overlapping circles
  paused  - two vertical bars (the classic pause glyph)

Sizes: 16x16 base + 32x32 @2x. Output dir: electron/assets/.

Re-run with: python3 scripts/generate-tray-icons.py
"""

import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "electron", "assets")
os.makedirs(OUT_DIR, exist_ok=True)


def draw_idle(d: ImageDraw.ImageDraw, size: int) -> None:
    cx, cy = size // 2, size // 2
    r = size * 5 // 16
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0, 0, 0, 255))


def draw_running(d: ImageDraw.ImageDraw, size: int) -> None:
    cx, cy = size // 2, size // 2
    r = size * 7 // 16
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(0, 0, 0, 255), width=max(1, size // 14))
    inner = size * 3 // 16
    d.ellipse((cx - inner, cy - inner, cx + inner, cy + inner), fill=(0, 0, 0, 255))


def draw_paused(d: ImageDraw.ImageDraw, size: int) -> None:
    w = size * 3 // 16
    h = size * 9 // 16
    gap = size * 2 // 16
    left_x = size // 2 - gap // 2 - w
    right_x = size // 2 + gap // 2
    top = (size - h) // 2
    d.rectangle((left_x, top, left_x + w, top + h), fill=(0, 0, 0, 255))
    d.rectangle((right_x, top, right_x + w, top + h), fill=(0, 0, 0, 255))


DRAWERS = {"idle": draw_idle, "running": draw_running, "paused": draw_paused}


def render(state: str, size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    DRAWERS[state](ImageDraw.Draw(img), size)
    return img


for state in DRAWERS:
    img1x = render(state, 16)
    img2x = render(state, 32)
    img1x.save(os.path.join(OUT_DIR, f"tray-{state}.png"), "PNG")
    img2x.save(os.path.join(OUT_DIR, f"tray-{state}@2x.png"), "PNG")
    print(f"wrote tray-{state}.png + tray-{state}@2x.png")
