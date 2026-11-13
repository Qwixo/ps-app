#!/bin/bash
# The pinned restart helper (tools/helper-pin.sh, V1.45). No compiling and nothing registered or launched:
#  1. Helper/pinned matches the helper's code now.
#  2. Two "builds" (helper-pin into two app folders, as build.sh calls it) get the exact same file and cdhash as the pin.
#  3. Any edit in the helper's code (even one comment) makes the pin stale, so the next build makes a new one and says so.
#  4. App code is not part of the pin: an edit in Sources/ changes nothing.
# Needs the signing folder of the main checkout (PS_SIGNING_DIR, default ~/Projects/ps/mac/signing) for step 2.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SIGN="${PS_SIGNING_DIR:-$HOME/Projects/ps/mac/signing}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
t() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
cdh() { codesign -dvvv "$1" 2>&1 | sed -n 's/^CDHash=//p'; }
PINNED="$(sed -n 's/^cdhash=//p' "$HERE/Helper/pinned/rebootd.pin")"

t "the pin matches the helper code now" "bash '$HERE/tools/helper-pin.sh' --check"
mkdir -p "$T/a" "$T/b"
bash "$HERE/tools/helper-pin.sh" "$T/a/rebootd" "$SIGN" > "$T/a.log" 2>&1
bash "$HERE/tools/helper-pin.sh" "$T/b/rebootd" "$SIGN" > "$T/b.log" 2>&1
t "build A used the pin (no compile)" "grep -q 'the pinned one, unchanged' '$T/a.log'"
t "build B used the pin (no compile)" "grep -q 'the pinned one, unchanged' '$T/b.log'"
t "A and B are byte for byte the same" "cmp '$T/a/rebootd' '$T/b/rebootd'"
t "A has the pinned cdhash" "[ \"\$(cdh '$T/a/rebootd')\" = '$PINNED' ]"
t "B has the pinned cdhash" "[ \"\$(cdh '$T/b/rebootd')\" = '$PINNED' ]"

# A copy of the repo's helper parts, to edit.
mkdir -p "$T/repo"; cp -R "$HERE/tools" "$HERE/Helper" "$T/repo/"; mkdir -p "$T/repo/Sources"; cp "$HERE/Sources/AutoReboot.swift" "$T/repo/Sources/"
t "the copy's pin is OK" "bash '$T/repo/tools/helper-pin.sh' --check"
echo "// app change" >> "$T/repo/Sources/AutoReboot.swift"
t "an app code change keeps the pin" "bash '$T/repo/tools/helper-pin.sh' --check"
for f in rebootd.swift RebootCore.swift RebootXPC.swift LidCore.swift; do
  cp "$HERE/Helper/$f" "$T/repo/Helper/$f"; echo "// a comment" >> "$T/repo/Helper/$f"
  t "an edit in Helper/$f makes the pin stale" "! bash '$T/repo/tools/helper-pin.sh' --check"
  cp "$HERE/Helper/$f" "$T/repo/Helper/$f"
done
t "back as it was, the pin is OK again" "bash '$T/repo/tools/helper-pin.sh' --check"
cp "$HERE/Helper/pinned/rebootd" "$T/repo/Helper/pinned/rebootd"; printf 'x' >> "$T/repo/Helper/pinned/rebootd"
t "a damaged pinned file is refused" "! bash '$T/repo/tools/helper-pin.sh' --check"
[ $fails -eq 0 ] && echo "HELPER PIN: all ok"
[ $fails -eq 0 ]
