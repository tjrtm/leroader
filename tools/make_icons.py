"""Generate Leroader toolbar icons (on/off) at 16/32/48/128 px.

Run: python3 tools/make_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024  # supersampled canvas

THEMES = {
    "on": {"bg": (25, 26, 29, 255), "ring": (58, 209, 156, 255), "dot": (236, 236, 239, 255)},
    "off": {"bg": (25, 26, 29, 255), "ring": (120, 123, 132, 255), "dot": (120, 123, 132, 255)},
}


def draw(theme):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = S * 0.02
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.24, fill=theme["bg"])

    cx = cy = S / 2
    r = S * 0.29
    w = S * 0.105
    # Arc clockwise from 300° (upper right gap) around to 230°... PIL angles: 0 = 3 o'clock, clockwise.
    start, end = -50, 250
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start, end=end, fill=theme["ring"], width=int(w))

    # Arrow head at the arc end, pointing along the clockwise tangent.
    a = math.radians(end)
    rm = r - w / 2  # centre-line radius of the stroke
    ex, ey = cx + rm * math.cos(a), cy + rm * math.sin(a)
    tx, ty = -math.sin(a), math.cos(a)  # clockwise tangent (screen coords)
    nx, ny = math.cos(a), math.sin(a)  # outward normal
    L, B = S * 0.16, S * 0.14
    tip = (ex + tx * L, ey + ty * L)
    b1 = (ex + nx * B - tx * S * 0.02, ey + ny * B - ty * S * 0.02)
    b2 = (ex - nx * B - tx * S * 0.02, ey - ny * B - ty * S * 0.02)
    d.polygon([tip, b1, b2], fill=theme["ring"])

    # Centre dot = "the page".
    dr = S * 0.075
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=theme["dot"])
    return img


def main():
    OUT.mkdir(exist_ok=True)
    for name, theme in THEMES.items():
        big = draw(theme)
        for size in (16, 32, 48, 128):
            big.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"{name}-{size}.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
