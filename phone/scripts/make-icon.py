#!/usr/bin/env python3
"""PS GOS app icon from the PS 1.60 logo (~/Projects/ps/mac/icon/icon-1024.png), as an adaptive icon.

  python3 scripts/make-icon.py

Writes app/src/main/res/mipmap-*/ic_launcher_{front,mono}.png (the background is the colour ic_launcher_back,
the logo's own light grey, in values/colors.xml):
  front  the whole logo, unchanged, scaled to half the 108 dp canvas (54 dp) and centred. Its farthest pixel is
         608 of 1024 px from the centre, so every part of it (rounded corners too) sits inside the 66 dp safe
         circle and no launcher mask crops it.
  mono   the logo's own PS strokes (its darker grey pixels) as one flat shape in the same place, for themed icons
         (the launcher tints it).
"""
import os
from PIL import Image

SRC = os.path.expanduser("~/Projects/ps/mac/icon/icon-1024.png")
RES = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
CANVAS_DP, LOGO_DP = 108, 54

src = Image.open(SRC).convert("RGBA")
# The letters: the logo's stroke grey is about (156, 175, 184); the disc, tile and faint rings are all lighter.
lum = src.convert("L")
letters = lum.point(lambda v: 255 if v < 190 else 0)
alpha = src.getchannel("A")
mono_mask = Image.composite(letters, Image.new("L", src.size, 0), alpha.point(lambda a: 255 if a > 128 else 0))
mono_src = Image.new("RGBA", src.size, (255, 255, 255, 0))
mono_src.putalpha(mono_mask)

for name, k in DENSITIES.items():
    canvas, logo = round(CANVAS_DP * k), round(LOGO_DP * k)
    off = (canvas - logo) // 2
    for kind, img in (("front", src), ("mono", mono_src)):
        out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        out.paste(img.resize((logo, logo), Image.LANCZOS), (off, off))
        d = os.path.join(RES, f"mipmap-{name}")
        os.makedirs(d, exist_ok=True)
        out.save(os.path.join(d, f"ic_launcher_{kind}.png"), optimize=True)
print("make-icon: wrote ic_launcher_front and ic_launcher_mono for", ", ".join(DENSITIES))
