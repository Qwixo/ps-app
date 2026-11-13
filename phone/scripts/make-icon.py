#!/usr/bin/env python3
"""PS GOS app icon from the Mac one (~/Projects/ps/mac/icon/icon-1024.png), as an adaptive icon.

  python3 scripts/make-icon.py

Writes app/src/main/res/mipmap-*/ic_launcher_{front,mono}.png (the background is a colour):
  front  the Mac painting (storm, lightning, silver PS), full bleed: no tile, no rounded corners,
         no blur; the PS keeps about its Mac size and sits inside the 66 dp safe circle
  mono   PS as one flat serif shape in the same place, for themed icons (the launcher tints it)
Every launcher mask (circle, squircle, rounded square) then shows all of the letters.
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.expanduser("~/Projects/ps/mac/icon/icon-1024.png")
RES = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")
LETTERS = (268, 288, 760, 706)      # the box round the P and the S, in source pixels
P_BOX, S_BOX = (268, 288, 560, 670), (470, 378, 760, 706)
CANVAS_DP = 108.0

src = Image.open(SRC).convert("RGBA")

# Full bleed (the developer, 27 Oct 2026: the ACTUAL logo, no inner tile, no rounded corners, no blur): the
# painting itself fills the canvas. The visible 72 dp of the 108 dp canvas shows VIEW, a square cut
# from the Mac tile inside its rounded corners, so the letters keep about the size they have on the
# Mac (0.65 of the shape against 0.60 there) and stay inside the 66 dp safe circle. The 18 dp of
# bleed round it (only seen when a launcher moves or masks oddly) is the painting mirrored outwards.
VIEW = (132, 132, 892, 892)
v = VIEW[2] - VIEW[0]
pad = int(round(v * (CANVAS_DP - 72) / 72 / 2))       # 18 dp each side, in source pixels
size = v + 2 * pad
ox, oy = VIEW[0] - pad, VIEW[1] - pad
crop = src.crop(VIEW).convert("RGB")
front = Image.new("RGB", (size, size))
front.paste(crop, (pad, pad))
flip_x, flip_y = crop.transpose(Image.FLIP_LEFT_RIGHT), crop.transpose(Image.FLIP_TOP_BOTTOM)
both = crop.transpose(Image.ROTATE_180)
for (tx, ty, img) in ((-1, 0, flip_x), (1, 0, flip_x), (0, -1, flip_y), (0, 1, flip_y), (-1, -1, both), (1, -1, both), (-1, 1, both), (1, 1, both)):
    front.paste(img, (pad + tx * v, pad + ty * v))
front = front.convert("RGBA")
# The letters' box must sit inside the safe circle: check, do not trust.
cxv, cyv = size / 2, size / 2
far = max(((x - ox - cxv) ** 2 + (y - oy - cyv) ** 2) ** 0.5 for x in (LETTERS[0], LETTERS[2]) for y in (LETTERS[1], LETTERS[3]))
r_dp = far * CANVAS_DP / size
assert r_dp <= 33.0, f"letters reach {r_dp:.1f} dp from the centre, past the 33 dp safe circle"

# Mono: P and S as one flat shape, set in the same places as the painted letters.
font_path = "/System/Library/Fonts/Supplemental/Baskerville.ttc"
mono_a = Image.new("L", (size, size), 0)
draw = ImageDraw.Draw(mono_a)
for ch, (bx0, by0, bx1, by1) in (("P", P_BOX), ("S", S_BOX)):
    h = by1 - by0
    font = ImageFont.truetype(font_path, 100, index=1)        # Baskerville SemiBold
    l, t, r, b = draw.textbbox((0, 0), ch, font=font)
    font = ImageFont.truetype(font_path, int(100 * h / (b - t)), index=1)
    l, t, r, b = draw.textbbox((0, 0), ch, font=font)
    x = (bx0 + bx1) / 2 - (l + r) / 2 - ox
    draw.text((x, by0 - t - oy), ch, font=font, fill=255)
mono = Image.new("RGBA", (size, size), (255, 255, 255, 0)); mono.putalpha(mono_a)

for d, px in {"mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216, "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432}.items():
    os.makedirs(os.path.join(RES, d), exist_ok=True)
    for old in ("back",):
        p = os.path.join(RES, d, f"ic_launcher_{old}.png")
        if os.path.exists(p): os.remove(p)
    for name, img in (("front", front), ("mono", mono)):
        img.resize((px, px), Image.LANCZOS).save(os.path.join(RES, d, f"ic_launcher_{name}.png"), optimize=True)
print(f"full bleed: view {VIEW}, canvas {size}px, letters reach {r_dp:.1f} dp of the 33 dp safe circle; written to {os.path.normpath(RES)}")
