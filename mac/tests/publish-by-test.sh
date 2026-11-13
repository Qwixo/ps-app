#!/bin/bash
# Unit test for the signed update note's V1.58 fields (release/publish.sh): who made the release ("by", "shared"), the
# channel it is for ("channel"), the build that made it ("flavour"), and that a private release is never signed for
# the G Squad channel. A throwaway key and FICTIONAL web files in a temp folder; nothing goes online, nothing installed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "$1=ok"; else echo "$1=FAIL (got $2, want $3)"; FAILS=$((FAILS + 1)); fi; }
TOOL="$HERE/build/pstool"
if [ ! -x "$TOOL" ] || [ "$HERE/tools/pstool.swift" -nt "$TOOL" ]; then mkdir -p "$HERE/build"; swiftc -O "$HERE/tools/pstool.swift" -o "$TOOL"; fi
"$TOOL" keygen "$T/key" >/dev/null
web() {   # web <ps-version.json body>: a fictional dist-ps folder
  rm -rf "$T/web"; mkdir -p "$T/web"
  echo '{"src":"abcdef0123456789","built":"2026-11-13T12:00:00.000Z"}' > "$T/web/version.json"
  echo "$1" > "$T/web/ps-version.json"
  echo "<p>fictional</p>" > "$T/web/index.html"
}
field() { node -e 'const o=require(process.argv[1]);const p=JSON.parse(Buffer.from(o.signed,"base64"));const v=p[process.argv[2]];process.stdout.write(v===undefined?"none":JSON.stringify(v))' "$T/out/ps-update.json" "$1"; }
pub() { rm -rf "$T/out"; mkdir -p "$T/out"; env PS_RELEASE_OUT="$T/out" PS_UPDATE_KEY="$T/key" "$@" bash "$HERE/release/publish.sh" web "$T/web" >"$T/log" 2>&1; }

web '{"version":"1.58","name":"V1.58","keyword":"Test","by":"red","shared":true}'
pub; check shared-by-red-runs $? 0
check shared-channel "$(field channel)" '"gsquad"'
check shared-by "$(field by)" '"red"'
check shared-flag "$(field shared)" true
check signature-good "$("$TOOL" verify "$("$TOOL" pub "$T/key")" "$T/out/ps-update.json")" good

web '{"version":"1.57","name":"V1.57","keyword":"Old"}'
pub; check old-style-runs $? 0
check old-style-no-by "$(field by)" none
check old-style-channel "$(field channel)" '"gsquad"'

web '{"version":"1.59","name":"V1.59","keyword":"Test","by":"jan","shared":false}'
pub; check private-on-gsquad-refused $? 1
check private-nothing-written "$([ -f "$T/out/ps-update.json" ] && echo written || echo nothing)" nothing
pub PS_UPDATE_CHANNEL=jan PS_FLAVOUR=jan; check private-own-channel-runs $? 0
check private-channel "$(field channel)" '"jan"'
check private-shared "$(field shared)" false
check private-flavour "$(field flavour)" '"jan"'
pub PS_UPDATE_CHANNEL="Jan Smith"; check bad-channel-refused $? 1

web '{"version":"1.60","name":"V1.60","keyword":"Test","by":"red","shared":true}'
PS_HISTORY='[{"version":"1.59","keyword":"T","notes":["One."],"by":"jan","shared":true},{"version":"1.58","keyword":"U","notes":["Two."]}]' pub
check history-by "$(node -e 'const o=require(process.argv[1]);const p=JSON.parse(Buffer.from(o.signed,"base64"));process.stdout.write(p.history.map(h=>h.by||"-").join(","))' "$T/out/ps-update.json")" "jan,-"

[ "$FAILS" = 0 ] && echo "publish-by: all ok" || { echo "publish-by: $FAILS FAILED"; cat "$T/log"; exit 1; }
