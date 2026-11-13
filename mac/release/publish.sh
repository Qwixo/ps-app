#!/bin/bash
# Puts a PS release where PS looks for it (Sources/Updater.swift). Called by
# web/scripts/release.sh; never run by a self test.
#   publish.sh web <dist-ps>             a web-only update (the app is not touched)
#   publish.sh app <dist-ps> <PS.app>    an app update (with its web files) plus a fresh PS.dmg
# Writes: updates/PS-web-*.zip, updates/PS-app-*.zip, PS.dmg, then ps-update.json last (the
# signed note, Ed25519, key in signing/update-ed25519.key). Each file goes in as .part then a rename,
# so Drive never syncs half a file.
# Where (27 Oct 2026, public PS):
#   default                  the developer's your sync folder (builds before the cincee.com
#                            channel read only this; it moves them on to it)
#   PS_RELEASE_OUT=<folder>  the public channel's staging folder (web/ps-release, which the
#                            website build copies to cincee.com/client/ps/); also used by tests
#   PS_RELEASE_DRIVE=<folder> the same, kept for older tests
# PS.dmg is the same for everyone: PS.app only. No backgrounds and nothing of the developer's (his videos come
# from his vault after he signs in); release/audit.py checks it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
KIND="${1:?usage: publish.sh web|app <dist-ps> [PS.app]}"
WEB="$(cd "${2:?dist-ps folder}" && pwd)"
APP="${3:-}"
MYDRIVE="$HOME/YOUR_SYNC_FOLDER/"
PS_RELEASE_DRIVE="${PS_RELEASE_OUT:-${PS_RELEASE_DRIVE:-}}"
OUT="${PS_RELEASE_DRIVE:-$MYDRIVE/PS App}"
KEY="$HERE/signing/update-ed25519.key"

if [ -z "${PS_RELEASE_DRIVE:-}" ] && [ ! -d "$MYDRIVE" ]; then
  echo "PS updates: Google Drive is not mounted, skipping the Drive update (the release itself is fine)"; exit 0
fi
[ -f "$KEY" ] || { echo "PS updates: no signing key at $KEY, skipping"; exit 0; }
mkdir -p "$OUT/updates"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TOOL="$HERE/build/pstool"
if [ ! -x "$TOOL" ] || [ "$HERE/tools/pstool.swift" -nt "$TOOL" ]; then mkdir -p "$HERE/build"; swiftc -O "$HERE/tools/pstool.swift" -o "$TOOL"; fi

put() {   # put <file> <name in OUT>: a .part copy, then one rename
  cp "$1" "$OUT/.$(basename "$2").part"
  mv -f "$OUT/.$(basename "$2").part" "$OUT/$2"
}

# The web files (zip root = the dist-ps folder's contents, no extended attributes).
BUILT="$(node -e 'process.stdout.write(require(process.argv[1]).built)' "$WEB/version.json")"
SRC="$(node -e 'process.stdout.write(require(process.argv[1]).src)' "$WEB/version.json")"
# The version the developer sees and its keyword (release.sh writes dist-ps/ps-version.json from
# web/ps-version.json; PS_VERSION and PS_KEYWORD stand in for it in tests).
VER="$(node -e 'try{process.stdout.write(require(process.argv[1]).version||"")}catch(e){}' "$WEB/ps-version.json")"
KW="$(node -e 'try{process.stdout.write(require(process.argv[1]).keyword||"")}catch(e){}' "$WEB/ps-version.json")"
VER="${VER:-${PS_VERSION:-}}"; KW="${KW:-${PS_KEYWORD:-}}"
WEBNAME="updates/PS-web-$(echo "$BUILT" | tr -cd '0-9').zip"
(cd "$WEB" && ditto -c -k --norsrc --noextattr --noqtn . "$TMP/web.zip")
WEBSHA="$("$TOOL" sha256 "$TMP/web.zip")"; WEBSIZE="$(stat -f %z "$TMP/web.zip")"

APPJSON="null"
if [ "$KIND" = app ]; then
  [ -d "$APP" ] || { echo "publish.sh app needs the built PS.app"; exit 1; }
  codesign --verify --strict --deep "$APP"
  BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
  APPNAME="updates/PS-app-$BUILD.zip"
  ditto -c -k --norsrc --noextattr --noqtn --keepParent "$APP" "$TMP/app.zip"
  APPJSON="{\"build\":$BUILD,\"file\":\"$APPNAME\",\"size\":$(stat -f %z "$TMP/app.zip"),\"sha256\":\"$("$TOOL" sha256 "$TMP/app.zip")\"}"
