#!/bin/bash
# Makes PS.dmg for a Mac that has no PS yet (31 Oct 2026): the app and an Applications shortcut on a
# picture that says "Drag PS app to Applications", so nobody runs it from the disk image or Downloads
# (that breaks updates). Double-clicking it there still opens the Install screen (Installer.swift).
# V1.49 (the developer, 12 Nov 2026: the app is called "PS app" for everyone): the volume is "PS app" and the app
# inside it is "PS app.app". The file stays PS.dmg: its address (cincee.com/client/ps/PS.dmg) is in links.
#   make-dmg.sh <PS.app> <out.dmg>
# A writable image is mounted hidden (-nobrowse), filled, laid out by layout.py (no Finder), then
# compressed. Called by release/publish.sh; nothing of the developer's goes in (release/audit.py checks it).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="${1:?usage: make-dmg.sh <PS.app> <out.dmg>}"; OUT="${2:?out.dmg}"
# The picture's words are public copy (the developer approves them first): until release/dmg/approved.json holds
# this exact picture's SHA-256 (approve.sh), PS.dmg is made as before: the app alone, no picture.
if [ "$(sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' "$HERE/approved.json" 2>/dev/null)" != "$(shasum -a 256 "$HERE/background.tiff" | cut -d' ' -f1)" ]; then
  echo "make-dmg.sh: the DMG picture is not approved by the developer yet (release/dmg/approve.sh show): plain PS.dmg"
  STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
  ditto --noqtn --norsrc "$APP" "$STAGE/PS app.app"
  hdiutil create -quiet -volname "PS app" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT"
  exit 0
fi
TMP="$(mktemp -d)"; MNT=""
cleanup() { if [ -n "$MNT" ]; then hdiutil detach -quiet "$MNT" 2>/dev/null || hdiutil detach -quiet -force "$MNT" 2>/dev/null || true; fi; rm -rf "$TMP"; }
trap cleanup EXIT

SIZE=$(( $(du -sm "$APP" | cut -f1) + 16 ))
hdiutil create -quiet -size "${SIZE}m" -fs HFS+ -volname "PS app" -ov "$TMP/rw.dmg"
MNT="$(hdiutil attach -nobrowse -noautoopen -noverify "$TMP/rw.dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
[ -d "$MNT" ] || { echo "make-dmg.sh: could not mount the image"; exit 1; }
ditto --noqtn --norsrc "$APP" "$MNT/PS app.app"
ln -s /Applications "$MNT/Applications"
mkdir "$MNT/.background"
cp "$HERE/background.tiff" "$MNT/.background/background.tiff"
python3 -I "$HERE/layout.py" "$MNT"
rm -rf "$MNT/.fseventsd" "$MNT/.Trashes"
sync
hdiutil detach -quiet "$MNT"; MNT=""
hdiutil convert -quiet "$TMP/rw.dmg" -format UDZO -imagekey zlib-level=9 -ov -o "$OUT"
