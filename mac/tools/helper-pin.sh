#!/bin/bash
# The restart helper (Helper/rebootd.swift), kept byte for byte from one release to the next (V1.45).
#
# Why: PS is signed with "PS Local Signing", which has no Apple team. For a helper with no team, macOS pins its
# approval of the LaunchDaemon to the helper's exact cdhash (launchctl print system/com.cincee.ps.rebootd shows
# LWCR = { reqs = { cdhash = { $in = [...] } } }). A helper with any other cdhash is refused at spawn
# (exit 78 EX_CONFIG, "spawn failed") and System Settings wants PS switched on again. Recompiling the SAME source
# with a newer Command Line Tools changes the cdhash (the SDK and library versions are written into the binary):
# that is what switched the helper off on the V1.43 to V1.44 update (CLT 27.0 to 27.2, 8 Nov 2026).
#
# So the signed helper is built once per helper code and kept in Helper/pinned/. While the helper's code is the
# same (the sources below, these compile flags), every build copies that exact file in and macOS keeps its yes.
# Only a real change in the helper's code builds and pins a new one, and then every Mac has to switch PS on once
# more (PS shows a card for it, Sources/AutoReboot.swift). Any edit in those files (SRCS) counts, even a comment:
# keep helper changes together in one release.
#
# Usage: tools/helper-pin.sh <where rebootd goes in the app> <signing folder>
#        tools/helper-pin.sh --check   says whether Helper/pinned matches the helper's code now (no build)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PIN="$HERE/Helper/pinned"
SRCS=(Helper/rebootd.swift Helper/RebootCore.swift Helper/RebootXPC.swift Helper/LidCore.swift)
COMPILE=(swiftc -O -parse-as-library -target arm64-apple-macos13)
ID=B278D9D09DFED336675CFB367B2F8A3B51896689
CERT=$(sed -n 's/.*static let cert = "\([0-9a-f]*\)".*/\1/p' "$HERE/Helper/RebootXPC.swift")
REQ="identifier \"com.cincee.ps.rebootd\" and certificate root = H\"$CERT\""

# What the pinned helper was built from: the compile and sign settings, then each source with its name.
source_hash() {
  (cd "$HERE" && {
    echo "${COMPILE[*]} | codesign --options runtime --identifier com.cincee.ps.rebootd | $ID"
    for f in "${SRCS[@]}"; do echo "== $f"; cat "$f"; done
  } | shasum -a 256 | cut -d' ' -f1)
}
pinned_field() { sed -n "s/^$1=//p" "$PIN/rebootd.pin" 2>/dev/null | head -1; }
cdhash() { codesign -dvvv "$1" 2>&1 | sed -n 's/^CDHash=//p' | head -1; }
# The pinned file is usable: made from this code, signed by PS Local Signing as the helper, hardened runtime.
pin_ok() {
  [ -f "$PIN/rebootd" ] && [ "$(pinned_field source)" = "$(source_hash)" ] \
    && codesign -v -R="$REQ" "$PIN/rebootd" >/dev/null 2>&1 \
    && [[ "$(codesign -dv "$PIN/rebootd" 2>&1)" == *'(runtime)'* ]] \
    && [ "$(cdhash "$PIN/rebootd")" = "$(pinned_field cdhash)" ]
}

write_pin() {   # $1: the signed helper to pin
  mkdir -p "$PIN"
  [ "$1" -ef "$PIN/rebootd" ] || cp -p "$1" "$PIN/rebootd"
  printf 'source=%s\ncdhash=%s\nsdk=%s\npinned=%s\n' "$(source_hash)" "$(cdhash "$1")" "${PIN_SDK:-$(xcrun --show-sdk-version 2>/dev/null || echo unknown)}" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PIN/rebootd.pin"
}

# --seed <rebootd>: pin a helper that was ALREADY shipped from exactly this code (eg the one inside a released PS.app),
# so Macs that switched that one on keep it. Only for a helper built from the sources as they are now.
if [ "${1:-}" = --seed ]; then
  codesign -v -R="$REQ" "$2" || { echo "not a helper signed by PS Local Signing: $2"; exit 1; }
  write_pin "$2"; echo "Pinned $2 (cdhash $(pinned_field cdhash))"; exit 0
fi

if [ "${1:-}" = --check ]; then
  if pin_ok; then echo "Restart helper pin: OK (cdhash $(pinned_field cdhash), built $(pinned_field pinned))"; exit 0; fi
  echo "Restart helper pin: STALE or missing (the helper's code changed since Helper/pinned was made)"; exit 1
fi

OUT="$1"; SIGN="$2"
KC="$SIGN/ps-signing.keychain-db"
if [ -f "$KC" ] && [ -f "$SIGN/.keychain-pass" ]; then
  if pin_ok; then
    cp -p "$PIN/rebootd" "$OUT"
    echo "Restart helper: the pinned one, unchanged (cdhash $(pinned_field cdhash)), so macOS keeps its approval"
    exit 0
  fi
  "${COMPILE[@]}" "${SRCS[@]/#/$HERE/}" -o "$OUT"
  security unlock-keychain -p "$(cat "$SIGN/.keychain-pass")" "$KC"
  codesign --force --options runtime --keychain "$KC" --sign "$ID" --identifier com.cincee.ps.rebootd "$OUT"
  write_pin "$OUT"
  echo "WARNING: the restart helper's code changed, so a new helper was built and pinned in Helper/pinned (cdhash $(cdhash "$OUT"))."
  echo "WARNING: commit Helper/pinned. Every Mac that updates to this build must switch PS on once more under Allow in the Background (PS shows a card)."
else
  # No signing keychain (ad hoc fallback): built fresh, never pinned. Nothing about it would match an approval anyway.
  "${COMPILE[@]}" "${SRCS[@]/#/$HERE/}" -o "$OUT"
  codesign --force --sign - --identifier com.cincee.ps.rebootd "$OUT"
fi
