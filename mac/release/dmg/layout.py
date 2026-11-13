#!/usr/bin/env python3 -I
"""Writes the Finder window layout of PS.dmg (.DS_Store) on the mounted, still writable image.

  python3 -I release/dmg/layout.py <mount point>

No Finder, no AppleScript, no window on screen: the .DS_Store is written directly with ds_store and
mac_alias (MIT, Alastair Houghton, vendored in tools/vendor, the libraries dmgbuild uses).
640 x 400 window, no toolbar or sidebar, background .background/background.tiff, the app left and the
Applications shortcut right, where make-background.swift draws the arrow between them.
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "vendor"))
from ds_store import DSStore  # noqa: E402
from mac_alias import Alias  # noqa: E402

mnt = sys.argv[1]
bg = os.path.join(mnt, ".background", "background.tiff")
for need in (bg, os.path.join(mnt, "PS app.app"), os.path.join(mnt, "Applications")):
    if not os.path.lexists(need):
        sys.exit("layout.py: missing " + need)

with DSStore.open(os.path.join(mnt, ".DS_Store"), "w+") as d:
    d["."]["bwsp"] = {
        "WindowBounds": "{{200, 120}, {640, 428}}", "ShowStatusBar": False, "ShowToolbar": False,
        "ShowTabView": False, "ShowPathbar": False, "ShowSidebar": False, "ContainerShowSidebar": False,
        "PreviewPaneVisibility": False, "SidebarWidth": 0,
    }
    d["."]["icvp"] = {
        "viewOptionsVersion": 1, "backgroundType": 2, "backgroundImageAlias": Alias.for_file(bg).to_bytes(),
        "backgroundColorRed": 1.0, "backgroundColorGreen": 1.0, "backgroundColorBlue": 1.0,
        "arrangeBy": "none", "gridOffsetX": 0.0, "gridOffsetY": 0.0, "gridSpacing": 100.0,
        "iconSize": 112.0, "textSize": 13.0, "labelOnBottom": True, "showIconPreview": False, "showItemInfo": False,
        "scrollPositionX": 0.0, "scrollPositionY": 0.0,
    }
    d["."]["icvl"] = ("type", b"icnv")
    d["."]["vSrn"] = ("long", 1)
    d["PS app.app"]["Iloc"] = (170, 190)
    d["Applications"]["Iloc"] = (470, 190)
print("layout.py: PS.dmg window laid out")