elif [ -f "$OUT/ps-update.json" ] && "$TOOL" verify "$("$TOOL" pub "$KEY")" "$OUT/ps-update.json" >/dev/null; then
  # A web-only release keeps the app entry of the last app release, so a Mac that missed it still gets it.
  APPJSON="$(node -e 'const o=require(process.argv[1]);const p=JSON.parse(Buffer.from(o.signed,"base64"));process.stdout.write(JSON.stringify(p.app??null))' "$OUT/ps-update.json")"
fi

# PS_HISTORY (V1.52): the approved notes of the earlier versions, a JSON list from `ps-public.mjs history-json`
# (last 20, newest first, only words the developer approved), so a Mac updating across several versions can show what every
# skipped version changed. Builds before V1.52 read only the keys they know and skip it.
# PS_NOTES: the developer's APPROVED patch notes only, one per line (release.sh passes `ps-public.mjs notes-text`,
# which prints nothing until he said yes to the exact words). The gear menu shows them under the version.
node -e '
  const [kind, made, app, src, built, file, size, sha, ver, kw, notes, history] = process.argv.slice(1);
  const p = { format: 1, kind, made, app: JSON.parse(app), web: { src, built, file, size: Number(size), sha256: sha } };
  if (!p.app) delete p.app;
  // Older builds read only the keys they know, so they skip these.
  if (ver) p.name = "V" + ver;
  if (ver && kw) p.keyword = kw;
  const lines = (notes || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (lines.some((s) => /[\u2013\u2014<>]/.test(s))) { console.error("publish.sh: a long dash or HTML in the notes"); process.exit(1); }
  if (lines.length) p.notes = lines;
  // The approved notes of the earlier versions. Checked again here: a real version, plain lines, no long dash or HTML;
  // anything else is left out (never a partly shown list), and a bad history never stops a release.
  let hist = [];
  try { hist = JSON.parse(history || "[]"); } catch { hist = []; }
  const ok = (h) => h && /^\d{1,3}\.\d{1,3}$/.test(String(h.version)) && Array.isArray(h.notes) && h.notes.length > 0 && h.notes.length <= 6
    && h.notes.every((n) => typeof n === "string" && n.trim() && n.length <= 220 && !/[\u2013\u2014<>]/.test(n)) && !/[\u2013\u2014<>]/.test(String(h.keyword || ""));
  hist = (Array.isArray(hist) ? hist : []).filter(ok).slice(0, 20).map((h) => ({ version: String(h.version), keyword: String(h.keyword || ""), notes: h.notes.map((n) => n.trim()) }));
  if (hist.length) p.history = hist;
  process.stdout.write(JSON.stringify(p));
' "$KIND" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APPJSON" "$SRC" "$BUILT" "$WEBNAME" "$WEBSIZE" "$WEBSHA" "$VER" "$KW" "${PS_NOTES:-}" "${PS_HISTORY:-[]}" > "$TMP/payload.json"
"$TOOL" sign "$KEY" "$TMP/payload.json" "$TMP/ps-update.json"
"$TOOL" verify "$("$TOOL" pub "$KEY")" "$TMP/ps-update.json" >/dev/null

# The files first, the note last.
put "$TMP/web.zip" "$WEBNAME"
if [ "$KIND" = app ]; then
  put "$TMP/app.zip" "$APPNAME"
  # PS.dmg for a Mac that has no PS yet: PS, an Applications shortcut and a "Drag PS app to Applications"
  # picture (release/dmg/make-dmg.sh, only once the developer approved its words: release/dmg/approve.sh; until then
  # the app alone, as before); double-clicking it there opens its Install screen. V1.49: the volume and the app in the image are called "PS app". The
  # first-open steps for Gatekeeper live on the download page (web ps-download/).
  bash "$HERE/release/dmg/make-dmg.sh" "$APP" "$TMP/PS.dmg"
  put "$TMP/PS.dmg" "PS.dmg"
fi
put "$TMP/ps-update.json" "ps-update.json"

# Old update files: keep what this note and the one before it name, remove the rest.
KEEP="$(node -e 'const o=require(process.argv[1]);const p=JSON.parse(Buffer.from(o.signed,"base64"));console.log([p.web.file,p.app&&p.app.file].filter(Boolean).join("\n"))' "$OUT/ps-update.json")"
for f in "$OUT"/updates/PS-*.zip; do
  [ -e "$f" ] || continue
  rel="updates/$(basename "$f")"
  if ! grep -qxF "$rel" <<<"$KEEP" && [ -z "$(find "$f" -mmin -1440)" ]; then rm -f "$f"; fi
done
echo "PS updates: $KIND release${VER:+ V$VER}${KW:+ $KW} in $OUT (web $BUILT$([ "$KIND" = app ] && echo ", app $BUILD"))"
